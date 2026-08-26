// Excel (XLSX) import/export and downloadable templates.
// Uses SheetJS. Imports are admin-only; exports respect branch scope.
const router = require('express').Router();
const multer = require('multer');
const XLSX = require('xlsx');
const { pool, withTx } = require('../db/pool');
const { auth, requireAdmin, loadScope, audit } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
router.use(auth, loadScope);

function sendWorkbook(res, wb, filename) {
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buf);
}
function sheetToWb(rows, sheetName) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return wb;
}
function branchClause(scope, params, col) {
  if (scope.admin) return '';
  if (!scope.branches.length) return ' AND 1=0';
  params.push(scope.branches); return ` AND ${col} = ANY($${params.length})`;
}

// ---------------- TEMPLATES ----------------
// GET /api/xlsx/template/:type  (employees|forecast|schedule)
router.get('/template/:type', async (req, res) => {
  const t = req.params.type;
  if (t === 'employees') {
    const wb = sheetToWb([{
      employee_code: 'EMP001', transporter_id: 'A1B2C3D4E5', first_name: 'Mario', last_name: 'Rossi',
      email: 'mario@example.com', phone: '3331234567', device: 'Samsung A14',
      branch_code: 'DLO1', team_name: 'Team Milano A', service_code: 'NEXT', contract_code: '21',
      work_days: '1,2,3,4,5', hire_date: '2024-03-01',
      contract_start_date: '2024-03-01', contract_end_date: '', status: 'active',
    }], 'Employees');
    return sendWorkbook(res, wb, 'template_employees.xlsx');
  }
  if (t === 'forecast') {
    const wb = sheetToWb([
      { branch_code: 'DLO1', service_code: 'NEXT', forecast_date: '2026-06-15', qty: 120 },
      { branch_code: 'DLO1', service_code: 'SAMEA', forecast_date: '2026-06-15', qty: 40 },
    ], 'Forecast');
    return sendWorkbook(res, wb, 'template_forecast.xlsx');
  }
  if (t === 'schedule') {
    const wb = sheetToWb([
      { employee_code: 'EMP001', work_date: '2026-06-15', shift_code: 'X' },
      { employee_code: 'EMP001', work_date: '2026-06-16', shift_code: 'OFF' },
    ], 'Schedule');
    return sendWorkbook(res, wb, 'template_schedule.xlsx');
  }
  res.status(400).json({ error: 'Tipo non valido' });
});

// ---------------- IMPORTS (admin) ----------------
function readRows(file) {
  const wb = XLSX.read(file.buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: null });
}
function isoDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

// POST /api/xlsx/import/employees
router.post('/import/employees', requireAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File mancante' });
  const rows = readRows(req.file);
  // resolve lookups once
  const branches = (await pool.query('SELECT id,code FROM branches')).rows;
  const teams = (await pool.query('SELECT id,name FROM teams')).rows;
  const services = (await pool.query('SELECT id,code FROM service_types')).rows;
  const contracts = (await pool.query('SELECT id,code FROM contract_types')).rows;
  const find = (arr, key, val) => arr.find(x => String(x[key]).toLowerCase() === String(val || '').toLowerCase());
  let added = 0, skipped = 0;
  await withTx(async (c) => {
    for (const r of rows) {
      if (!r.first_name && !r.last_name) { skipped++; continue; }
      const br = find(branches, 'code', r.branch_code);
      const tm = find(teams, 'name', r.team_name);
      const sv = find(services, 'code', r.service_code);
      const ct = find(contracts, 'code', r.contract_code);
      // Working days drive the schedule (not hours). Accept them from the file.
      const wd = r.work_days ? String(r.work_days).split(/[, ]+/).map(Number).filter(n => n >= 1 && n <= 7) : [1, 2, 3, 4, 5];
      await c.query(
        `INSERT INTO employees (employee_code,transporter_id,first_name,last_name,email,phone,device,
           branch_id,team_id,service_type_id,contract_type_id,work_days,
           hire_date,contract_start_date,contract_end_date,status,added_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,COALESCE($16,'active'),$17)`,
        [r.employee_code || null, r.transporter_id || null, r.first_name || '', r.last_name || '',
         r.email || null, r.phone || null, r.device || null,
         br ? br.id : null, tm ? tm.id : null, sv ? sv.id : null, ct ? ct.id : null,
         wd,
         isoDate(r.hire_date), isoDate(r.contract_start_date), isoDate(r.contract_end_date),
         r.status || null, req.user.username]
      );
      added++;
    }
  });
  await audit(req, 'employee', null, 'create', `Import XLSX: ${added} dipendenti (${skipped} saltati)`);
  res.json({ added, skipped });
});

// POST /api/xlsx/import/forecast
router.post('/import/forecast', requireAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File mancante' });
  const rows = readRows(req.file);
  const branches = (await pool.query('SELECT id,code FROM branches')).rows;
  const services = (await pool.query('SELECT id,code FROM service_types')).rows;
  const find = (arr, val) => arr.find(x => String(x.code).toLowerCase() === String(val || '').toLowerCase());
  let added = 0, skipped = 0;
  await withTx(async (c) => {
    for (const r of rows) {
      const br = find(branches, r.branch_code), sv = find(services, r.service_code), d = isoDate(r.forecast_date);
      if (!br || !sv || !d) { skipped++; continue; }
      await c.query(
        `INSERT INTO forecasts (branch_id,service_type_id,forecast_date,qty,updated_by)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (branch_id,service_type_id,forecast_date)
         DO UPDATE SET qty=EXCLUDED.qty, updated_by=EXCLUDED.updated_by, updated_at=now()`,
        [br.id, sv.id, d, +r.qty || 0, req.user.username]);
      added++;
    }
  });
  await audit(req, 'config', null, 'update', `Import XLSX forecast: ${added} righe`);
  res.json({ added, skipped });
});

// POST /api/xlsx/import/schedule
router.post('/import/schedule', requireAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File mancante' });
  const rows = readRows(req.file);
  const emps = (await pool.query('SELECT id,employee_code FROM employees')).rows;
  const byCode = {}; emps.forEach(e => { if (e.employee_code) byCode[e.employee_code.toLowerCase()] = e.id; });
  let added = 0, skipped = 0;
  await withTx(async (c) => {
    for (const r of rows) {
      const id = byCode[String(r.employee_code || '').toLowerCase()]; const d = isoDate(r.work_date);
      if (!id || !d) { skipped++; continue; }
      if (!r.shift_code) {
        await c.query(
          `DELETE FROM schedule_entries WHERE employee_id=$1
             AND schedule_month=date_trunc('month',$2::date)::date
             AND day_of_month=EXTRACT(DAY FROM $2::date)::int`, [id, d]);
      } else await c.query(
        `INSERT INTO schedule_entries (schedule_month, employee_id, day_of_month, shift_code, branch_code, updated_by)
         VALUES (date_trunc('month',$2::date)::date, $1, EXTRACT(DAY FROM $2::date)::int, $3,
                 (SELECT b.code FROM employees e LEFT JOIN branches b ON b.id=e.branch_id WHERE e.id=$1), $4)
         ON CONFLICT (employee_id, schedule_month, day_of_month) WHERE employee_id IS NOT NULL
         DO UPDATE SET shift_code=EXCLUDED.shift_code, updated_by=EXCLUDED.updated_by, updated_at=now()`,
        [id, d, String(r.shift_code), req.user.username]);
      added++;
    }
  });
  await audit(req, 'schedule', null, 'update', `Import XLSX turni: ${added} righe`);
  res.json({ added, skipped });
});

// ---------------- EXPORTS (scoped) ----------------
// GET /api/xlsx/export/employees
router.get('/export/employees', async (req, res) => {
  const params = []; const bc = branchClause(req.scope, params, 'e.branch_id');
  const { rows } = await pool.query(
    `SELECT e.employee_code,e.transporter_id,e.first_name,e.last_name,e.email,e.phone,e.device,
            b.code branch_code,t.name team_name,st.code service_code,ct.code contract_code,
            array_to_string(e.work_days,',') work_days,
            e.hire_date,e.contract_start_date,e.contract_end_date,e.status
       FROM employees e
       LEFT JOIN branches b ON b.id=e.branch_id LEFT JOIN teams t ON t.id=e.team_id
       LEFT JOIN service_types st ON st.id=e.service_type_id LEFT JOIN contract_types ct ON ct.id=e.contract_type_id
      WHERE 1=1 ${bc} ORDER BY e.last_name,e.first_name`, params);
  await audit(req, 'employee', null, 'export', `Export XLSX dipendenti (${rows.length})`);
  sendWorkbook(res, sheetToWb(rows, 'Employees'), 'employees.xlsx');
});

// GET /api/xlsx/export/forecast?from=&to=
router.get('/export/forecast', async (req, res) => {
  const { from, to } = req.query; if (!from || !to) return res.status(400).json({ error: 'from/to richiesti' });
  const params = [from, to]; const bc = branchClause(req.scope, params, 'f.branch_id');
  const bcVf = branchClause(req.scope, params, 'vf.branch_id');
  // Scheduler-wins reconciliation (schedule_forecasts via v_forecast_days keyed by
  // service_key = service_types.code); HR fills only gaps. Scheduler-only keys
  // export under their service_key as service_code.
  const { rows } = await pool.query(
    `WITH hr AS (
       SELECT b.code AS branch_code, st.code AS code, f.forecast_date AS d, f.qty::int AS qty
         FROM forecasts f JOIN branches b ON b.id=f.branch_id JOIN service_types st ON st.id=f.service_type_id
        WHERE f.forecast_date BETWEEN $1 AND $2 ${bc}),
     sc AS (
       SELECT vf.branch_code, vf.service_key AS code, vf.forecast_date AS d, vf.qty::int AS qty
         FROM v_forecast_days vf
        WHERE vf.forecast_date BETWEEN $1 AND $2 ${bcVf})
     SELECT branch_code, code AS service_code, d AS forecast_date, qty FROM sc
     UNION ALL
     SELECT hr.branch_code, hr.code, hr.d, hr.qty FROM hr LEFT JOIN sc
       ON sc.branch_code=hr.branch_code AND sc.code=hr.code AND sc.d=hr.d WHERE sc.code IS NULL
     ORDER BY forecast_date`, params);
  sendWorkbook(res, sheetToWb(rows, 'Forecast'), 'forecast.xlsx');
});

// GET /api/xlsx/export/schedule?from=&to=
router.get('/export/schedule', async (req, res) => {
  const { from, to } = req.query; if (!from || !to) return res.status(400).json({ error: 'from/to richiesti' });
  const params = [from, to]; const bc = branchClause(req.scope, params, 'e.branch_id');
  const { rows } = await pool.query(
    `SELECT e.employee_code, e.last_name, e.first_name, b.code branch_code, s.work_date, s.shift_code
       FROM v_schedule_days s JOIN employees e ON e.id=s.employee_id JOIN branches b ON b.id=e.branch_id
      WHERE s.work_date BETWEEN $1 AND $2 ${bc} ORDER BY e.last_name, s.work_date`, params);
  sendWorkbook(res, sheetToWb(rows, 'Schedule'), 'schedule.xlsx');
});

// ---------------- SCHEDULER FORECAST (schedule_forecasts) ----------------
// The Settings → Forecast editor writes to schedule_forecasts, keyed by
// service_key + month/day, with the service list coming from scheduler_config.
// The /export/forecast + /import/forecast pair above targets the *other*
// (HR `forecasts`) table, so on its own it can't round-trip what the editor
// shows. These two endpoints do, in a month grid that mirrors the source
// spreadsheet: one row per service, one column per day ("Dom 05").

const DOW_IT = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
function monthMeta(month) {
  const [y, m] = String(month).split('-').map(Number);
  return { y, m, days: new Date(y, m, 0).getDate(), first: `${month}-01` };
}

// GET /api/xlsx/export/scheduler-forecast?month=YYYY-MM&branch=DLO1
router.get('/export/scheduler-forecast', async (req, res) => {
  const month = String(req.query.month || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month (YYYY-MM) richiesto' });
  const branch = req.query.branch || 'DLO1';
  const { y, m, days, first } = monthMeta(month);

  const { rows } = await pool.query(
    `SELECT service_key, day_of_month, qty FROM schedule_forecasts
      WHERE schedule_month = $1::date AND branch_code = $2`, [first, branch]);
  const cfg = await pool.query(
    `SELECT config_value FROM scheduler_config
      WHERE branch_code = $1 AND config_key = 'services' LIMIT 1`, [branch]);
  const defs = (cfg.rows[0] && cfg.rows[0].config_value) || [];

  const byKey = {};
  for (const r of rows) {
    if (!byKey[r.service_key]) byKey[r.service_key] = {};
    byKey[r.service_key][r.day_of_month] = r.qty;
  }
  // Configured services first, plus any stray key that only exists in data.
  const keys = [...new Set([...defs.map((d) => d.key), ...Object.keys(byKey)])];
  const labelOf = (k) => (defs.find((d) => d.key === k) || {}).label || k;

  const out = keys.map((k) => {
    const row = { service_key: k, service_label: labelOf(k) };
    for (let d = 1; d <= days; d++) {
      const dow = DOW_IT[new Date(y, m - 1, d).getDay()];
      row[`${dow} ${String(d).padStart(2, '0')}`] =
        (byKey[k] && byKey[k][d] != null) ? byKey[k][d] : '';
    }
    return row;
  });
  await audit(req, 'config', null, 'export', `Export XLSX forecast ${branch} ${month}`);
  sendWorkbook(res, sheetToWb(out, 'Forecast'), `forecast_${branch}_${month}.xlsx`);
});

// POST /api/xlsx/import/scheduler-forecast   (month + branch as form fields)
router.post('/import/scheduler-forecast', requireAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File mancante' });
  const month = String(req.body.month || req.query.month || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month (YYYY-MM) richiesto' });
  const branch = req.body.branch || req.query.branch || 'DLO1';
  const { days, first } = monthMeta(month);

  const rows = readRows(req.file);
  let saved = 0, skipped = 0;
  await withTx(async (c) => {
    for (const r of rows) {
      const key = r.service_key || r.Servizio || r.service || null;
      if (!key) { skipped++; continue; }
      for (const [col, val] of Object.entries(r)) {
        if (col === 'service_key' || col === 'service_label') continue;
        // Day columns end in the day number ("Dom 05", "5", "05")
        const hit = String(col).match(/(\d{1,2})\s*$/);
        if (!hit) continue;
        const day = +hit[1];
        if (!(day >= 1 && day <= days)) continue;
        if (val === '' || val === null || val === undefined) continue;
        const qty = Number(val);
        if (!Number.isFinite(qty)) continue;
        await c.query(
          `INSERT INTO schedule_forecasts
             (schedule_month, branch_code, service_key, day_of_month, qty, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (schedule_month, branch_code, service_key, day_of_month)
           DO UPDATE SET qty = EXCLUDED.qty, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [first, branch, String(key), day, qty, req.user.username]);
        saved++;
      }
    }
  });
  await audit(req, 'config', null, 'update', `Import XLSX forecast ${branch} ${month}: ${saved} celle`);
  res.json({ saved, skipped });
});

module.exports = router;
