// Excel (XLSX) import/export and downloadable templates.
// Uses ExcelJS. Imports are admin-only; exports respect branch scope.
const router = require('express').Router();
const multer = require('multer');
const ExcelJS = require('exceljs');
const { pool, withTx } = require('../db/pool');
const { auth, requireAdmin, loadScope, audit } = require('../middleware/auth');
const { requirePermission, roleAllowed } = require('../middleware/rbac');
const { createEmployee, updateEmployee } = require('../services/employeeWrite');
const { regenerateEmployee } = require('../services/autoschedule');
const logger = require('../utils/logger');

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

// ============================================================
// Employee Excel — shared template / export / import definitions.
// One column contract used by the template, the export and the importer so a
// file round-trips. Headers are the app's Italian terminology.
// ============================================================

// Supported employee statuses (mirror database/schema/01_schema.sql default +
// the status the app writes). Not master data — a fixed, small enum.
const EMP_STATUSES = ['active', 'inactive', 'pending'];

// key = the Excel header (exact string in the file). Business rule: an employee
// has EXACTLY ONE Filiale, ONE Servizio and ONE Codice turno — so these are
// single-value columns (no multi-branch / branch_ids input). All three are
// required for a new employee.
const EMP_COLS = [
  { key: 'Codice dipendente', width: 18, note: 'Chiave per CREATE/UPDATE. Vuoto = nuovo dipendente.' },
  { key: 'Cognome', width: 16, required: true },
  { key: 'Nome', width: 16, required: true },
  { key: 'Email', width: 22 },
  { key: 'Telefono', width: 15 },
  { key: 'Transporter ID', width: 16 },
  { key: 'Device', width: 14 },
  { key: 'Filiale', width: 14, dd: 'branches', requiredOnCreate: true, note: 'Filiale (codice). Obbligatoria.' },
  { key: 'Servizio', width: 14, dd: 'services', requiredOnCreate: true, note: 'Servizio (codice). Obbligatorio.' },
  { key: 'Codice turno', width: 14, dd: 'shifts', requiredOnCreate: true, note: 'Codice turno. Obbligatorio.' },
  { key: 'Contratto', width: 14, dd: 'contracts', note: 'Codice tipo contratto.' },
  { key: 'Team', width: 16, note: 'Nome team (deve esistere).' },
  { key: 'Giorni lavorativi', width: 16, note: 'Numeri 1-7 separati da virgola (1=Lun). Default 1,2,3,4,5.' },
  { key: 'Data assunzione', width: 14, note: 'Formato AAAA-MM-GG.' },
  { key: 'Data inizio contratto', width: 16, note: 'Formato AAAA-MM-GG.' },
  { key: 'Data fine contratto', width: 16, note: 'Formato AAAA-MM-GG. Vuoto = indeterminato.' },
  { key: 'Stato', width: 12, dd: 'status', note: 'active | inactive | pending. Default active.' },
];

// CSV/formula-injection guard: a leading = + - @ (or control char) can be
// interpreted as a formula by spreadsheet apps. Prefix such string values with
// an apostrophe so they are always treated as text. Non-strings pass through.
function safeCell(v) {
  if (typeof v !== 'string') return v;
  return /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
}

// Only accept real .xlsx uploads (extension + magic bytes: xlsx is a ZIP → "PK").
function assertXlsx(file) {
  if (!file) return 'File mancante';
  if (!/\.xlsx$/i.test(file.originalname || '')) return 'Sono ammessi solo file .xlsx';
  const b = file.buffer;
  if (!b || b.length < 4 || b[0] !== 0x50 || b[1] !== 0x4b) return 'File .xlsx non valido';
  return null;
}

const asStr = (v) => (v == null ? '' : String(v).trim());

// Load every master-data lookup the importer/validator needs, once per request.
async function loadEmpMaster() {
  const [branches, services, shifts, contracts, teams, employees] = await Promise.all([
    pool.query('SELECT id, code FROM branches'),
    pool.query('SELECT id, code FROM service_types'),
    pool.query('SELECT code FROM shift_codes'),
    pool.query('SELECT id, code FROM contract_types'),
    pool.query('SELECT id, name FROM teams'),
    pool.query('SELECT id, employee_code FROM employees'),
  ]);
  const map = (rows, k) => { const m = new Map(); rows.forEach((r) => m.set(String(r[k]).toLowerCase(), r)); return m; };
  return {
    branch: map(branches.rows, 'code'),
    service: map(services.rows, 'code'),
    shift: new Set(shifts.rows.map((r) => String(r.code).toLowerCase())),
    contract: map(contracts.rows, 'code'),
    team: map(teams.rows, 'name'),
    empByCode: map(employees.rows.filter((e) => e.employee_code), 'employee_code'),
    shiftCanon: new Map(shifts.rows.map((r) => [String(r.code).toLowerCase(), r.code])),
  };
}

function parseWorkDays(v) {
  const s = asStr(v);
  if (!s) return { ok: true, val: undefined };            // preserve/default
  const nums = s.split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
  if (!nums.length) return { ok: false };
  return { ok: true, val: [...new Set(nums)].sort() };
}
function parseDate(v) {
  if (v == null || v === '') return { ok: true, val: undefined };
  const d = isoDate(v);
  return d ? { ok: true, val: d } : { ok: false };
}

// Validate + build the canonical write body for a single sheet row. Returns
// { rowNum, employee_code, action, errors[], body, targetId }. Pure (no writes).
function validateRow(r, rowNum, master, seenCodes) {
  const errors = [];
  const get = (k) => asStr(r[k]);
  const code = get('Codice dipendente');
  const existing = code ? master.empByCode.get(code.toLowerCase()) : null;
  const action = existing ? 'UPDATE' : 'CREATE';
  const body = {};

  // Duplicate employee_code within the file.
  if (code) {
    const lc = code.toLowerCase();
    if (seenCodes.has(lc)) errors.push(`Codice dipendente "${code}" duplicato nel file`);
    else seenCodes.add(lc);
    body.employee_code = code;
  }

  // Required identity.
  const last = get('Cognome'); const first = get('Nome');
  if (!last) errors.push('Cognome obbligatorio');
  if (!first) errors.push('Nome obbligatorio');
  if (last) body.last_name = last;
  if (first) body.first_name = first;

  // Plain optional text fields — only set when supplied (partial UPDATE).
  for (const [col, field] of [['Email', 'email'], ['Telefono', 'phone'],
    ['Transporter ID', 'transporter_id'], ['Device', 'device']]) {
    const v = get(col); if (v) body[field] = v;
  }
  if (get('Email') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(get('Email'))) errors.push('Email non valida');

  // Filiale — EXACTLY ONE (required for a new employee). Sets the singular
  // branch_id only; the write helper clears the legacy branch_ids column.
  // A multi-value (";"-separated) cell is rejected — no multi-filiale employees.
  const bCode = get('Filiale');
  if (bCode.includes(';')) {
    errors.push('Una sola Filiale ammessa (valori multipli non consentiti)');
  } else if (bCode) {
    const hit = master.branch.get(bCode.toLowerCase());
    if (!hit) errors.push(`Filiale ${bCode} non esistente`);
    else body.branch_id = hit.id;
  } else if (action === 'CREATE') {
    errors.push('Filiale obbligatoria per un nuovo dipendente');
  }

  // Servizio — EXACTLY ONE (required for a new employee).
  const sCode = get('Servizio');
  if (sCode.includes(';')) {
    errors.push('Un solo Servizio ammesso (valori multipli non consentiti)');
  } else if (sCode) {
    const hit = master.service.get(sCode.toLowerCase());
    if (!hit) errors.push(`Servizio ${sCode} non esistente`);
    else body.service_type_id = hit.id;
  } else if (action === 'CREATE') {
    errors.push('Servizio obbligatorio per un nuovo dipendente');
  }

  // Codice turno — EXACTLY ONE (required for a new employee). TEXT code.
  const shCode = get('Codice turno');
  if (shCode.includes(';')) {
    errors.push('Un solo Codice turno ammesso (valori multipli non consentiti)');
  } else if (shCode) {
    const canon = master.shiftCanon.get(shCode.toLowerCase());
    if (!canon) errors.push(`Codice turno ${shCode} non esistente`);
    else body.default_shift_code = canon;
  } else if (action === 'CREATE') {
    errors.push('Codice turno obbligatorio per un nuovo dipendente');
  }

  // Contract type (code → id).
  const ct = get('Contratto');
  if (ct) {
    const hit = master.contract.get(ct.toLowerCase());
    if (!hit) errors.push(`Contratto ${ct} non esistente`);
    else body.contract_type_id = hit.id;
  }

  // Team (name → id).
  const tm = get('Team');
  if (tm) {
    const hit = master.team.get(tm.toLowerCase());
    if (!hit) errors.push(`Team ${tm} non esistente`);
    else body.team_id = hit.id;
  }

  // Working days.
  const wd = parseWorkDays(r['Giorni lavorativi']);
  if (!wd.ok) errors.push('Giorni lavorativi non validi (usa numeri 1-7)');
  else if (wd.val !== undefined) body.work_days = wd.val;

  // Dates.
  for (const [col, field] of [['Data assunzione', 'hire_date'],
    ['Data inizio contratto', 'contract_start_date'], ['Data fine contratto', 'contract_end_date']]) {
    const d = parseDate(r[col]);
    if (!d.ok) errors.push(`${col} non valida (usa AAAA-MM-GG)`);
    else if (d.val !== undefined) body[field] = d.val;
  }

  // Status.
  const st = get('Stato');
  if (st) {
    if (!EMP_STATUSES.includes(st.toLowerCase())) errors.push(`Stato ${st} non valido`);
    else body.status = st.toLowerCase();
  }

  return { rowNum, employee_code: code || null, action, errors, body, targetId: existing ? existing.id : null };
}

// Validate a whole workbook. Returns { results[], summary, ok }.
async function validateEmployeesFile(file) {
  const rows = await readRows(file);
  const master = await loadEmpMaster();
  const seen = new Set();
  const results = rows.map((r, i) => validateRow(r, i + 2, master, seen)); // +2: header is row 1
  const summary = {
    total: results.length,
    create: results.filter((x) => x.action === 'CREATE' && !x.errors.length).length,
    update: results.filter((x) => x.action === 'UPDATE' && !x.errors.length).length,
    errors: results.filter((x) => x.errors.length).length,
  };
  return { results, summary, ok: summary.errors === 0 && summary.total > 0 };
}

function colLetter(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; }

// Build the .xlsx employee template with live master-data dropdowns. Nothing is
// hardcoded: branches/services/shift codes/contracts come from the database.
async function buildEmployeeTemplate() {
  const [branches, services, shifts, contracts] = await Promise.all([
    pool.query('SELECT code, name FROM branches WHERE active ORDER BY code'),
    pool.query('SELECT code, name FROM service_types WHERE active ORDER BY sort_order, code'),
    pool.query('SELECT code, label FROM shift_codes ORDER BY category, code'),
    pool.query('SELECT code, label FROM contract_types ORDER BY code'),
  ]);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Dipendenti');
  ws.columns = EMP_COLS.map((c) => ({ header: c.key, key: c.key, width: c.width || 14 }));

  // Header styling + required marker.
  ws.getRow(1).font = { bold: true };
  EMP_COLS.forEach((c, i) => {
    const cell = ws.getRow(1).getCell(i + 1);
    if (c.required || c.requiredOnCreate) cell.note = 'Obbligatorio' + (c.requiredOnCreate ? ' per nuovi dipendenti' : '');
  });

  // Hidden sheet holding the dropdown value lists.
  const meta = wb.addWorksheet('_meta');
  meta.state = 'veryHidden';
  const lists = {
    branches: branches.rows.map((r) => r.code),
    services: services.rows.map((r) => r.code),
    shifts: shifts.rows.map((r) => r.code),
    contracts: contracts.rows.map((r) => r.code),
    status: EMP_STATUSES,
  };
  const listCol = {};
  let ci = 0;
  for (const [name, vals] of Object.entries(lists)) {
    ci++;
    const L = colLetter(ci);
    meta.getCell(`${L}1`).value = name;
    vals.forEach((v, i) => { meta.getCell(`${L}${i + 2}`).value = v; });
    listCol[name] = { L, n: vals.length };
  }

  // Apply list data-validation to each dropdown column, rows 2..MAXROW.
  const MAXROW = 500;
  EMP_COLS.forEach((c, idx) => {
    if (!c.dd || !listCol[c.dd] || !listCol[c.dd].n) return;
    const { L, n } = listCol[c.dd];
    const letter = colLetter(idx + 1);
    for (let r = 2; r <= MAXROW; r++) {
      ws.getCell(`${letter}${r}`).dataValidation = {
        type: 'list', allowBlank: true,
        formulae: [`=_meta!$${L}$2:$${L}$${n + 1}`],
      };
    }
  });

  // One dynamic example row (uses the FIRST available master value — never a
  // hardcoded branch/service/shift).
  const ex = {
    'Codice dipendente': 'EMP001', Cognome: 'Rossi', Nome: 'Mario',
    Email: 'mario.rossi@example.com', Telefono: '3331234567',
    Filiale: branches.rows[0] ? branches.rows[0].code : '',
    Servizio: services.rows[0] ? services.rows[0].code : '',
    'Codice turno': shifts.rows[0] ? shifts.rows[0].code : '',
    Contratto: contracts.rows[0] ? contracts.rows[0].code : '',
    'Giorni lavorativi': '1,2,3,4,5', 'Data assunzione': '2024-03-01', Stato: 'active',
  };
  ws.addRow(ex);

  // Instructions sheet.
  const isn = wb.addWorksheet('Istruzioni');
  isn.columns = [{ width: 26 }, { width: 70 }];
  const line = (a, b) => isn.addRow([a, b]);
  isn.addRow(['ISTRUZIONI IMPORT DIPENDENTI']).font = { bold: true, size: 14 };
  isn.addRow([]);
  line('Chiave', 'La colonna "Codice dipendente" decide CREATE o UPDATE:');
  line('', '• vuoto o codice nuovo → crea un nuovo dipendente');
  line('', '• codice già esistente → aggiorna il dipendente');
  line('', 'Nell\'UPDATE le celle vuote mantengono il valore attuale.');
  isn.addRow([]);
  line('Obbligatori', 'Cognome, Nome. Per i nuovi dipendenti anche Filiale, Servizio e Codice turno.');
  line('Assegnazione', 'Ogni dipendente ha esattamente UNA Filiale, UN Servizio e UN Codice turno.');
  line('Giorni lavorativi', 'Numeri 1-7 separati da virgola (1=Lun … 7=Dom).');
  line('Date', 'Formato AAAA-MM-GG.');
  line('Stato', EMP_STATUSES.join(' | ') + ' (default active).');
  isn.addRow([]);
  line('Valori ammessi', 'Filiale/Servizio/Codice turno/Contratto/Stato hanno menu a tendina');
  line('', 'popolati con i dati reali dell\'applicazione. Non inventare valori.');
  isn.getColumn(1).font = { bold: true };

  return wb;
}

// ---------------- TEMPLATES ----------------
// GET /api/xlsx/template/:type  (employees|forecast|schedule)
router.get('/template/:type', async (req, res) => {
  const t = req.params.type;
  if (t === 'employees') {
    // Employee template mirrors employee data → gate on employee.view.
    if (req.user.role !== 'admin' && !roleAllowed('employee.view', req.user.role)) {
      return res.status(403).json({ error: 'Permesso negato: employee.view' });
    }
    const wb = await buildEmployeeTemplate();
    return await sendWorkbook(res, wb, 'template_dipendenti.xlsx');
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

// A compact per-row report for the frontend preview table.
function toReport(results) {
  return results.map((r) => ({
    row: r.rowNum, code: r.employee_code, action: r.action,
    status: r.errors.length ? 'ERRORE' : 'OK', errors: r.errors,
  }));
}

// POST /api/xlsx/import/employees/preview  — validate only, ZERO writes.
router.post('/import/employees/preview', requirePermission('employee.manage'), upload.single('file'), async (req, res) => {
  const bad = assertXlsx(req.file);
  if (bad) return res.status(400).json({ error: bad });
  let v;
  try { v = await validateEmployeesFile(req.file); }
  catch (e) { logger.error('xlsx', 'employee preview parse', e); return res.status(400).json({ error: 'File .xlsx non leggibile' }); }
  res.json({ ok: v.ok, summary: v.summary, rows: toReport(v.results) });
});

// POST /api/xlsx/import/employees  — ALL-OR-NOTHING import.
// Re-validates server-side (never trusts the preview), writes through the SAME
// canonical employee write path, then regenerates schedules per employee AFTER
// commit (same best-effort behavior as the normal form).
router.post('/import/employees', requirePermission('employee.manage'), upload.single('file'), async (req, res) => {
  const bad = assertXlsx(req.file);
  if (bad) return res.status(400).json({ error: bad });

  let v;
  try { v = await validateEmployeesFile(req.file); }
  catch (e) { logger.error('xlsx', 'employee import parse', e); return res.status(400).json({ error: 'File .xlsx non leggibile' }); }

  if (v.summary.total === 0) return res.status(400).json({ error: 'Nessuna riga da importare' });
  // All-or-nothing: any validation error → write NOTHING.
  if (v.summary.errors > 0) {
    return res.status(422).json({ ok: false, error: `Import non eseguito: ${v.summary.errors} righe con errori`, summary: v.summary, rows: toReport(v.results) });
  }

  const actor = req.user.username;
  const affected = [];
  await withTx(async (c) => {
    for (const r of v.results) {
      if (r.action === 'UPDATE') {
        const row = await updateEmployee(r.targetId, r.body, actor, c);
        if (row) affected.push(row.id);
      } else {
        const row = await createEmployee(r.body, actor, c);
        if (row) affected.push(row.id);
      }
    }
  });

  // Post-commit scheduler regeneration (per employee, best-effort — mirrors the
  // form: a regen failure never rolls back the committed employee rows).
  for (const id of affected) {
    try { await regenerateEmployee(id, actor); }
    catch (e) { logger.error('xlsx', 'autoregen employee ' + id, e); }
  }

  await audit(req, 'employee', null, 'create',
    `Import XLSX: ${v.summary.create} creati, ${v.summary.update} aggiornati`);
  res.json({ ok: true, created: v.summary.create, updated: v.summary.update, summary: v.summary });
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
// GET /api/xlsx/export/employees — readable values, multi-branch format, and
// formula-injection-safe cells. Uses the SAME column headers as the template so
// an export round-trips through import.
router.get('/export/employees', requirePermission('employee.view'), async (req, res) => {
  const params = []; const bc = branchClause(req.scope, params, 'e.branch_id');
  const [emps, branches, services] = await Promise.all([
    pool.query(
      `SELECT e.employee_code, e.last_name, e.first_name, e.email, e.phone, e.transporter_id, e.device,
              e.branch_id, e.service_type_id, e.default_shift_code,
              ct.code AS contract_code, t.name AS team_name,
              e.work_days, e.hire_date, e.contract_start_date, e.contract_end_date, e.status
         FROM employees e
         LEFT JOIN teams t ON t.id = e.team_id
         LEFT JOIN contract_types ct ON ct.id = e.contract_type_id
        WHERE 1=1 ${bc} ORDER BY e.last_name, e.first_name`, params),
    pool.query('SELECT id, code FROM branches'),
    pool.query('SELECT id, code FROM service_types'),
  ]);
  const bCode = new Map(branches.rows.map((r) => [r.id, r.code]));
  const sCode = new Map(services.rows.map((r) => [r.id, r.code]));
  const d = (v) => (v ? String(v).slice(0, 10) : '');

  // Exactly one Filiale / Servizio / Codice turno per employee (business rule).
  const out = emps.rows.map((e) => {
    const row = {
      'Codice dipendente': e.employee_code || '', Cognome: e.last_name || '', Nome: e.first_name || '',
      Email: e.email || '', Telefono: e.phone || '', 'Transporter ID': e.transporter_id || '', Device: e.device || '',
      Filiale: (e.branch_id != null ? bCode.get(e.branch_id) : '') || '',
      Servizio: (e.service_type_id != null ? sCode.get(e.service_type_id) : '') || '',
      'Codice turno': e.default_shift_code || '',
      Contratto: e.contract_code || '', Team: e.team_name || '',
      'Giorni lavorativi': Array.isArray(e.work_days) ? e.work_days.join(',') : '',
      'Data assunzione': d(e.hire_date), 'Data inizio contratto': d(e.contract_start_date),
      'Data fine contratto': d(e.contract_end_date), Stato: e.status || '',
    };
    // Injection guard on every cell value.
    Object.keys(row).forEach((k) => { row[k] = safeCell(row[k]); });
    return row;
  });

  // Guarantee full column order even when the roster is empty.
  const header = {}; EMP_COLS.forEach((c) => { header[c.key] = ''; });
  const rowsForSheet = out.length ? out : [header];
  await audit(req, 'employee', null, 'export', `Export XLSX dipendenti (${emps.rows.length})`);
  await sendWorkbook(res, sheetToWb(rowsForSheet, 'Dipendenti'), 'dipendenti.xlsx');
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
