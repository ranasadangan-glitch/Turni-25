// ============================================================
// Regression: a newly created active employee must appear in Pianificazione
// (GET /api/scheduler/month) and have auto-generated working-day shifts —
// including multi-branch employees viewed under a secondary branch, which the
// engine's single branch_code stamping previously hid.
//
// Exercises the REAL /month route handler + the real auto-engine against a live
// PostgreSQL. Uses throwaway branches (ZT1/ZT2) and ZZ-prefixed employees so it
// only ever sees its own rows; cleans up after. Skips if no DB.
//
// node:test + node:assert, no new deps. npm test (serial) from server/.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const { pool } = require('../src/db/pool');
const schedulerRouter = require('../src/routes/scheduler');
const { regenerateEmployee } = require('../src/services/autoschedule');

const B1 = 'ZT1';           // test branch 1
const B2 = 'ZT2';           // test branch 2
const EMP_PREFIX = 'ZZR';   // employee_code prefix

let dbOk = false;
let b1id, b2id;

// ---- invoke the real GET /api/scheduler/month handler ----
function monthHandler() {
  const layer = schedulerRouter.stack.find((l) => l.route && l.route.path === '/month' && l.route.methods.get);
  assert.ok(layer, '/month route exists');
  return layer.route.stack.map((s) => s.handle);
}
async function getMonth(month, branch) {
  const handlers = monthHandler();
  const req = { method: 'GET', query: { month, branch }, params: {}, headers: {}, user: { username: 'test', role: 'admin' } };
  let body;
  const res = { status() { return this; }, json(b) { body = b; return this; } };
  for (const h of handlers) { let nx = false; /* eslint-disable no-await-in-loop */ await h(req, res, () => { nx = true; }); if (!nx) break; }
  return body;
}

// mirrors the POST /api/employees write path (syncPrimaryFromArrays + engine regen)
async function createEmployee({ code, work_days = [1, 2, 3, 4, 5], branch_id = null, branch_ids = null, cstart = null, status = 'active', def = 'X' }) {
  const { rows } = await pool.query(
    `INSERT INTO employees (employee_code, first_name, last_name, status, work_days,
        default_shift_code, branch_id, branch_ids, contract_start_date)
     VALUES ($1,$2,'T',$3,$4,$5,$6,$7,$8) RETURNING id`,
    [code, code, status, work_days, def, branch_id, branch_ids, cstart]);
  const id = rows[0].id;
  await regenerateEmployee(id, 'test');
  return id;
}
const has = (snap, empId) => (snap.drivers || []).some((d) => d.employee_id === empId || d.id === empId);
const cellsOf = (snap, empId) => (snap.schedule && snap.schedule[empId]) || {};

// month helpers: use NEXT month (fully in the future) for deterministic
// whole-month generation regardless of today's date.
function nextMonthYM() {
  const n = new Date();
  const d = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1));
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}
function dow(ym, day) {           // JS weekday 0=Sun..6=Sat for ym-day
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day)).getUTCDay();
}
function firstDayWithDow(ym, targetDow) {
  const [y, m] = ym.split('-').map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  for (let d = 1; d <= n; d++) if (dow(ym, d) === targetDow) return d;
  return null;
}

test.before(async () => {
  try { await pool.query('SELECT 1'); dbOk = true; } catch { return; }
  await cleanup();
  b1id = (await pool.query('INSERT INTO branches(code,name) VALUES($1,$2) RETURNING id', [B1, 'ZT One'])).rows[0].id;
  b2id = (await pool.query('INSERT INTO branches(code,name) VALUES($1,$2) RETURNING id', [B2, 'ZT Two'])).rows[0].id;
});
test.after(async () => { if (dbOk) await cleanup(); await pool.end(); });

async function cleanup() {
  await pool.query("DELETE FROM schedule_entries WHERE employee_id IN (SELECT id FROM employees WHERE employee_code LIKE $1||'%')", [EMP_PREFIX]).catch(() => {});
  await pool.query("DELETE FROM employees WHERE employee_code LIKE $1||'%'", [EMP_PREFIX]).catch(() => {});
  await pool.query('DELETE FROM branches WHERE code IN ($1,$2)', [B1, B2]).catch(() => {});
}

test('A: new active employee appears in the scheduler roster', async (t) => {
  if (!dbOk) return t.skip('no database');
  const id = await createEmployee({ code: EMP_PREFIX + 'A', branch_id: b1id });
  const snap = await getMonth(nextMonthYM(), B1);
  assert.ok(has(snap, id), 'employee appears in /month drivers for its branch');
});

test('B: current & future working days are generated', async (t) => {
  if (!dbOk) return t.skip('no database');
  const id = await createEmployee({ code: EMP_PREFIX + 'B', branch_id: b1id });
  const ym = nextMonthYM();
  const snap = await getMonth(ym, B1);
  const cells = cellsOf(snap, id);
  const wd = firstDayWithDow(ym, 3); // a Wednesday (working)
  assert.equal(cells[wd], 'X', 'a working day has the default code generated');
  assert.ok(Object.keys(cells).length >= 20, 'a full future month materializes ~weekday count of cells');
});

test('C: Mon–Fri work_days generate only on Mon–Fri', async (t) => {
  if (!dbOk) return t.skip('no database');
  const id = await createEmployee({ code: EMP_PREFIX + 'C', branch_id: b1id, work_days: [1, 2, 3, 4, 5] });
  const ym = nextMonthYM();
  const cells = cellsOf(await getMonth(ym, B1), id);
  const sat = firstDayWithDow(ym, 6), sun = firstDayWithDow(ym, 0), mon = firstDayWithDow(ym, 1);
  assert.equal(cells[mon], 'X', 'Monday generated');
  assert.equal(cells[sat], undefined, 'Saturday NOT generated');
  assert.equal(cells[sun], undefined, 'Sunday NOT generated');
});

test('D: future contract_start_date → no shifts before start', async (t) => {
  if (!dbOk) return t.skip('no database');
  const ym = nextMonthYM();
  const startDay = 20;
  const id = await createEmployee({ code: EMP_PREFIX + 'D', branch_id: b1id, cstart: `${ym}-${startDay}` });
  const cells = cellsOf(await getMonth(ym, B1), id);
  // pick a working day (Wed) before the 20th and one on/after
  const before = firstDayWithDow(ym, 3);
  assert.ok(before < startDay, 'test setup: a Wednesday exists before day 20');
  assert.equal(cells[before], undefined, 'no shift before contract_start_date');
  const after = (function () { for (let d = startDay; d <= 28; d++) if ([1, 2, 3, 4, 5].includes(dow(ym, d))) return d; })();
  assert.equal(cells[after], 'X', 'shift generated on/after contract_start_date');
});

test('E/F/G: branch filtering — DLO1-style branch, other branch, and Tutte le filiali', async (t) => {
  if (!dbOk) return t.skip('no database');
  const e1 = await createEmployee({ code: EMP_PREFIX + 'E', branch_id: b1id });
  const e2 = await createEmployee({ code: EMP_PREFIX + 'F', branch_id: b2id });
  const ym = nextMonthYM();
  const s1 = await getMonth(ym, B1);
  const s2 = await getMonth(ym, B2);
  const sall = await getMonth(ym, '');
  assert.ok(has(s1, e1) && !has(s1, e2), 'E: branch B1 shows only its employee');
  assert.ok(has(s2, e2) && !has(s2, e1), 'F: branch B2 shows only its employee');
  assert.ok(has(sall, e1) && has(sall, e2), 'G: Tutte le filiali shows both');
  // and their shifts are present under the selected branch
  assert.equal(cellsOf(s1, e1)[firstDayWithDow(ym, 3)], 'X', 'E1 shifts visible under B1');
  assert.equal(cellsOf(s2, e2)[firstDayWithDow(ym, 3)], 'X', 'E2 shifts visible under B2');
});

test('REGRESSION: multi-branch employee shifts visible under the SECONDARY branch', async (t) => {
  if (!dbOk) return t.skip('no database');
  // branch_id = B1 (primary), also member of B2 via branch_ids — the exact bug case
  const id = await createEmployee({ code: EMP_PREFIX + 'MB', branch_id: b1id, branch_ids: [b1id, b2id] });
  const ym = nextMonthYM();
  const wd = firstDayWithDow(ym, 3);
  const underB1 = await getMonth(ym, B1);
  const underB2 = await getMonth(ym, B2);
  assert.ok(has(underB1, id) && cellsOf(underB1, id)[wd] === 'X', 'visible with shifts under primary branch B1');
  assert.ok(has(underB2, id), 'appears in roster under secondary branch B2');
  assert.equal(cellsOf(underB2, id)[wd], 'X', 'FIX: shifts also visible under secondary branch B2');
});

test('REGRESSION: employee with branch set via branch_ids only (branch_id NULL) shows shifts', async (t) => {
  if (!dbOk) return t.skip('no database');
  const id = await createEmployee({ code: EMP_PREFIX + 'NB', branch_id: null, branch_ids: [b1id] });
  const ym = nextMonthYM();
  const snap = await getMonth(ym, B1);
  assert.ok(has(snap, id), 'appears in roster under B1 via branch_ids');
  assert.equal(cellsOf(snap, id)[firstDayWithDow(ym, 3)], 'X', 'FIX: shifts visible even with branch_id NULL');
});

test('H: editing work_days regenerates future engine-owned shifts', async (t) => {
  if (!dbOk) return t.skip('no database');
  const id = await createEmployee({ code: EMP_PREFIX + 'H', branch_id: b1id, work_days: [1, 2, 3, 4, 5] });
  const ym = nextMonthYM();
  const sat = firstDayWithDow(ym, 6);
  assert.equal(cellsOf(await getMonth(ym, B1), id)[sat], undefined, 'Saturday initially empty');
  // change work_days to include Saturday (6) and regenerate (mirrors PUT hook)
  await pool.query('UPDATE employees SET work_days=$2 WHERE id=$1', [id, [1, 2, 3, 4, 5, 6]]);
  await regenerateEmployee(id, 'test');
  assert.equal(cellsOf(await getMonth(ym, B1), id)[sat], 'X', 'Saturday generated after work_days change');
});

test('I: manual schedule entries are preserved across regeneration', async (t) => {
  if (!dbOk) return t.skip('no database');
  const id = await createEmployee({ code: EMP_PREFIX + 'I', branch_id: b1id });
  const ym = nextMonthYM();
  const wd = firstDayWithDow(ym, 3);
  // a human overrides that working day with a different code
  await pool.query(
    `INSERT INTO schedule_entries (schedule_month, employee_id, day_of_month, shift_code, branch_code, updated_by)
     VALUES ($1,$2,$3,'OFF',$4,'planner')
     ON CONFLICT (employee_id, schedule_month, day_of_month) WHERE employee_id IS NOT NULL
     DO UPDATE SET shift_code=EXCLUDED.shift_code, updated_by=EXCLUDED.updated_by`,
    [ym + '-01', id, wd, B1]);
  await regenerateEmployee(id, 'test'); // must NOT clobber the manual override
  const cells = cellsOf(await getMonth(ym, B1), id);
  assert.equal(cells[wd], 'OFF', 'manual override preserved (engine did not overwrite)');
});

test('J: repeated regeneration is idempotent', async (t) => {
  if (!dbOk) return t.skip('no database');
  const id = await createEmployee({ code: EMP_PREFIX + 'J', branch_id: b1id });
  const ym = ymToMonth(nextMonthYM());
  const count = () => pool.query('SELECT count(*)::int n FROM schedule_entries WHERE employee_id=$1 AND schedule_month=$2', [id, ym]).then((r) => r.rows[0].n);
  const a = await count();
  await regenerateEmployee(id, 'test');
  await regenerateEmployee(id, 'test');
  const b = await count();
  assert.equal(a, b, 'row count stable across repeated regeneration');
});
function ymToMonth(ym) { return ym + '-01'; }
