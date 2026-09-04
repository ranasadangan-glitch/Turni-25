// ============================================================
// Config sync → master data → employee form/scheduler (regression for the
// production "empty Filiale/Servizio/Codice + employees missing from
// Pianificazione" bug).
//
// Proves the canonical scheduler config, pushed through the existing
// POST /api/scheduler/config/import path, re-derives branches / service_types /
// shift_codes (syncOrgVocab + syncShiftVocab) for BOTH DLO1 and DLO7, that a
// sync failure is surfaced as a non-2xx (never silently swallowed), that it is
// idempotent, that employees in either branch get auto-generated shifts, and
// that an import/sync does NOT modify existing employees or manual entries.
//
// Exercises the REAL route handlers + auto-engine against a live PostgreSQL.
// node:test + node:assert, no new deps. Serial (npm test uses --test-concurrency=1).
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const { pool } = require('../src/db/pool');
const schedulerRouter = require('../src/routes/scheduler');
const metaRouter = require('../src/routes/meta');
const shiftMod = require('../scripts/sync-shift-vocab');
const { regenerateEmployee } = require('../src/services/autoschedule');

const EMP_PREFIX = 'ZZC';
// Canonical config (real shape: filiali = array of branch CODE strings). No
// hardcoded production values leak into app code — this is test input only.
const CONFIG = {
  filiali: ['DLO1', 'DLO7'],
  filDetails: { DLO1: { name: 'Sede DLO1' }, DLO7: { name: 'Sede DLO7' } },
  services: [{ key: 'DLO1_NEXT', label: 'DLO1 NEXT' }, { key: 'SAMEB', label: 'Same B' }],
  codes: [{ code: 'X', label: 'NEXT', cls: 'next' }, { code: 'OFF', label: 'Riposo', cls: 'off' }, { code: 'M', label: 'Malattia', cls: 'mal' }],
  contracts: [{ code: 'FT', label: 'Full time', workDays: 5 }],
};

let dbOk = false;

// ---- invoke a real route handler chain (req/res fakes) ----
function routeHandlers(router, method, path) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method.toLowerCase()]);
  assert.ok(layer, `route ${method} ${path} exists`);
  return layer.route.stack.map((s) => s.handle);
}
async function call(router, method, path, { params = {}, query = {}, body = {}, user = { username: 'tester', role: 'admin' } } = {}) {
  const handlers = routeHandlers(router, method, path);
  const req = { method, params, query, body, user, headers: {}, ip: '127.0.0.1', originalUrl: path };
  let statusCode = 200; let jsonBody;
  const res = { status(c) { statusCode = c; return this; }, json(b) { jsonBody = b; return this; } };
  for (const h of handlers) { let nx = false; /* eslint-disable no-await-in-loop */ await h(req, res, () => { nx = true; }); if (!nx) break; }
  return { statusCode, body: jsonBody };
}
const importConfig = (config, branch = 'DLO1', user) => call(schedulerRouter, 'post', '/config/import', { body: { branch_code: branch, config }, ...(user ? { user } : {}) });
const meta = (path) => call(metaRouter, 'get', path);
const monthSnap = (month, branch) => call(schedulerRouter, 'get', '/month', { query: { month, branch } }).then((r) => r.body);

function nextMonthYM() {
  const n = new Date();
  const d = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1));
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}
function firstWeekday(ym) {
  const [y, m] = ym.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  for (let d = 1; d <= days; d++) { const dw = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); if (dw >= 1 && dw <= 5) return d; }
  return 1;
}
const has = (snap, id) => (snap.drivers || []).some((d) => d.employee_id === id || d.id === id);
const cellsOf = (snap, id) => (snap.schedule && snap.schedule[id]) || {};

async function createEmployee(code, branchCode) {
  const bid = (await pool.query('SELECT id FROM branches WHERE code=$1', [branchCode])).rows[0].id;
  const { rows } = await pool.query(
    `INSERT INTO employees (employee_code, first_name, last_name, status, work_days, default_shift_code, branch_id, contract_start_date)
     VALUES ($1,$2,'T','active',ARRAY[1,2,3,4,5],'X',$3,NULL) RETURNING id`,
    [code, code, bid]);
  const id = rows[0].id;
  await regenerateEmployee(id, 'test');
  return id;
}

async function cleanup() {
  await pool.query("DELETE FROM schedule_entries WHERE employee_id IN (SELECT id FROM employees WHERE employee_code LIKE $1||'%')", [EMP_PREFIX]).catch(() => {});
  await pool.query("DELETE FROM employees WHERE employee_code LIKE $1||'%'", [EMP_PREFIX]).catch(() => {});
  await pool.query("DELETE FROM scheduler_config WHERE branch_code IN ('DLO1','DLO7')").catch(() => {});
  await pool.query("DELETE FROM shift_codes WHERE code = ANY($1::text[])", [CONFIG.codes.map((c) => c.code)]).catch(() => {});
  await pool.query("DELETE FROM service_types WHERE code = ANY($1::text[])", [CONFIG.services.map((s) => s.key)]).catch(() => {});
  await pool.query("DELETE FROM branches WHERE code IN ('DLO1','DLO7')").catch(() => {});
}

test.before(async () => { try { await pool.query('SELECT 1'); dbOk = true; } catch { return; } await cleanup(); });
test.after(async () => { if (dbOk) await cleanup(); await pool.end(); });

test('A–F: config import populates branches (DLO1+DLO7), service_types, shift_codes; /api/meta/* return them', async (t) => {
  if (!dbOk) return t.skip('no database');
  const r = await importConfig(CONFIG);
  assert.equal(r.statusCode, 200, 'import ok');
  assert.equal(r.body.ok, true);

  // A: branches incl. DLO1 AND DLO7
  const b = await meta('/branches');
  assert.equal(b.statusCode, 200);
  const codes = b.body.map((x) => x.code);
  assert.ok(codes.includes('DLO1') && codes.includes('DLO7'), 'DLO1 and DLO7 present: ' + codes.join(','));
  // B/E: service_types
  const s = await meta('/service-types');
  assert.equal(s.statusCode, 200);
  assert.ok(s.body.length >= 2, 'service_types populated');
  // C/F: shift_codes
  const c = await meta('/shift-codes');
  assert.equal(c.statusCode, 200);
  assert.ok(c.body.some((x) => x.code === 'X') && c.body.length >= 3, 'shift_codes populated');
});

test('L: config import is idempotent', async (t) => {
  if (!dbOk) return t.skip('no database');
  await importConfig(CONFIG);
  const before = (await meta('/branches')).body.length;
  await importConfig(CONFIG);
  const after = (await meta('/branches')).body.length;
  assert.equal(before, after, 'branch count stable across repeated imports');
});

test('M: a sync failure is surfaced as non-2xx (never silently swallowed)', async (t) => {
  if (!dbOk) return t.skip('no database');
  const orig = shiftMod.syncShiftVocab;
  shiftMod.syncShiftVocab = async () => { throw new Error('boom-sync'); }; // handler destructures from this same module object
  try {
    const r = await importConfig({ codes: CONFIG.codes });   // only codes → only shift sync runs → throws
    assert.equal(r.statusCode, 502, 'sync failure → 502 (not 200)');
    assert.equal(r.body.ok, false);
    assert.ok(Array.isArray(r.body.syncErrors) && r.body.syncErrors.some((e) => e.sync === 'shift'), 'syncErrors reported');
    assert.match(r.body.error || '', /boom-sync/, 'error message surfaced');
  } finally {
    shiftMod.syncShiftVocab = orig;   // restore real sync
  }
  await importConfig(CONFIG);          // re-sync cleanly for later tests
});

test('H/I: active employee in DLO1 and in DLO7 get auto-generated shifts, visible in Pianificazione', async (t) => {
  if (!dbOk) return t.skip('no database');
  await importConfig(CONFIG);
  const ym = nextMonthYM(); const wd = firstWeekday(ym);
  const e1 = await createEmployee(EMP_PREFIX + '1', 'DLO1');
  const e7 = await createEmployee(EMP_PREFIX + '7', 'DLO7');
  const s1 = await monthSnap(ym, 'DLO1');
  const s7 = await monthSnap(ym, 'DLO7');
  assert.ok(has(s1, e1) && cellsOf(s1, e1)[wd] === 'X', 'H: DLO1 employee generated + visible under DLO1');
  assert.ok(has(s7, e7) && cellsOf(s7, e7)[wd] === 'X', 'I: DLO7 employee generated + visible under DLO7');
  // branch isolation preserved (PR #3 behavior)
  assert.ok(!has(s1, e7) && !has(s7, e1), 'branch rosters isolated');
});

test('J/K: import/sync does NOT modify existing employees or manual schedule entries', async (t) => {
  if (!dbOk) return t.skip('no database');
  await importConfig(CONFIG);
  const ym = nextMonthYM(); const wd = firstWeekday(ym);
  const id = await createEmployee(EMP_PREFIX + 'J', 'DLO1');
  // snapshot the employee row + add a manual override
  const before = (await pool.query('SELECT * FROM employees WHERE id=$1', [id])).rows[0];
  await pool.query(
    `INSERT INTO schedule_entries (schedule_month, employee_id, day_of_month, shift_code, branch_code, updated_by)
     VALUES ($1,$2,$3,'OFF','DLO1','planner')
     ON CONFLICT (employee_id, schedule_month, day_of_month) WHERE employee_id IS NOT NULL
     DO UPDATE SET shift_code=EXCLUDED.shift_code, updated_by=EXCLUDED.updated_by`,
    [ym + '-01', id, wd]);
  // re-run the config import (the sync path) — must not touch employee rows or manual cells
  await importConfig(CONFIG);
  const after = (await pool.query('SELECT * FROM employees WHERE id=$1', [id])).rows[0];
  assert.deepEqual(after, before, 'J: existing employee row unchanged by import/sync');
  const cell = (await pool.query('SELECT shift_code, updated_by FROM schedule_entries WHERE employee_id=$1 AND schedule_month=$2 AND day_of_month=$3', [id, ym + '-01', wd])).rows[0];
  assert.equal(cell.shift_code, 'OFF', 'K: manual override value preserved');
  assert.equal(cell.updated_by, 'planner', 'K: manual override ownership preserved');
});
