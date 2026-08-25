/* TurniDSP — Automatic Workforce Management Engine
 * ---------------------------------------------------------------------------
 * Deterministic auto-generation of working days from exactly TWO sources of
 * truth (no rotation / fairness / AI logic):
 *   1. Employee profile  → contract_start_date, contract_end_date, work_days,
 *                          status, default shift code.
 *   2. Assenze (approved) → override the schedule for their date range.
 *
 * Rules
 *  - Historical days are never touched: regeneration only writes dates >= today
 *    (a fully past month is left untouched).
 *  - Rows written by the engine carry updated_by='auto-engine'. Human edits
 *    (any other updated_by) are preserved, EXCEPT that an approved absence
 *    always overrides whatever is on its days.
 *  - Non-working days / out-of-contract days: engine-owned rows are removed,
 *    human rows are left alone.
 *  - Idempotent: running it twice yields the same result (deterministic).
 *  - Per-employee regeneration only (never a blanket month rebuild) so it
 *    stays fast with thousands of employees.
 * ---------------------------------------------------------------------------
 */
const { pool, withTx } = require('../db/pool');

const ENGINE = 'auto-engine';

// Absence type → legend shift code. Matched case-insensitively by inclusion so
// "Ferie", "ferie estive", "Malattia certificata" all resolve.
const ABSENCE_CODE_MAP = [
  ['infortun', 'I'],       // Infortunio (before 'ferie' check order irrelevant)
  ['malatt', 'M'],
  ['ferie', 'F'],
  ['rol', 'ROL'],
  ['permess', 'PR'],
  ['formaz', 'CORSO'],
  ['corso', 'CORSO'],
  ['sospen', 'SOSPESO'],
  ['aspett', 'ASP'],
  ['non retribuit', 'ASP'],
  ['congedo', 'CONG'],
];
function absenceCode(type) {
  const t = String(type || '').toLowerCase();
  for (const [needle, code] of ABSENCE_CODE_MAP) if (t.includes(needle)) return code;
  return 'PR'; // generic leave
}

const iso = (d) => d.toISOString().slice(0, 10);
// Local "today" as YYYY-MM-DD (from local date parts, no timezone shift).
function localTodayStr() {
  const n = new Date();
  return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
}
function monthStartStr(ym) {           // '2026-08' | '2026-08-01' → '2026-08-01'
  return /^\d{4}-\d{2}$/.test(ym) ? ym + '-01' : String(ym).slice(0, 10);
}
function daysInMonth(msStr) {
  const [y, m] = msStr.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Regenerate one employee's auto-managed days for one month. Transaction-safe. */
async function regenerateEmployeeMonth(empId, ym, actor) {
  const ms = monthStartStr(ym);
  const [y, m] = ms.split('-').map(Number);
  const nDays = daysInMonth(ms);
  const todayStr = localTodayStr();
  const monthEndStr = ms.slice(0, 7) + '-' + String(nDays).padStart(2, '0');
  if (monthEndStr < todayStr) return { skipped: 'historical' };   // never rewrite the past

  // Dates as YYYY-MM-DD text to avoid timezone shifts (pg DATE → local-midnight
  // Date → toISOString() would roll back a day in +offset zones).
  const { rows: erows } = await pool.query(
    `SELECT e.id, e.status, COALESCE(e.work_days, ARRAY[1,2,3,4,5]) AS work_days,
            COALESCE(e.default_shift_code, (e.default_shift_codes)[1], 'X') AS def_code,
            e.contract_start_date::text AS cstart, e.contract_end_date::text AS cend,
            COALESCE(b.code,'') AS branch_code
       FROM employees e LEFT JOIN branches b ON b.id = e.branch_id
      WHERE e.id = $1`, [empId]);
  const emp = erows[0];
  if (!emp) return { skipped: 'missing' };

  const { rows: absences } = await pool.query(
    `SELECT absence_type, start_date::text AS sd, end_date::text AS ed FROM absences
      WHERE employee_id=$1 AND status='approved'
        AND start_date <= ($2::date + ($3 - 1) * interval '1 day')
        AND end_date   >= $2::date`, [empId, ms, nDays]);

  const { rows: existing } = await pool.query(
    `SELECT day_of_month, shift_code, updated_by FROM schedule_entries
      WHERE employee_id=$1 AND schedule_month=$2`, [empId, ms]);
  const cur = new Map(existing.map((r) => [r.day_of_month, r]));

  const cs = emp.cstart || null;   // 'YYYY-MM-DD' | null
  const ce = emp.cend || null;

  let written = 0, removed = 0;
  await withTx(async (c) => {
    for (let d = 1; d <= nDays; d++) {
      const date = new Date(Date.UTC(y, m - 1, d));
      const ds = iso(date);                                         // 'YYYY-MM-DD'
      if (ds < todayStr) continue;                                  // protect history
      const inContract = (!cs || ds >= cs) && (!ce || ds <= ce);
      // work_days uses 0..6 (0=Sunday) but some rows store 7 for Sunday (ISO).
      // Treat both 0 and 7 as Sunday so either convention works.
      const dow = date.getUTCDay();
      const isWorkDay = emp.status === 'active' && inContract &&
                        (emp.work_days.includes(dow) || (dow === 0 && emp.work_days.includes(7)));
      const abs = absences.find((a) => ds >= a.sd && ds <= a.ed);
      const row = cur.get(d);

      if (abs && isWorkDay) {
        // Absence on a working day → the absence code. EXCEPTION: never overwrite
        // an existing OFF (spec: OFF is not replaced by Ferie/Malattia/Permesso/
        // Infortunio/ROL/…). A manual working shift is still overridden.
        if (!(row && row.shift_code === 'OFF')) {
          const code = absenceCode(abs.absence_type);
          if (!row || row.shift_code !== code || row.updated_by !== ENGINE) {
            await c.query(
              `INSERT INTO schedule_entries (schedule_month, employee_id, day_of_month, shift_code, branch_code, updated_by)
               VALUES ($1,$2,$3,$4,$5,$6)
               ON CONFLICT (employee_id, schedule_month, day_of_month) WHERE employee_id IS NOT NULL
               DO UPDATE SET shift_code=EXCLUDED.shift_code, updated_by=EXCLUDED.updated_by, updated_at=now()`,
              [ms, empId, d, code, emp.branch_code || null, ENGINE]);
            written++;
          }
        }
      } else if (abs && inContract) {
        // Non-working CONTRACT day INSIDE the absence window → OFF (engine-owned).
        // The absence code lands only on working days; the rest days of the
        // absence period show OFF. OFF is valid only inside the range: once the
        // absence is removed this day is no longer `abs`, so the engine-owned OFF
        // is cleaned up by the delete branch below. Manual rows are kept.
        if (!row || (row.updated_by === ENGINE && row.shift_code !== 'OFF')) {
          await c.query(
            `INSERT INTO schedule_entries (schedule_month, employee_id, day_of_month, shift_code, branch_code, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (employee_id, schedule_month, day_of_month) WHERE employee_id IS NOT NULL
             DO UPDATE SET shift_code=EXCLUDED.shift_code, updated_by=EXCLUDED.updated_by, updated_at=now()`,
            [ms, empId, d, 'OFF', emp.branch_code || null, ENGINE]);
          written++;
        }
      } else if (isWorkDay) {
        if (!row) {
          await c.query(
            `INSERT INTO schedule_entries (schedule_month, employee_id, day_of_month, shift_code, branch_code, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (employee_id, schedule_month, day_of_month) WHERE employee_id IS NOT NULL DO NOTHING`,
            [ms, empId, d, emp.def_code, emp.branch_code || null, ENGINE]);
          written++;
        } else if (row.updated_by === ENGINE && row.shift_code !== emp.def_code) {
          // Engine-owned leftover (e.g. an absence that was deleted) → default.
          await c.query(
            `UPDATE schedule_entries SET shift_code=$4, updated_at=now()
              WHERE employee_id=$1 AND schedule_month=$2 AND day_of_month=$3`,
            [empId, ms, d, emp.def_code]);
          written++;
        } // human row → keep (operational override)
      } else if (row && row.updated_by === ENGINE) {
        // Not a working day anymore (contract change / termination / inactive):
        // remove only engine-owned rows.
        await c.query(
          `DELETE FROM schedule_entries WHERE employee_id=$1 AND schedule_month=$2 AND day_of_month=$3 AND updated_by=$4`,
          [empId, ms, d, ENGINE]);
        removed++;
      }
    }
  });

  if (written || removed) {
    await pool.query(
      `INSERT INTO audit_log (username, role, entity, entity_id, action, detail, ip)
       VALUES ($1,'system','schedule',$2,'auto-generate',$3,'-')`,
      [actor || ENGINE, empId, `Rigenerazione automatica ${ms.slice(0, 7)}: +${written} / -${removed}`]);
  }
  return { written, removed };
}

/** Rolling window of months the engine keeps materialized: current + next 2. */
function monthsWindow() {
  const out = [];
  const now = new Date();
  for (let i = 0; i < 3; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    out.push(iso(d));
  }
  return out;
}

/** Regenerate one employee across the rolling window (create/edit/absence hooks). */
async function regenerateEmployee(empId, actor) {
  for (const ms of monthsWindow()) await regenerateEmployeeMonth(empId, ms, actor);
}

/** Lazily materialize a viewed month: only employees with NO engine rows yet. */
async function ensureMonth(ym, branch) {
  const ms = monthStartStr(ym);
  const monthEndStr = ms.slice(0, 7) + '-' + String(daysInMonth(ms)).padStart(2, '0');
  if (monthEndStr < localTodayStr()) return; // past month
  const { rows } = await pool.query(
    `SELECT e.id FROM employees e
      LEFT JOIN branches b ON b.id = e.branch_id
      WHERE COALESCE(e.status,'active') = 'active'
        AND ($2 = '' OR b.code = $2
             OR EXISTS (SELECT 1 FROM branches b2 WHERE b2.code=$2 AND b2.id = ANY(COALESCE(e.branch_ids, ARRAY[]::int[]))))
        AND NOT EXISTS (SELECT 1 FROM schedule_entries s
                         WHERE s.employee_id = e.id AND s.schedule_month = $1 AND s.updated_by = 'auto-engine')`,
    [ms, branch || '']);
  for (const r of rows) await regenerateEmployeeMonth(r.id, ms);
}

module.exports = { regenerateEmployee, regenerateEmployeeMonth, ensureMonth, absenceCode };
