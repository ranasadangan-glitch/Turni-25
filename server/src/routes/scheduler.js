// Scheduler API — replaces localStorage with PostgreSQL.
// All state that was previously in:
//   localStorage["turniDSP_YYYY-MM"]  → schedule_entries + scheduler_drivers + schedule_forecasts
//   localStorage["turniDSP_config"]   → scheduler_config
// is now read from and written to the database.
const router = require('express').Router();
const { pool, withTx } = require('../db/pool');
const logger = require('../utils/logger');
const { auth, loadScope, audit } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { ensureMonth } = require('../services/autoschedule');
const { pruneServiceCounts } = require('../services/serviceCodes');

router.use(auth, loadScope);

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────
function monthStart(ym) {
  // Accept "YYYY-MM" or a full date; always return "YYYY-MM-01"
  if (!ym) throw new Error('month required (YYYY-MM)');
  const m = String(ym).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(m)) throw new Error('invalid month format');
  return m + '-01';
}

function scopeFilter(scope, params, col = 'branch_code') {
  if (scope.admin || !scope.branches) return '';
  if (!scope.branches.length) return ' AND 1=0';
  // branches is array of IDs; for scheduler we use branch_code text col
  // so we join to branches table only when needed; simpler: no restriction
  // if the user has branches assigned — we trust loadScope for employees,
  // but scheduler_drivers use text branch_code directly.
  // For now: no row-level restriction by branch_id array (scheduler uses codes).
  // Admin sees all; team_leaders see their branch via UI filter, not SQL here.
  return '';
}

// ── Branch-scope enforcement for WRITES ──────────────────────────────────
// loadScope gives us branch IDs; the scheduler keys everything by branch CODE
// (filiale). Resolve the caller's allowed codes once per request, then reject
// any write that targets a filiale the user isn't assigned to. Admin bypasses.
async function allowedBranchCodes(req) {
  if (req.scope.admin) return null;            // null = all branches allowed
  if (req._scopeCodes) return req._scopeCodes; // cached per request
  const ids = req.scope.branches || [];
  if (!ids.length) { req._scopeCodes = new Set(); return req._scopeCodes; }
  const { rows } = await pool.query('SELECT code FROM branches WHERE id = ANY($1)', [ids]);
  req._scopeCodes = new Set(rows.map((r) => r.code));
  return req._scopeCodes;
}
// Returns true (and sends 403) when the branch is NOT permitted for this user.
async function branchDenied(req, res, code) {
  const allowed = await allowedBranchCodes(req);
  if (allowed === null) return false;          // admin: everything allowed
  if (code && allowed.has(code)) return false; // in scope
  res.status(403).json({ error: 'Filiale non assegnata: ' + (code || '—') });
  return true;
}

async function logSchedulerAction(actor, month, branchCode, action, opts = {}) {
  try {
    await pool.query(
      `INSERT INTO schedule_audit_log
         (schedule_month, branch_code, actor, action, driver_id, employee_id, day_of_month, old_code, new_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [month, branchCode || null, actor, action,
       opts.driver_id || null, opts.employee_id || null,
       opts.day || null, opts.old_code || null, opts.new_code || null]
    );
  } catch { /* non-fatal */ }
}

// ─────────────────────────────────────────────────────────
// SCHEDULE ENTRIES (the grid cells)
// ─────────────────────────────────────────────────────────

// GET /api/scheduler/entries?month=YYYY-MM&branch=DLO1
// Returns the full grid for a month. Used by loadMonth().
router.get('/entries', async (req, res) => {
  try {
    const month = monthStart(req.query.month);
    const params = [month];
    let sql = `
      SELECT se.id, se.employee_id, se.local_driver_id, se.day_of_month,
             se.shift_code, se.branch_code, se.updated_by, se.updated_at
        FROM schedule_entries se
       WHERE se.schedule_month = $1`;
    if (req.query.branch) { params.push(req.query.branch); sql += ` AND se.branch_code = $${params.length}`; }
    sql += ' ORDER BY se.employee_id NULLS LAST, se.local_driver_id, se.day_of_month';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// GET /api/scheduler/weekly?from=YYYY-MM-DD&branch=DLO1
// Returns entries for a 7-day window. Used by the weekly view.
router.get('/weekly', async (req, res) => {
  try {
    const { from, branch } = req.query;
    if (!from) return res.status(400).json({ error: 'from richiesto (YYYY-MM-DD)' });
    const params = [from];
    let sql = `
      SELECT se.employee_id, se.local_driver_id, se.day_of_month,
             se.shift_code, se.branch_code, se.schedule_month,
             sd.cognome, sd.nome, sd.filiale, sd.service,
             e.first_name, e.last_name
        FROM schedule_entries se
        LEFT JOIN scheduler_drivers sd ON sd.id = se.local_driver_id
        LEFT JOIN employees e ON e.id = se.employee_id
       WHERE se.schedule_month = date_trunc('month', $1::date)
         AND se.day_of_month BETWEEN EXTRACT(DAY FROM $1::date)
             AND EXTRACT(DAY FROM ($1::date + INTERVAL '6 days'))`;
    if (branch) { params.push(branch); sql += ` AND se.branch_code = $${params.length}`; }
    sql += ' ORDER BY COALESCE(sd.cognome, e.last_name), se.day_of_month';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// GET /api/scheduler/monthly?month=YYYY-MM&branch=DLO1
// Returns all entries for a full month, grouped by driver. Used by the monthly view.
router.get('/monthly', async (req, res) => {
  try {
    const month = monthStart(req.query.month);
    const params = [month];
    let sql = `
      SELECT se.employee_id, se.local_driver_id, se.day_of_month,
             se.shift_code, se.branch_code,
             sd.cognome, sd.nome, sd.filiale, sd.service, sd.contratto,
             e.first_name, e.last_name,
             b.code AS emp_branch_code
        FROM schedule_entries se
        LEFT JOIN scheduler_drivers sd ON sd.id = se.local_driver_id
        LEFT JOIN employees e ON e.id = se.employee_id
        LEFT JOIN branches b ON b.id = e.branch_id
       WHERE se.schedule_month = $1`;
    if (req.query.branch) { params.push(req.query.branch); sql += ` AND se.branch_code = $${params.length}`; }
    sql += ' ORDER BY COALESCE(sd.cognome, e.last_name), COALESCE(sd.nome, e.first_name), se.day_of_month';
    const { rows } = await pool.query(sql, params);

    // Group into { driver_key: { info, days: {1: code, 2: code, ...} } }
    const grouped = {};
    for (const r of rows) {
      const key = r.employee_id ? `e_${r.employee_id}` : `l_${r.local_driver_id}`;
      if (!grouped[key]) {
        grouped[key] = {
          employee_id: r.employee_id,
          local_driver_id: r.local_driver_id,
          cognome: r.cognome || r.last_name,
          nome: r.nome || r.first_name,
          filiale: r.filiale || r.emp_branch_code,
          service: r.service,
          contratto: r.contratto,
          days: {},
        };
      }
      grouped[key].days[r.day_of_month] = r.shift_code;
    }
    res.json(Object.values(grouped));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// PUT /api/scheduler/entries  — upsert a single cell
// Body: { month, employee_id?, local_driver_id?, day, shift_code, branch_code }
// Empty shift_code → delete the cell.
router.put('/entries', requirePermission('schedule.manage'), async (req, res) => {
  try {
    const { month, employee_id, local_driver_id, day, shift_code, branch_code } = req.body || {};
    if (!month || !day) return res.status(400).json({ error: 'month e day richiesti' });
    if (!employee_id && !local_driver_id) return res.status(400).json({ error: 'employee_id o local_driver_id richiesto' });
    if (await branchDenied(req, res, branch_code)) return;
    const m = monthStart(month);
    const empId = employee_id || null;
    const locId = local_driver_id || null;

    // Fetch old code for audit
    const old = await pool.query(
      `SELECT shift_code FROM schedule_entries
        WHERE schedule_month=$1 AND (employee_id=$2 OR (employee_id IS NULL AND local_driver_id=$3))
          AND day_of_month=$4`,
      [m, empId, locId, day]
    );
    const oldCode = old.rows[0]?.shift_code || null;

    if (!shift_code) {
      await pool.query(
        `DELETE FROM schedule_entries
          WHERE schedule_month=$1 AND day_of_month=$4
            AND (employee_id=$2 OR (employee_id IS NULL AND local_driver_id=$3))`,
        [m, empId, locId, day]
      );
    } else {
      await pool.query(
        `INSERT INTO schedule_entries
           (schedule_month, employee_id, local_driver_id, day_of_month, shift_code, branch_code, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (employee_id, schedule_month, day_of_month)
           WHERE employee_id IS NOT NULL
         DO UPDATE SET shift_code=EXCLUDED.shift_code, updated_by=EXCLUDED.updated_by, updated_at=now()
        `,
        [m, empId, locId, day, shift_code, branch_code || null, req.user.username]
      );
      // Handle local_driver_id conflict separately (PG doesn't support two partial ON CONFLICT)
      if (!empId && locId) {
        await pool.query(
          `INSERT INTO schedule_entries
             (schedule_month, employee_id, local_driver_id, day_of_month, shift_code, branch_code, updated_by)
           VALUES ($1,NULL,$2,$3,$4,$5,$6)
           ON CONFLICT (local_driver_id, schedule_month, day_of_month)
             WHERE local_driver_id IS NOT NULL
           DO UPDATE SET shift_code=EXCLUDED.shift_code, updated_by=EXCLUDED.updated_by, updated_at=now()`,
          [m, locId, day, shift_code, branch_code || null, req.user.username]
        );
      }
    }

    await logSchedulerAction(req.user.username, m, branch_code, `Turno g${day}: ${oldCode || 'vuoto'} → ${shift_code || 'vuoto'}`,
      { employee_id: empId, driver_id: locId, day, old_code: oldCode, new_code: shift_code || null });
    await audit(req, 'schedule', empId || locId, 'update', `${m} g${day}: ${shift_code || 'vuoto'}`);
    res.json({ ok: true });
  } catch (e) { logger.error('scheduler', 'entries PUT error', e); res.status(500).json({ error: e.message }); }
});

// POST /api/scheduler/entries/bulk  — upsert many cells in a transaction
// Body: { month, branch_code, items: [{employee_id?, local_driver_id?, day, shift_code}] }
router.post('/entries/bulk', requirePermission('schedule.manage'), async (req, res) => {
  try {
    const { month, branch_code, items = [] } = req.body || {};
    if (!month) return res.status(400).json({ error: 'month richiesto' });
    if (await branchDenied(req, res, branch_code)) return;
    const m = monthStart(month);
    let saved = 0;
    await withTx(async (c) => {
      for (const it of items) {
        const empId = it.employee_id || null;
        const locId = it.local_driver_id || null;
        if (!it.day || (!empId && !locId)) continue;
        if (!it.shift_code) {
          await c.query(
            `DELETE FROM schedule_entries WHERE schedule_month=$1 AND day_of_month=$4
               AND (employee_id=$2 OR (employee_id IS NULL AND local_driver_id=$3))`,
            [m, empId, locId, it.day]
          );
        } else if (empId) {
          await c.query(
            `INSERT INTO schedule_entries (schedule_month, employee_id, day_of_month, shift_code, branch_code, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (employee_id, schedule_month, day_of_month) WHERE employee_id IS NOT NULL
             DO UPDATE SET shift_code=EXCLUDED.shift_code, updated_by=EXCLUDED.updated_by, updated_at=now()`,
            [m, empId, it.day, it.shift_code, it.branch_code || branch_code || null, req.user.username]
          );
        } else {
          await c.query(
            `INSERT INTO schedule_entries (schedule_month, local_driver_id, day_of_month, shift_code, branch_code, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (local_driver_id, schedule_month, day_of_month) WHERE local_driver_id IS NOT NULL
             DO UPDATE SET shift_code=EXCLUDED.shift_code, updated_by=EXCLUDED.updated_by, updated_at=now()`,
            [m, locId, it.day, it.shift_code, branch_code || null, req.user.username]
          );
        }
        saved++;
      }
    });
    await logSchedulerAction(req.user.username, m, branch_code, `Bulk save: ${saved} celle`);
    await audit(req, 'schedule', null, 'update', `Bulk ${saved} celle ${m} ${branch_code || ''}`);
    res.json({ ok: true, saved });
  } catch (e) { logger.error('scheduler', 'entries bulk error', e); res.status(500).json({ error: e.message }); }
});

// DELETE /api/scheduler/entries?month=YYYY-MM&branch=DLO1  — reset a month
router.delete('/entries', requirePermission('schedule.manage'), async (req, res) => {
  try {
    // Non-admins must scope the reset to one of their branches (otherwise this
    // would wipe every branch's month).
    if (await branchDenied(req, res, req.query.branch)) return;
    const month = monthStart(req.query.month);
    const params = [month];
    let sql = 'DELETE FROM schedule_entries WHERE schedule_month=$1';
    if (req.query.branch) { params.push(req.query.branch); sql += ` AND branch_code=$${params.length}`; }
    const r = await pool.query(sql, params);
    await logSchedulerAction(req.user.username, month, req.query.branch, `Turni del mese azzerati (${r.rowCount} righe)`);
    await audit(req, 'schedule', null, 'delete', `Reset mese ${month} ${req.query.branch || ''}`);
    res.json({ ok: true, deleted: r.rowCount });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────
// SCHEDULER DRIVERS (local roster)
// ─────────────────────────────────────────────────────────

// GET /api/scheduler/drivers?branch=&status=
router.get('/drivers', async (req, res) => {
  try {
    const params = [];
    let sql = 'SELECT * FROM scheduler_drivers WHERE 1=1';
    if (req.query.branch) { params.push(req.query.branch); sql += ` AND filiale=$${params.length}`; }
    if (req.query.status) { params.push(req.query.status); sql += ` AND status=$${params.length}`; }
    else sql += " AND status != 'pending'";
    sql += ' ORDER BY cognome, nome';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/scheduler/drivers  — add a driver to the scheduler roster
router.post('/drivers', requirePermission('employee.manage'), async (req, res) => {
  try {
    const { cognome, nome, filiale, service, contratto, ctr_type, expiry_date,
            work_days, default_code, status, transporter_id, device, hire_date } = req.body || {};
    if (!cognome || !nome) return res.status(400).json({ error: 'cognome e nome richiesti' });
    const { rows } = await pool.query(
      `INSERT INTO scheduler_drivers
         (cognome, nome, filiale, service, contratto, ctr_type, expiry_date,
          work_days, default_code, status, transporter_id, device, hire_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [cognome, nome, filiale || 'DLO1', service || null, contratto || null,
       ctr_type || 'indeterminato', expiry_date || null,
       work_days || [1,2,3,4,5], default_code || null,
       status || 'active', transporter_id || null, device || null, hire_date || null,
       req.user.username]
    );
    await audit(req, 'employee', rows[0].id, 'create', `Scheduler driver: ${cognome} ${nome}`);
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/scheduler/drivers/:id
router.put('/drivers/:id', requirePermission('employee.manage'), async (req, res) => {
  try {
    const fields = ['cognome','nome','filiale','service','contratto','ctr_type','expiry_date',
                    'work_days','default_code','status','transporter_id','device','hire_date','employee_id'];
    const b = req.body || {};
    const cols = fields.filter(f => b[f] !== undefined);
    if (!cols.length) return res.status(400).json({ error: 'Nessun campo' });
    const sets = cols.map((f, i) => `${f}=$${i+1}`);
    const vals = cols.map(f => b[f]);
    const { rows } = await pool.query(
      `UPDATE scheduler_drivers SET ${sets.join(',')} WHERE id=$${cols.length+1} RETURNING *`,
      [...vals, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Non trovato' });
    await audit(req, 'employee', req.params.id, 'update', `Scheduler driver aggiornato: ${rows[0].cognome} ${rows[0].nome}`);
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/scheduler/drivers/:id/approve  — promote pending driver to active + link/create employee
router.post('/drivers/:id/approve', requirePermission('employee.manage'), async (req, res) => {
  try {
    const { rows: dr } = await pool.query('SELECT * FROM scheduler_drivers WHERE id=$1', [req.params.id]);
    if (!dr[0]) return res.status(404).json({ error: 'Non trovato' });
    const d = dr[0];

    // Create or link to employees
    let empId = d.employee_id;
    if (!empId) {
      const { rows: emp } = await pool.query(
        `INSERT INTO employees (first_name, last_name, status, hire_date, default_shift_code, added_by)
         VALUES ($1,$2,'active',$3,$4,$5) RETURNING id`,
        [d.nome, d.cognome, d.hire_date || null, d.default_code || null, req.user.username]
      );
      empId = emp[0].id;
    }
    await pool.query(
      'UPDATE scheduler_drivers SET status=$1, employee_id=$2 WHERE id=$3',
      ['active', empId, req.params.id]
    );
    // Backfill branch_code on any pending entries
    await pool.query(
      'UPDATE schedule_entries SET employee_id=$1 WHERE local_driver_id=$2',
      [empId, +req.params.id]
    );
    await audit(req, 'employee', empId, 'create', `Driver approvato: ${d.cognome} ${d.nome}`);
    res.json({ ok: true, employee_id: empId });
  } catch (e) { logger.error('scheduler', 'approve error', e); res.status(500).json({ error: e.message }); }
});

// POST /api/scheduler/drivers/import  — bulk import from the scheduler's JSON export
router.post('/drivers/import', requirePermission('employee.manage'), async (req, res) => {
  try {
    const drivers = (req.body && req.body.drivers) || [];
    let added = 0;
    await withTx(async (c) => {
      for (const d of drivers) {
        if (!d.cognome && !d.nome) continue;
        await c.query(
          `INSERT INTO scheduler_drivers
             (cognome, nome, filiale, service, contratto, ctr_type, expiry_date,
              work_days, default_code, status, transporter_id, device, hire_date, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           ON CONFLICT DO NOTHING`,
          [d.cognome || '', d.nome || '', d.filiale || 'DLO1', d.service || null,
           d.contratto || null, d.ctrType || 'indeterminato', d.expiry || null,
           d.workDays || [1,2,3,4,5], d.defaultCode || null, d.status || 'active',
           d.transporterId || null, d.device || null, d.hireDate || null, req.user.username]
        );
        added++;
      }
    });
    await audit(req, 'employee', null, 'create', `Import scheduler drivers: ${added}`);
    res.json({ ok: true, added });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────
// FORECASTS
// ─────────────────────────────────────────────────────────

// GET /api/scheduler/forecasts?month=YYYY-MM&branch=DLO1
router.get('/forecasts', async (req, res) => {
  try {
    const month = monthStart(req.query.month);
    const params = [month];
    let sql = 'SELECT * FROM schedule_forecasts WHERE schedule_month=$1';
    if (req.query.branch) { params.push(req.query.branch); sql += ` AND branch_code=$${params.length}`; }
    sql += ' ORDER BY service_key, day_of_month';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// PUT /api/scheduler/forecasts  { month, branch_code, service_key, day, qty }
router.put('/forecasts', requirePermission('forecast.manage'), async (req, res) => {
  try {
    const { month, branch_code, service_key, day, qty } = req.body || {};
    if (!month || !service_key || !day) return res.status(400).json({ error: 'month/service_key/day richiesti' });
    if (await branchDenied(req, res, branch_code || 'DLO1')) return;
    const m = monthStart(month);
    await pool.query(
      `INSERT INTO schedule_forecasts (schedule_month, branch_code, service_key, day_of_month, qty, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (schedule_month, branch_code, service_key, day_of_month)
       DO UPDATE SET qty=EXCLUDED.qty, updated_by=EXCLUDED.updated_by, updated_at=now()`,
      [m, branch_code || 'DLO1', service_key, day, +qty || 0, req.user.username]
    );
    await logSchedulerAction(req.user.username, m, branch_code, `Forecast ${service_key} g${day}=${qty}`);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// POST /api/scheduler/forecasts/bulk  { month, branch_code, items: [{service_key,day,qty}] }
router.post('/forecasts/bulk', requirePermission('forecast.manage'), async (req, res) => {
  try {
    const { month, branch_code = 'DLO1', items = [] } = req.body || {};
    if (!month) return res.status(400).json({ error: 'month richiesto' });
    if (await branchDenied(req, res, branch_code)) return;
    const m = monthStart(month);
    let saved = 0;
    await withTx(async (c) => {
      for (const it of items) {
        if (!it.service_key || !it.day) continue;
        await c.query(
          `INSERT INTO schedule_forecasts (schedule_month, branch_code, service_key, day_of_month, qty, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (schedule_month, branch_code, service_key, day_of_month)
           DO UPDATE SET qty=EXCLUDED.qty, updated_by=EXCLUDED.updated_by, updated_at=now()`,
          [m, branch_code, it.service_key, it.day, +it.qty || 0, req.user.username]
        );
        saved++;
      }
    });
    await audit(req, 'config', null, 'update', `Bulk forecast ${m} ${branch_code}: ${saved} righe`);
    res.json({ ok: true, saved });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────
// CONFIG  (shift codes, services, contracts, etc.)
// ─────────────────────────────────────────────────────────

// GET /api/scheduler/config?branch=DLO1&key=codes
router.get('/config', async (req, res) => {
  try {
    const params = [req.query.branch || 'DLO1'];
    let sql = 'SELECT config_key, config_value, updated_at FROM scheduler_config WHERE branch_code=$1';
    if (req.query.key) { params.push(req.query.key); sql += ` AND config_key=$${params.length}`; }
    sql += ' ORDER BY config_key';
    const { rows } = await pool.query(sql, params);
    // Return as { key: value } map for easy frontend consumption
    const out = {};
    for (const r of rows) out[r.config_key] = r.config_value;
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/scheduler/config  { branch_code, key, value }
router.put('/config', requirePermission('config.manage'), async (req, res) => {
  try {
    const { branch_code = 'DLO1', key, value } = req.body || {};
    if (!key || value === undefined) return res.status(400).json({ error: 'key e value richiesti' });
    // Invariant: when saving the services list on its own, prune each count[] to
    // the branch's current master codes (services[].count ⊆ codes[].code).
    let toStore = value;
    if (key === 'services' && Array.isArray(value)) {
      const { rows } = await pool.query(
        "SELECT config_value FROM scheduler_config WHERE branch_code=$1 AND config_key='codes'", [branch_code]);
      const codes = Array.isArray(rows[0] && rows[0].config_value) ? rows[0].config_value : [];
      toStore = pruneServiceCounts(value, codes).services;
    }
    await pool.query(
      `INSERT INTO scheduler_config (branch_code, config_key, config_value, updated_by)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (branch_code, config_key)
       DO UPDATE SET config_value=EXCLUDED.config_value, updated_by=EXCLUDED.updated_by, updated_at=now()`,
      [branch_code, key, JSON.stringify(toStore), req.user.username]
    );
    await audit(req, 'config', null, 'update', `Scheduler config ${branch_code}.${key} aggiornato`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/scheduler/config/import  — import a full state.config object
// { branch_code, config: { codes:[…], services:[…], contracts:[…], … } }
router.post('/config/import', requirePermission('config.manage'), async (req, res) => {
  try {
    const { branch_code = 'DLO1', config } = req.body || {};
    if (!config) return res.status(400).json({ error: 'config richiesta' });
    // Invariant: services[].count ⊆ codes[].code. Safely prune stale references
    // before persisting (never reject the whole config for stale codes). Only
    // acts when both keys are present in this import.
    if (Array.isArray(config.services) && Array.isArray(config.codes)) {
      config.services = pruneServiceCounts(config.services, config.codes).services;
    }
    const keys = Object.keys(config);
    await withTx(async (c) => {
      for (const key of keys) {
        await c.query(
          `INSERT INTO scheduler_config (branch_code, config_key, config_value, updated_by)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (branch_code, config_key)
           DO UPDATE SET config_value=EXCLUDED.config_value, updated_by=EXCLUDED.updated_by, updated_at=now()`,
          [branch_code, key, JSON.stringify(config[key]), req.user.username]
        );
      }
    });
    // Keep the derived reference tables in step with scheduler_config. These run
    // AFTER the (committed) scheduler_config write, so a sync failure never rolls
    // back the config — the import is idempotent and safe to retry. But a sync
    // failure MUST be surfaced: previously it was only warn-logged and the
    // endpoint still returned ok:true, so the employee form's Filiale/Servizio/
    // Codice tables could stay empty while the UI looked healthy. We now collect
    // the failures and, if any REQUESTED sync failed, respond non-2xx so the
    // client (and operator) see it.
    let vocab = null;
    let org = null;
    const syncErrors = [];
    if (config.codes || config.contracts) {                       // codes/contracts -> shift_codes/contract_types
      try {
        const { syncShiftVocab } = require('../../scripts/sync-shift-vocab');
        vocab = await syncShiftVocab(branch_code);
      } catch (e) {
        logger.error('scheduler', 'vocab sync after config import failed: ' + e.message);
        syncErrors.push({ sync: 'shift', error: e.message });
      }
    }
    if (config.filiali || config.filDetails || config.services) { // filiali/services -> branches/service_types
      try {
        const { syncOrgVocab } = require('../../scripts/sync-org-vocab');
        org = await syncOrgVocab(branch_code);
      } catch (e) {
        logger.error('scheduler', 'org sync after config import failed: ' + e.message);
        syncErrors.push({ sync: 'org', error: e.message });
      }
    }
    await audit(req, 'config', null, 'update', `Config import ${branch_code}: ${keys.length} keys`);
    if (syncErrors.length) {
      // scheduler_config committed, but a reference-table sync failed → 502 so the
      // caller does not treat master-data population as successful. Retryable.
      return res.status(502).json({
        ok: false, imported: keys.length, vocab, org, syncErrors,
        error: 'Sincronizzazione tabelle di riferimento fallita: ' +
          syncErrors.map((s) => s.sync + ': ' + s.error).join('; '),
      });
    }
    res.json({ ok: true, imported: keys.length, vocab, org });
  } catch (e) { logger.error('scheduler', 'config import error', e); res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────
// RULE ENGINE  (configurable scheduling rules)
// The automatic generator (frontend generator.js) loads these and evaluates
// every candidate against them. Admin-managed; never hardcoded.
// ─────────────────────────────────────────────────────────

// GET /api/scheduler/rules  — all rules (enabled first, by priority)
router.get('/rules', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM scheduling_rules ORDER BY priority, id');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/scheduler/rules  — create a custom rule
router.post('/rules', requirePermission('config.manage'), async (req, res) => {
  try {
    const { code, name, description, action, priority, enabled, params } = req.body || {};
    if (!code || !name) return res.status(400).json({ error: 'code e name richiesti' });
    const { rows } = await pool.query(
      `INSERT INTO scheduling_rules (code,name,description,action,priority,enabled,params,builtin,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,FALSE,$8) RETURNING *`,
      [code, name, description || null, action || 'skip', priority != null ? priority : 100,
       enabled !== false, JSON.stringify(params || {}), req.user.username]);
    await audit(req, 'config', rows[0].id, 'create', 'Regola pianificazione: ' + name);
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/scheduler/rules/:id  — update (enable/disable, priority, params…)
router.put('/rules/:id', requirePermission('config.manage'), async (req, res) => {
  try {
    const b = req.body || {};
    const { rows } = await pool.query(
      `UPDATE scheduling_rules SET
         name = COALESCE($1,name), description = COALESCE($2,description),
         action = COALESCE($3,action), priority = COALESCE($4,priority),
         enabled = COALESCE($5,enabled), params = COALESCE($6,params), updated_at = now()
       WHERE id = $7 RETURNING *`,
      [b.name || null, b.description || null, b.action || null,
       b.priority != null ? b.priority : null, b.enabled != null ? b.enabled : null,
       b.params != null ? JSON.stringify(b.params) : null, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Regola non trovata' });
    await audit(req, 'config', req.params.id, 'update', 'Regola pianificazione: ' + rows[0].name);
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/scheduler/rules/:id  — custom rules only
router.delete('/rules/:id', requirePermission('config.manage'), async (req, res) => {
  try {
    const chk = await pool.query('SELECT builtin, name FROM scheduling_rules WHERE id=$1', [req.params.id]);
    if (!chk.rows[0]) return res.status(404).json({ error: 'Regola non trovata' });
    if (chk.rows[0].builtin) return res.status(400).json({ error: 'Le regole predefinite non si eliminano (puoi disabilitarle)' });
    await pool.query('DELETE FROM scheduling_rules WHERE id=$1', [req.params.id]);
    await audit(req, 'config', req.params.id, 'delete', 'Regola eliminata: ' + chk.rows[0].name);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────
// SCHEDULE VERSIONS  (snapshot history: save / list / restore / compare)
// ─────────────────────────────────────────────────────────

// GET /api/scheduler/versions?month=YYYY-MM&branch=DLO1  — list (no snapshot)
router.get('/versions', async (req, res) => {
  try {
    const params = [];
    let sql = 'SELECT id, schedule_month, branch_code, label, coverage_pct, created_by, created_at FROM schedule_versions WHERE 1=1';
    if (req.query.month) { params.push(monthStart(req.query.month)); sql += ` AND schedule_month=$${params.length}`; }
    if (req.query.branch) { params.push(req.query.branch); sql += ` AND branch_code=$${params.length}`; }
    sql += ' ORDER BY created_at DESC LIMIT 100';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// GET /api/scheduler/versions/:id  — full snapshot (for restore / compare)
router.get('/versions/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM schedule_versions WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Versione non trovata' });
    res.json(rows[0]);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// POST /api/scheduler/versions  { month, branch_code, label, snapshot, coverage_pct }
router.post('/versions', requirePermission('schedule.manage'), async (req, res) => {
  try {
    const { month, branch_code, label, snapshot, coverage_pct } = req.body || {};
    if (!month || !snapshot) return res.status(400).json({ error: 'month e snapshot richiesti' });
    if (branch_code && await branchDenied(req, res, branch_code)) return;
    // Auto-number the label if not provided ("Luglio 2026 v3").
    let lbl = label;
    if (!lbl) {
      const c = await pool.query('SELECT count(*)::int AS n FROM schedule_versions WHERE schedule_month=$1 AND branch_code IS NOT DISTINCT FROM $2',
        [monthStart(month), branch_code || null]);
      lbl = 'v' + (c.rows[0].n + 1);
    }
    const { rows } = await pool.query(
      `INSERT INTO schedule_versions (schedule_month, branch_code, label, snapshot, coverage_pct, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, schedule_month, branch_code, label, coverage_pct, created_by, created_at`,
      [monthStart(month), branch_code || null, lbl, JSON.stringify(snapshot), coverage_pct != null ? coverage_pct : null, req.user.username]);
    await audit(req, 'schedule', rows[0].id, 'create', `Versione salvata: ${lbl} (${branch_code || 'tutte'} ${month})`);
    res.status(201).json(rows[0]);
  } catch (e) { logger.error('scheduler', 'save version error', e); res.status(500).json({ error: e.message }); }
});

// DELETE /api/scheduler/versions/:id
router.delete('/versions/:id', requirePermission('schedule.manage'), async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM schedule_versions WHERE id=$1 RETURNING label', [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Versione non trovata' });
    await audit(req, 'schedule', req.params.id, 'delete', 'Versione eliminata: ' + r.rows[0].label);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────
// FULL MONTH SNAPSHOT  (replaces the single localStorage.getItem(lsKey(YM)) call)
// GET /api/scheduler/month?month=YYYY-MM&branch=DLO1
// Returns { drivers, schedule, forecasts, config } — exactly the shape of state{}
// ─────────────────────────────────────────────────────────
router.get('/month', async (req, res) => {
  try {
    const month = monthStart(req.query.month);
    // Empty branch ('') means ALL branches (spec §17 "Tutte le filiali").
    const branch = req.query.branch != null ? String(req.query.branch) : 'DLO1';
    // Automatic engine: lazily materialize this month's contract working days
    // (per-employee, idempotent, only employees not yet generated). Guarded so
    // a generation problem can never block loading the board.
    try { await ensureMonth(month, branch); }
    catch (e) { logger.error('autoschedule', 'ensureMonth', e); }
    const [drivers, entries, forecasts, config] = await Promise.all([
      // Single source of truth (spec §14): the scheduler roster IS the
      // employees table. Mapped to the driver shape the frontend expects, so
      // no client change is needed. Archived employees are hidden; status is
      // carried through so Active/Inactive stays in sync across modules.
      pool.query(
        `SELECT e.id AS id,
                e.last_name  AS cognome,
                e.first_name AS nome,
                COALESCE(b.code,'') AS filiale,
                st.name  AS service,
                ct.code  AS contratto,
                CASE WHEN e.contract_end_date IS NOT NULL THEN 'determinato' ELSE 'indeterminato' END AS ctr_type,
                -- Return the bare calendar date (not a timestamp) so the client
                -- never mis-parses it: a raw DATE is serialized in the server's
                -- timezone (e.g. 2026-08-16 → "2026-08-15T22:00:00Z"), which
                -- breaks afterExpiry() and shifts the day. to_char pins the
                -- exact stored day with no timezone conversion.
                to_char(e.contract_end_date, 'YYYY-MM-DD') AS expiry_date,
                COALESCE(e.work_days, ARRAY[1,2,3,4,5]) AS work_days,
                COALESCE(e.default_shift_code, (e.default_shift_codes)[1]) AS default_code,
                e.status AS status,
                e.transporter_id AS transporter_id,
                e.device AS device,
                e.hire_date AS hire_date,
                e.id AS employee_id
           FROM employees e
           LEFT JOIN branches b       ON b.id  = e.branch_id
           LEFT JOIN service_types st ON st.id = e.service_type_id
           LEFT JOIN contract_types ct ON ct.id = e.contract_type_id
          WHERE COALESCE(e.status,'active') <> 'archived'
            AND ( $1 = ''
                  OR b.code = $1
                  OR EXISTS (SELECT 1 FROM branches b2 WHERE b2.code=$1 AND b2.id = ANY(COALESCE(e.branch_ids, ARRAY[]::int[]))) )
            -- Termination: a contract that ended before this month drops the
            -- employee from future rosters; one starting after it hides them
            -- too. Historical months still show whoever was under contract.
            AND (e.contract_end_date   IS NULL OR e.contract_end_date   >= $2::date)
            AND (e.contract_start_date IS NULL OR e.contract_start_date <  ($2::date + interval '1 month'))
          ORDER BY e.last_name, e.first_name`, [branch, month]),
      pool.query(
        // updated_by holds the login username; resolve it to the human-readable
        // users.full_name so the per-cell tooltip never exposes raw logins.
        //
        // Branch filter MUST match the roster (drivers query above): an employee
        // belongs to a branch via branch_id OR the multi-branch branch_ids array.
        // The engine stamps each row's branch_code from the singular branch_id
        // only, so filtering employee cells on se.branch_code hid the shifts of
        // multi-branch employees (visible under their secondary branch in the
        // roster but with an empty grid), and of any employee whose branch was
        // set via branch_ids with branch_id NULL. So filter employee-linked rows
        // by the employee's branch membership; legacy local_driver rows (no
        // employee_id) still filter on their stamped branch_code.
        `SELECT se.employee_id, se.local_driver_id, se.day_of_month, se.shift_code,
                se.updated_by, se.updated_at, u.full_name AS updated_by_name
           FROM schedule_entries se
           LEFT JOIN users u ON u.username = se.updated_by
           LEFT JOIN employees e ON e.id = se.employee_id
           LEFT JOIN branches b ON b.id = e.branch_id
          WHERE se.schedule_month=$1
            AND ( $2 = ''
                  OR ( se.employee_id IS NOT NULL
                       AND ( b.code = $2
                             OR EXISTS (SELECT 1 FROM branches b2
                                         WHERE b2.code=$2 AND b2.id = ANY(COALESCE(e.branch_ids, ARRAY[]::int[]))) ) )
                  OR ( se.employee_id IS NULL AND se.branch_code = $2 ) )`, [month, branch]),
      pool.query(
        `SELECT service_key, day_of_month, qty
           FROM schedule_forecasts WHERE schedule_month=$1 AND ($2='' OR branch_code=$2)`, [month, branch]),
      pool.query(
        `SELECT config_key, config_value FROM scheduler_config WHERE branch_code=COALESCE(NULLIF($1,''),'DLO1')`, [branch]),
    ]);

    // Reconstruct the state{} shape the scheduler expects
    const scheduleMap = {};
    // Persisted per-cell attribution (#5): last human editor + time, keyed the
    // same way as scheduleMap. Engine-generated cells (updated_by='auto-engine')
    // are excluded so only manual edits/overrides carry a marker after reload.
    // `by` is the human-readable full name (never the raw login); when a user has
    // no full_name recorded it falls back to a neutral label instead of the login.
    const scheduleMeta = {};
    for (const r of entries.rows) {
      const did = r.employee_id || r.local_driver_id;
      if (!scheduleMap[did]) scheduleMap[did] = {};
      scheduleMap[did][r.day_of_month] = r.shift_code;
      if (r.updated_by && r.updated_by !== 'auto-engine') {
        if (!scheduleMeta[did]) scheduleMeta[did] = {};
        scheduleMeta[did][r.day_of_month] = { by: r.updated_by_name || 'Utente', at: r.updated_at };
      }
    }
    const forecastMap = {};
    for (const r of forecasts.rows) {
      if (!forecastMap[r.service_key]) forecastMap[r.service_key] = {};
      forecastMap[r.service_key][r.day_of_month] = r.qty;
    }
    const configMap = {};
    for (const r of config.rows) configMap[r.config_key] = r.config_value;

    res.json({
      meta: { month: req.query.month, branch, source: 'postgresql' },
      drivers: drivers.rows,
      schedule: scheduleMap,
      scheduleMeta,
      forecast: forecastMap,
      config: configMap,
    });
  } catch (e) { logger.error('scheduler', 'month snapshot error', e); res.status(500).json({ error: e.message }); }
});

// POST /api/scheduler/month/import  — import a full localStorage JSON dump
// Body: the raw state{} object as exported from the scheduler (JSON export)
router.post('/month/import', requirePermission('schedule.manage'), async (req, res) => {
  try {
    const { month, branch_code = 'DLO1', state: st } = req.body || {};
    if (!st || !month) return res.status(400).json({ error: 'month e state richiesti' });
    if (await branchDenied(req, res, branch_code)) return;
    const m = monthStart(month);
    let drivers = 0, cells = 0, fc = 0;

    await withTx(async (c) => {
      // Import drivers
      if (st.drivers) {
        for (const d of st.drivers) {
          const { rows } = await c.query(
            `INSERT INTO scheduler_drivers
               (cognome, nome, filiale, service, contratto, ctr_type, expiry_date,
                work_days, default_code, status, transporter_id, device, hire_date, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
             ON CONFLICT DO NOTHING RETURNING id`,
            [d.cognome||'', d.nome||'', d.filiale||branch_code, d.service||null,
             d.contratto||null, d.ctrType||'indeterminato', d.expiry||null,
             d.workDays||[1,2,3,4,5], d.defaultCode||null, d.status||'active',
             d.transporterId||null, d.device||null, d.hireDate||null, req.user.username]
          );
          if (rows[0]) { d._dbId = rows[0].id; drivers++; }
        }
      }
      // Import schedule cells
      if (st.schedule) {
        for (const [rawId, days] of Object.entries(st.schedule)) {
          const driver = st.drivers && st.drivers.find(d => String(d.id) === rawId);
          const locId = driver?._dbId || null;
          for (const [day, code] of Object.entries(days)) {
            if (!code) continue;
            await c.query(
              `INSERT INTO schedule_entries
                 (schedule_month, local_driver_id, day_of_month, shift_code, branch_code, updated_by)
               VALUES ($1,$2,$3,$4,$5,$6)
               ON CONFLICT (local_driver_id, schedule_month, day_of_month) WHERE local_driver_id IS NOT NULL
               DO UPDATE SET shift_code=EXCLUDED.shift_code, updated_by=EXCLUDED.updated_by, updated_at=now()`,
              [m, locId, +day, code, branch_code, req.user.username]
            );
            cells++;
          }
        }
      }
      // Import forecast
      if (st.forecast) {
        for (const [svcKey, days] of Object.entries(st.forecast)) {
          for (const [day, qty] of Object.entries(days)) {
            await c.query(
              `INSERT INTO schedule_forecasts
                 (schedule_month, branch_code, service_key, day_of_month, qty, updated_by)
               VALUES ($1,$2,$3,$4,$5,$6)
               ON CONFLICT (schedule_month, branch_code, service_key, day_of_month)
               DO UPDATE SET qty=EXCLUDED.qty, updated_by=EXCLUDED.updated_by, updated_at=now()`,
              [m, branch_code, svcKey, +day, +qty || 0, req.user.username]
            );
            fc++;
          }
        }
      }
      // Import config
      if (st.config) {
        for (const [key, val] of Object.entries(st.config)) {
          await c.query(
            `INSERT INTO scheduler_config (branch_code, config_key, config_value, updated_by)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (branch_code, config_key)
             DO UPDATE SET config_value=EXCLUDED.config_value, updated_by=EXCLUDED.updated_by, updated_at=now()`,
            [branch_code, key, JSON.stringify(val), req.user.username]
          );
        }
      }
    });
    await audit(req, 'schedule', null, 'create', `Import localStorage ${m} ${branch_code}: ${drivers} drivers, ${cells} celle, ${fc} forecast`);
    res.json({ ok: true, drivers, cells, forecasts: fc });
  } catch (e) { logger.error('scheduler', 'month import error', e); res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────
// AUDIT LOG
// ─────────────────────────────────────────────────────────

// GET /api/scheduler/log?month=YYYY-MM&branch=DLO1&limit=200
router.get('/log', async (req, res) => {
  try {
    const params = [];
    let sql = 'SELECT * FROM schedule_audit_log WHERE 1=1';
    if (req.query.month) { params.push(monthStart(req.query.month)); sql += ` AND schedule_month=$${params.length}`; }
    if (req.query.branch) { params.push(req.query.branch); sql += ` AND branch_code=$${params.length}`; }
    params.push(Math.min(+(req.query.limit || 200), 1000));
    sql += ` ORDER BY logged_at DESC LIMIT $${params.length}`;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
