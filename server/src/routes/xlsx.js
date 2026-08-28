// Excel (XLSX) import/export and downloadable templates.
// Uses ExcelJS. Imports are admin-only; exports respect branch scope.
const router = require('express').Router();
const multer = require('multer');
const ExcelJS = require('exceljs');
const { pool, withTx } = require('../db/pool');
const { auth, requireAdmin, loadScope, audit } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
router.use(auth, loadScope);

async function sendWorkbook(res, wb, filename) {
  const buf = await wb.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(Buffer.from(buf));
}
function sheetToWb(rows, sheetName) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  // Column order = union of row keys in first-appearance order (matches the
  // previous SheetJS json_to_sheet). Header row is the keys; addRow maps by key.
  const keys = [];
  rows.forEach((r) => Object.keys(r).forEach((k) => { if (!keys.includes(k)) keys.push(k); }));
  if (keys.length) {
    ws.columns = keys.map((k) => ({ header: k, key: k }));
    rows.forEach((r) => ws.addRow(r));
  }
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
    return await sendWorkbook(res, wb, 'template_employees.xlsx');
  }
  if (t === 'forecast') {
    const wb = sheetToWb([
      { branch_code: 'DLO1', service_code: 'NEXT', forecast_date: '2026-06-15', qty: 120 },
      { branch_code: 'DLO1', service_code: 'SAMEA', forecast_date: '2026-06-15', qty: 40 },
    ], 'Forecast');
    return await sendWorkbook(res, wb, 'template_forecast.xlsx');
  }
  if (t === 'schedule') {
    const wb = sheetToWb([
      { employee_code: 'EMP001', work_date: '2026-06-15', shift_code: 'X' },
      { employee_code: 'EMP001', work_date: '2026-06-16', shift_code: 'OFF' },
    ], 'Schedule');
    return await sendWorkbook(res, wb, 'template_schedule.xlsx');
  }
  res.status(400).json({ error: 'Tipo non valido' });
});

// ---------------- IMPORTS (admin) ----------------
// Normalize an ExcelJS cell value to a primitive (rich text / hyperlink /
// formula → their displayed value). Empty cells arrive as null.
function cellVal(v) {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return v.text;        // hyperlink { text, hyperlink }
    if ('result' in v) return v.result;    // formula  { formula, result }
    return v;
  }
  return v;
}
// Read the first sheet into an array of objects keyed by the header row, with
// missing cells as null and fully-blank rows skipped — matches the previous
// SheetJS sheet_to_json(ws, { defval: null }) behavior.
async function readRows(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file.buffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const cols = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    const name = cellVal(cell.value);
    if (name != null && name !== '') cols.push({ col, name: String(name) });
  });
  const out = [];
  for (let i = 2; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);
    const obj = {}; let any = false;
    for (const { col, name } of cols) {
      let v = cellVal(row.getCell(col).value);
      if (v === undefined) v = null;
      obj[name] = v;
      if (v != null && v !== '') any = true;
    }
    if (any) out.push(obj);
  }
  return out;
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
  const rows = await readRows(req.file);
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
  const rows = await readRows(req.file);
  const branches = (await pool.query('SELECT id,code FROM branches')).rows;
  const services = (await pool.query('SELECT id,code FROM service_types')).rows;
  const find = (arr, val) => arr.find(x => String(x.code).toLowerCase() === String(val || '').toLowerCase());
  let added = 0, skipped = 0;
  await withTx(async (c) => {
    for (const r of rows) {
      const br = find(branches, r.branch_code), sv = find(services, r.service_code), d = isoDate(r.forecast_date);
      if (!br || !sv || !d) { skipped++; continue; }
      // Forecast consolidation: import into schedule_forecasts (single source of
      // truth, read back via v_forecast_days). The lookups already resolved the
      // branch/service to their codes, which ARE the scheduler keys (branch_code
      // and service_key = service_types.code); forecast_date maps to
      // (schedule_month, day_of_month).
      await c.query(
        `INSERT INTO schedule_forecasts (schedule_month, branch_code, service_key, day_of_month, qty, updated_by)
         VALUES (date_trunc('month',$1::date)::date, $2, $3, EXTRACT(DAY FROM $1::date)::int, $4, $5)
         ON CONFLICT (schedule_month, branch_code, service_key, day_of_month)
         DO UPDATE SET qty=EXCLUDED.qty, updated_by=EXCLUDED.updated_by, updated_at=now()`,
        [d, br.code, sv.code, +r.qty || 0, req.user.username]);
      added++;
    }
  });
  await audit(req, 'config', null, 'update', `Import XLSX forecast: ${added} righe`);
  res.json({ added, skipped });
});

// POST /api/xlsx/import/schedule
router.post('/import/schedule', requireAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File mancante' });
  const rows = await readRows(req.file);
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
  await sendWorkbook(res, sheetToWb(rows, 'Employees'), 'employees.xlsx');
});

// GET /api/xlsx/export/forecast?from=&to=
router.get('/export/forecast', async (req, res) => {
  const { from, to } = req.query; if (!from || !to) return res.status(400).json({ error: 'from/to richiesti' });
  const params = [from, to];
  const bcVf = branchClause(req.scope, params, 'vf.branch_id');
  // Forecast from the single source of truth: schedule_forecasts via
  // v_forecast_days. Scheduler-only keys export under their service_key. (The
  // legacy HR `forecasts` fallback leg was removed after the backfill made it
  // redundant.)
  const { rows } = await pool.query(
    `SELECT vf.branch_code, vf.service_key AS service_code,
            vf.forecast_date AS forecast_date, vf.qty::int AS qty
       FROM v_forecast_days vf
      WHERE vf.forecast_date BETWEEN $1 AND $2 ${bcVf}
      ORDER BY forecast_date`, params);
  await sendWorkbook(res, sheetToWb(rows, 'Forecast'), 'forecast.xlsx');
});

// GET /api/xlsx/export/schedule?from=&to=
router.get('/export/schedule', async (req, res) => {
  const { from, to } = req.query; if (!from || !to) return res.status(400).json({ error: 'from/to richiesti' });
  const params = [from, to]; const bc = branchClause(req.scope, params, 'e.branch_id');
  const { rows } = await pool.query(
    `SELECT e.employee_code, e.last_name, e.first_name, b.code branch_code, s.work_date, s.shift_code
       FROM v_schedule_days s JOIN employees e ON e.id=s.employee_id JOIN branches b ON b.id=e.branch_id
      WHERE s.work_date BETWEEN $1 AND $2 ${bc} ORDER BY e.last_name, s.work_date`, params);
  await sendWorkbook(res, sheetToWb(rows, 'Schedule'), 'schedule.xlsx');
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
  await sendWorkbook(res, sheetToWb(out, 'Forecast'), `forecast_${branch}_${month}.xlsx`);
});

// POST /api/xlsx/import/scheduler-forecast   (month + branch as form fields)
router.post('/import/scheduler-forecast', requireAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File mancante' });
  const month = String(req.body.month || req.query.month || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month (YYYY-MM) richiesto' });
  const branch = req.body.branch || req.query.branch || 'DLO1';
  const { days, first } = monthMeta(month);

  const rows = await readRows(req.file);
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
