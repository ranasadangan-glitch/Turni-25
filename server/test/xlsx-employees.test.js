// ============================================================
// Excel Import/Export for Dipendenti — end-to-end coverage (tests A–Z).
//
// Exercises the REAL xlsx route handlers + the canonical employee write path +
// the auto-engine against a live PostgreSQL. Master data (branches DLO1/DLO7,
// service_types, shift_codes) is seeded through the existing scheduler config
// import path — NOTHING is hardcoded in app code; the CONFIG below is test input
// only. node:test + node:assert, no new deps. Serial (npm test uses
// --test-concurrency=1). Skips gracefully if the database is unreachable.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const ExcelJS = require('exceljs');
const { pool } = require('../src/db/pool');
const schedulerRouter = require('../src/routes/scheduler');
const xlsxRouter = require('../src/routes/xlsx');

const PFX = 'ZZX';
const CONFIG = {
  filiali: ['DLO1', 'DLO7'],
  filDetails: { DLO1: { name: 'Sede DLO1' }, DLO7: { name: 'Sede DLO7' } },
  services: [{ key: 'DLO1_NEXT', label: 'DLO1 NEXT' }, { key: 'SAMEB', label: 'Same B' }],
  codes: [{ code: 'X', label: 'NEXT', cls: 'next' }, { code: 'OFF', label: 'Riposo', cls: 'off' }, { code: 'M', label: 'Malattia', cls: 'mal' }],
  contracts: [{ code: 'FT', label: 'Full time', workDays: 5 }],
};

let dbOk = false;

// ---- route-handler harness (bypasses multer/permission for the business
// handler; permission middleware is exercised directly in the RBAC tests) ----
function routeStack(router, method, path) {
  const l = router.stack.find((x) => x.route && x.route.path === path && x.route.methods[method.toLowerCase()]);
  assert.ok(l, `route ${method} ${path} exists`);
  return l.route.stack.map((s) => s.handle);
}
const businessHandler = (m, p) => { const s = routeStack(xlsxRouter, m, p); return s[s.length - 1]; };
const firstMiddleware = (m, p) => routeStack(xlsxRouter, m, p)[0];

async function runHandler(handler, req) {
  let statusCode = 200; let body; let buffer; const headers = {};
  const res = {
    status(c) { statusCode = c; return this; },
    json(b) { body = b; return this; },
    setHeader(k, v) { headers[k] = v; },
    send(b) { buffer = b; return this; },
  };
  await handler(req, res, (e) => { if (e) throw e; });
  return { statusCode, body, buffer, headers };
}
function mkReq({ file, user = { username: 'tester', role: 'admin' }, scope = { admin: true }, query = {}, params = {} } = {}) {
  return { file, user, scope, query, params, body: {}, headers: {}, ip: '127.0.0.1', originalUrl: 'test' };
}
function runMiddleware(mw, user) {
  let statusCode = 200; let body; let nexted = false;
  const res = { status(c) { statusCode = c; return this; }, json(b) { body = b; return this; } };
  mw({ user }, res, () => { nexted = true; });
  return { statusCode, body, nexted };
}

// ---- scheduler config import (seed master data), same as config-sync test ----
function schedHandlers(method, path) {
  const l = schedulerRouter.stack.find((x) => x.route && x.route.path === path && x.route.methods[method.toLowerCase()]);
  assert.ok(l, `scheduler route ${method} ${path}`);
  return l.route.stack.map((s) => s.handle);
}
async function importConfig() {
  const handlers = schedHandlers('post', '/config/import');
  const req = { method: 'post', params: {}, query: {}, body: { branch_code: 'DLO1', config: CONFIG }, user: { username: 'tester', role: 'admin' }, headers: {}, ip: '127.0.0.1', originalUrl: '/config/import' };
  let statusCode = 200; let jsonBody;
  const res = { status(c) { statusCode = c; return this; }, json(b) { jsonBody = b; return this; } };
  for (const h of handlers) { let nx = false; await h(req, res, () => { nx = true; }); if (!nx) break; }
  return { statusCode, body: jsonBody };
}

// ---- xlsx build/parse helpers ----
async function buildXlsx(headers, rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Dipendenti');
  ws.addRow(headers);
  rows.forEach((r) => ws.addRow(headers.map((h) => (r[h] !== undefined ? r[h] : ''))));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const asFile = (buffer, name = 'dipendenti.xlsx') => ({ buffer, originalname: name });
async function parseXlsx(buffer, sheet = 'Dipendenti') {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet(sheet) || wb.worksheets[0];
  const headers = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => { headers[i] = c.value == null ? '' : String(c.value); });
  const out = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r); const obj = {}; let any = false;
    headers.forEach((h, i) => { if (!h) return; const v = row.getCell(i).value; obj[h] = v == null ? '' : (v.text != null ? v.text : v); if (obj[h] !== '') any = true; });
    if (any) out.push(obj);
  }
  return { wb, ws, headers, rows: out };
}

const H = ['Codice dipendente', 'Cognome', 'Nome', 'Email', 'Telefono', 'Transporter ID', 'Device',
  'Filiale', 'Filiali', 'Servizio', 'Servizi', 'Codice turno', 'Codici turno', 'Contratto', 'Team',
  'Giorni lavorativi', 'Data assunzione', 'Data inizio contratto', 'Data fine contratto', 'Stato'];

const preview = async (buffer) => runHandler(businessHandler('post', '/import/employees/preview'), mkReq({ file: asFile(buffer) }));
const doImport = async (buffer) => runHandler(businessHandler('post', '/import/employees'), mkReq({ file: asFile(buffer) }));
const branchId = async (code) => (await pool.query('SELECT id FROM branches WHERE code=$1', [code])).rows[0].id;
const empByCode = async (code) => (await pool.query('SELECT * FROM employees WHERE employee_code=$1', [code])).rows[0];

async function cleanup() {
  await pool.query("DELETE FROM schedule_entries WHERE employee_id IN (SELECT id FROM employees WHERE employee_code LIKE $1||'%')", [PFX]).catch(() => {});
  await pool.query("DELETE FROM employees WHERE employee_code LIKE $1||'%'", [PFX]).catch(() => {});
  await pool.query("DELETE FROM scheduler_config WHERE branch_code IN ('DLO1','DLO7')").catch(() => {});
  await pool.query("DELETE FROM shift_codes WHERE code = ANY($1::text[])", [CONFIG.codes.map((c) => c.code)]).catch(() => {});
  await pool.query("DELETE FROM service_types WHERE code = ANY($1::text[])", [CONFIG.services.map((s) => s.key)]).catch(() => {});
  await pool.query("DELETE FROM branches WHERE code IN ('DLO1','DLO7')").catch(() => {});
}

test.before(async () => {
  try { await pool.query('SELECT 1'); dbOk = true; } catch { return; }
  await cleanup();
  await importConfig();
});
test.after(async () => { if (dbOk) await cleanup(); await pool.end(); });

// ---------- A–E: TEMPLATE ----------
test('A/B/C/D/E: template downloads, has expected columns and LIVE branch/service/shift values (DLO1+DLO7)', async (t) => {
  if (!dbOk) return t.skip('no database');
  const r = await runHandler(businessHandler('get', '/template/:type'), mkReq({ params: { type: 'employees' } }));
  assert.equal(r.statusCode, 200);
  assert.ok(r.buffer && r.buffer.length > 0, 'A: template downloaded');
  const { wb, headers } = await parseXlsx(r.buffer);
  // B: expected columns present
  ['Codice dipendente', 'Cognome', 'Nome', 'Filiale', 'Filiali', 'Servizio', 'Codice turno', 'Stato'].forEach((h) =>
    assert.ok(headers.includes(h), 'B: header ' + h));
  // C/D/E: live values on the hidden _meta sheet include DLO1 and DLO7
  const meta = wb.getWorksheet('_meta');
  assert.ok(meta, 'hidden _meta sheet exists');
  const vals = [];
  meta.eachRow((row) => row.eachCell((c) => vals.push(String(c.value))));
  assert.ok(vals.includes('DLO1'), 'D: DLO1 present in dropdown data');
  assert.ok(vals.includes('DLO7'), 'E: DLO7 present in dropdown data');
  assert.ok(vals.includes('X'), 'C: live shift code present');
  assert.ok(vals.includes('DLO1_NEXT'), 'C: live service code present');
  // Instructions sheet present
  assert.ok(wb.getWorksheet('Istruzioni'), 'Istruzioni sheet exists');
});

test('B2: template applies list data-validation to the Filiale column', async (t) => {
  if (!dbOk) return t.skip('no database');
  const r = await runHandler(businessHandler('get', '/template/:type'), mkReq({ params: { type: 'employees' } }));
  const { ws } = await parseXlsx(r.buffer);
  const dv = ws.getCell('H2').dataValidation;   // H = 8th column = Filiale
  assert.ok(dv && dv.type === 'list', 'Filiale has a list dropdown');
  assert.match(String(dv.formulae[0]), /_meta/, 'dropdown references live _meta list');
});

// ---------- F, P, Q, R, T: CREATE ----------
test('F/P/Q/R/T: CREATE writes employee, branch_id+branch_ids, autoRegen, audit', async (t) => {
  if (!dbOk) return t.skip('no database');
  const code = PFX + 'CREATE1';
  const buf = await buildXlsx(H, [{
    'Codice dipendente': code, Cognome: 'Rossi', Nome: 'Mario',
    Filiale: 'DLO1', Filiali: 'DLO7', Servizio: 'DLO1_NEXT', 'Codice turno': 'X',
    'Giorni lavorativi': '1,2,3,4,5', Stato: 'active',
  }]);
  const r = await doImport(buf);
  assert.equal(r.statusCode, 200, 'F: import ok');
  assert.equal(r.body.created, 1);
  const e = await empByCode(code);
  assert.ok(e, 'F: employee created');
  // P/Q: branch linkage
  const d1 = await branchId('DLO1'); const d7 = await branchId('DLO7');
  assert.equal(e.branch_id, d1, 'P: primary branch_id = DLO1 (first)');
  assert.deepEqual(e.branch_ids, [d1, d7], 'Q: branch_ids = [DLO1, DLO7]');
  // R: autoRegen produced schedule entries
  const cells = await pool.query("SELECT count(*)::int n FROM schedule_entries WHERE employee_id=$1 AND updated_by='auto-engine'", [e.id]);
  assert.ok(cells.rows[0].n > 0, 'R: auto-generated shifts exist');
  // T: audit row
  const a = await pool.query("SELECT 1 FROM audit_log WHERE entity='employee' AND action='create' AND detail LIKE 'Import XLSX%' LIMIT 1");
  assert.ok(a.rowCount > 0, 'T: audit created');
});

// ---------- G, S: UPDATE + manual entries preserved ----------
test('G/S: UPDATE existing employee; manual schedule entries preserved', async (t) => {
  if (!dbOk) return t.skip('no database');
  const code = PFX + 'UPD1';
  await doImport(await buildXlsx(H, [{
    'Codice dipendente': code, Cognome: 'Verdi', Nome: 'Anna',
    Filiale: 'DLO1', 'Codice turno': 'X', 'Giorni lavorativi': '1,2,3,4,5', Stato: 'active',
  }]));
  const e = await empByCode(code);
  // plant a manual override
  const ym = new Date(); const first = new Date(Date.UTC(ym.getUTCFullYear(), ym.getUTCMonth() + 1, 1));
  const month = first.getUTCFullYear() + '-' + String(first.getUTCMonth() + 1).padStart(2, '0') + '-01';
  await pool.query(
    `INSERT INTO schedule_entries (schedule_month, employee_id, day_of_month, shift_code, branch_code, updated_by)
     VALUES ($1,$2,15,'OFF','DLO1','planner')
     ON CONFLICT (employee_id, schedule_month, day_of_month) WHERE employee_id IS NOT NULL
     DO UPDATE SET shift_code=EXCLUDED.shift_code, updated_by=EXCLUDED.updated_by`, [month, e.id]);
  // UPDATE via import (partial: only phone) — should NOT clobber name, should regen
  const r = await doImport(await buildXlsx(H, [{ 'Codice dipendente': code, Cognome: 'Verdi', Nome: 'Anna', Telefono: '3339998888', Filiale: 'DLO1', 'Codice turno': 'X' }]));
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.updated, 1, 'G: one updated');
  const e2 = await empByCode(code);
  assert.equal(e2.phone, '3339998888', 'G: field updated');
  assert.equal(e2.last_name, 'Verdi', 'G: existing field preserved');
  const cell = await pool.query('SELECT shift_code, updated_by FROM schedule_entries WHERE employee_id=$1 AND schedule_month=$2 AND day_of_month=15', [e.id, month]);
  assert.equal(cell.rows[0].shift_code, 'OFF', 'S: manual value preserved');
  assert.equal(cell.rows[0].updated_by, 'planner', 'S: manual ownership preserved');
});

// ---------- H: duplicate employee codes ----------
test('H: duplicate employee_code within the file is flagged', async (t) => {
  if (!dbOk) return t.skip('no database');
  const buf = await buildXlsx(H, [
    { 'Codice dipendente': PFX + 'DUP', Cognome: 'A', Nome: 'A', Filiale: 'DLO1' },
    { 'Codice dipendente': PFX + 'DUP', Cognome: 'B', Nome: 'B', Filiale: 'DLO1' },
  ]);
  const r = await preview(buf);
  assert.equal(r.body.ok, false);
  const dupRow = r.body.rows.find((x) => x.row === 3);
  assert.ok(dupRow.errors.some((m) => /duplicat/i.test(m)), 'H: duplicate reported');
});

// ---------- I/J/K/L: invalid references + required fields ----------
test('I/J/K/L: unknown branch/service/shift and missing required fields are rejected', async (t) => {
  if (!dbOk) return t.skip('no database');
  const buf = await buildXlsx(H, [
    { 'Codice dipendente': PFX + 'BADB', Cognome: 'X', Nome: 'X', Filiale: 'DLO9' },                       // I
    { 'Codice dipendente': PFX + 'BADS', Cognome: 'X', Nome: 'X', Filiale: 'DLO1', Servizio: 'NOPE' },      // J
    { 'Codice dipendente': PFX + 'BADC', Cognome: 'X', Nome: 'X', Filiale: 'DLO1', 'Codice turno': 'ZZZ' }, // K
    { 'Codice dipendente': PFX + 'NOREQ', Cognome: '', Nome: '', Filiale: 'DLO1' },                          // L
  ]);
  const r = await preview(buf);
  assert.equal(r.body.ok, false);
  const err = (n, re) => assert.ok(r.body.rows.find((x) => x.row === n).errors.some((m) => re.test(m)), 'row ' + n);
  err(2, /Filiale DLO9 non esistente/i);   // I
  err(3, /Servizio NOPE non esistente/i);  // J
  err(4, /Codice turno ZZZ non esistente/i); // K
  err(5, /obbligatori/i);                   // L
});

// ---------- M: preview performs ZERO writes ----------
test('M: preview does not write anything', async (t) => {
  if (!dbOk) return t.skip('no database');
  const before = (await pool.query("SELECT count(*)::int n FROM employees WHERE employee_code LIKE $1||'%'", [PFX])).rows[0].n;
  await preview(await buildXlsx(H, [{ 'Codice dipendente': PFX + 'PREVIEWONLY', Cognome: 'P', Nome: 'P', Filiale: 'DLO1', 'Codice turno': 'X' }]));
  const after = (await pool.query("SELECT count(*)::int n FROM employees WHERE employee_code LIKE $1||'%'", [PFX])).rows[0].n;
  assert.equal(after, before, 'M: no rows written by preview');
  assert.equal(await empByCode(PFX + 'PREVIEWONLY'), undefined, 'M: previewed row absent');
});

// ---------- N/O: transactional, all-or-nothing rollback ----------
test('N/O: any invalid row → NOTHING is written (all-or-nothing)', async (t) => {
  if (!dbOk) return t.skip('no database');
  const buf = await buildXlsx(H, [
    { 'Codice dipendente': PFX + 'TXOK', Cognome: 'Ok', Nome: 'Row', Filiale: 'DLO1', 'Codice turno': 'X' }, // valid
    { 'Codice dipendente': PFX + 'TXBAD', Cognome: 'Bad', Nome: 'Row', Filiale: 'DLO9' },                     // invalid
  ]);
  const r = await doImport(buf);
  assert.equal(r.statusCode, 422, 'O: import rejected');
  assert.equal(r.body.ok, false);
  assert.equal(await empByCode(PFX + 'TXOK'), undefined, 'O: valid row NOT written (rollback)');
  assert.equal(await empByCode(PFX + 'TXBAD'), undefined, 'O: invalid row NOT written');
});

test('N2: a fully valid multi-row import commits atomically (both rows)', async (t) => {
  if (!dbOk) return t.skip('no database');
  const buf = await buildXlsx(H, [
    { 'Codice dipendente': PFX + 'ATOM1', Cognome: 'A', Nome: 'One', Filiale: 'DLO1', 'Codice turno': 'X' },
    { 'Codice dipendente': PFX + 'ATOM2', Cognome: 'B', Nome: 'Two', Filiale: 'DLO7', 'Codice turno': 'X' },
  ]);
  const r = await doImport(buf);
  assert.equal(r.statusCode, 200);
  assert.ok(await empByCode(PFX + 'ATOM1') && await empByCode(PFX + 'ATOM2'), 'N: both committed');
});

// ---------- U/V: EXPORT ----------
test('U/V: export has readable branch/service/shift values and is formula-injection safe', async (t) => {
  if (!dbOk) return t.skip('no database');
  await doImport(await buildXlsx(H, [{
    'Codice dipendente': PFX + 'EXP', Cognome: '=cmd()', Nome: 'Inj',
    Filiale: 'DLO1', Filiali: 'DLO7', Servizio: 'DLO1_NEXT', 'Codice turno': 'X', Stato: 'active',
  }]));
  const r = await runHandler(businessHandler('get', '/export/employees'), mkReq());
  assert.equal(r.statusCode, 200);
  const { rows } = await parseXlsx(r.buffer);
  const row = rows.find((x) => x['Codice dipendente'] === PFX + 'EXP');
  assert.ok(row, 'exported row found');
  assert.equal(row.Filiale, 'DLO1', 'U: readable branch code');
  assert.equal(row.Filiali, 'DLO7', 'U: additional branch code');
  assert.equal(row.Servizio, 'DLO1_NEXT', 'U: readable service code');
  assert.equal(row['Codice turno'], 'X', 'U: readable shift code');
  assert.ok(String(row.Cognome).startsWith("'"), 'V: dangerous leading char neutralized');
});

// ---------- W/X: RBAC ----------
test('W: import requires employee.manage (team_leader denied, hr_manager allowed)', async (t) => {
  if (!dbOk) return t.skip('no database');
  const tl = runMiddleware(firstMiddleware('post', '/import/employees'), { role: 'team_leader' });
  assert.equal(tl.statusCode, 403, 'W: team_leader denied import');
  const hr = runMiddleware(firstMiddleware('post', '/import/employees'), { role: 'hr_manager' });
  assert.ok(hr.nexted, 'W: hr_manager allowed import');
  const pr = runMiddleware(firstMiddleware('post', '/import/employees/preview'), { role: 'team_leader' });
  assert.equal(pr.statusCode, 403, 'W: team_leader denied preview');
});

test('X: export/template gated on employee.view (unknown role denied, team_leader allowed)', async (t) => {
  if (!dbOk) return t.skip('no database');
  const noRole = runMiddleware(firstMiddleware('get', '/export/employees'), { role: 'nobody' });
  assert.equal(noRole.statusCode, 403, 'X: unknown role denied export');
  const tl = runMiddleware(firstMiddleware('get', '/export/employees'), { role: 'team_leader' });
  assert.ok(tl.nexted, 'X: team_leader allowed export (employee.view)');
  // Template gate is inline in the handler:
  const denied = await runHandler(businessHandler('get', '/template/:type'), mkReq({ params: { type: 'employees' }, user: { username: 'x', role: 'nobody' } }));
  assert.equal(denied.statusCode, 403, 'X: unknown role denied template');
});
