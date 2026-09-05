// ============================================================
// Service ↔ code invariant: scheduler_config.services[].count ⊆ codes[].code.
//
// Proves the shared pruning helper, the codes-delete cascade (DELETE /api/codes),
// the config-import invariant, and the reconciliation idempotency — using the
// REAL route handlers + a live PostgreSQL. Dedicated ZZ* branches keep the global
// shift_codes reconcile (triggered by the codes routes) isolated; cleanup runs
// after. node:test + node:assert, no new deps. Serial (--test-concurrency=1).
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const { pool } = require('../src/db/pool');
const codesRouter = require('../src/routes/codes');
const schedulerRouter = require('../src/routes/scheduler');
const { pruneServiceCounts, reconcileBranchServiceCounts } = require('../src/services/serviceCodes');

const BRANCHES = ['ZZSVCA', 'ZZSVCB', 'ZZSVCC', 'ZZSVCD'];
const TEST_CODES = ['KA', 'KB', 'KC'];
let dbOk = false;

function lastHandler(router, method, path) {
  const l = router.stack.find((x) => x.route && x.route.path === path && x.route.methods[method.toLowerCase()]);
  assert.ok(l, `route ${method} ${path}`);
  const s = l.route.stack;
  return s[s.length - 1].handle;
}
async function callHandler(handler, { params = {}, query = {}, body = {}, user = { username: 'tester', role: 'admin' } } = {}) {
  let statusCode = 200; let jsonBody;
  const req = { params, query, body, user, headers: {}, ip: '127.0.0.1', originalUrl: 'test' };
  const res = { status(c) { statusCode = c; return this; }, json(b) { jsonBody = b; return this; } };
  await handler(req, res, (e) => { if (e) throw e; });
  return { statusCode, body: jsonBody };
}
const codesArr = (arr) => arr.map((c) => ({ code: c, label: c, cls: 'abs' }));
async function setCfg(branch, key, value) {
  await pool.query(
    `INSERT INTO scheduler_config (branch_code, config_key, config_value, updated_by)
     VALUES ($1,$2,$3,'test')
     ON CONFLICT (branch_code, config_key) DO UPDATE SET config_value=EXCLUDED.config_value`,
    [branch, key, JSON.stringify(value)]);
}
const getKey = async (branch, key) => {
  const { rows } = await pool.query('SELECT config_value FROM scheduler_config WHERE branch_code=$1 AND config_key=$2', [branch, key]);
  return rows[0] ? rows[0].config_value : null;
};

async function cleanup() {
  await pool.query('DELETE FROM scheduler_config WHERE branch_code = ANY($1::text[])', [BRANCHES]).catch(() => {});
  await pool.query('DELETE FROM shift_codes WHERE code = ANY($1::text[])', [TEST_CODES]).catch(() => {});
  await pool.query("DELETE FROM service_types WHERE code IN ('S1','S2')").catch(() => {});
}

test.before(async () => { try { await pool.query('SELECT 1'); dbOk = true; } catch { return; } await cleanup(); });
test.after(async () => { if (dbOk) await cleanup(); await pool.end(); });

// ---------- pure helper (no DB) ----------
test('pruneServiceCounts: keeps subset, removes stale, preserves order, reports, untouched services', () => {
  const codes = codesArr(['KA', 'KB']);            // master = KA, KB
  const services = [
    { key: 'S1', label: 'One', count: ['KA', 'STALE', 'KB'], filiali: ['X'] }, // stale in the middle
    { key: 'S2', label: 'Two', count: ['KB'] },                                // valid subset — untouched
    { key: 'S3', label: 'Three' },                                            // no count — untouched
  ];
  const { services: out, changed, report } = pruneServiceCounts(services, codes);
  assert.equal(changed, true);
  assert.deepEqual(out[0].count, ['KA', 'KB'], 'order preserved, stale removed');
  assert.deepEqual(out[0].filiali, ['X'], 'other props preserved');
  assert.deepEqual(out[1].count, ['KB'], 'valid subset untouched');
  assert.equal(out[2].count, undefined, 'service without count untouched');
  assert.deepEqual(report, [{ service: 'S1', removed: ['STALE'] }]);
  // A service may legitimately have FEWER codes than the master — not flagged.
  assert.ok(!report.some((r) => r.service === 'S2'));
});

test('pruneServiceCounts: idempotent (already-clean input yields no change)', () => {
  const codes = codesArr(['KA', 'KB']);
  const clean = [{ key: 'S1', count: ['KA', 'KB'] }];
  const r = pruneServiceCounts(clean, codes);
  assert.equal(r.changed, false);
  assert.deepEqual(r.services[0].count, ['KA', 'KB']);
});

// ---------- reconcile against the DB + idempotency ----------
test('reconcileBranchServiceCounts: prunes stale, writes once, idempotent', async (t) => {
  if (!dbOk) return t.skip('no database');
  const B = 'ZZSVCA';
  await setCfg(B, 'codes', codesArr(['KA', 'KB']));
  await setCfg(B, 'services', [{ key: 'S1', label: 'One', count: ['KA', 'STALE', 'KB'] }]);
  const r1 = await reconcileBranchServiceCounts(pool, B, 'test');
  assert.equal(r1.changed, true);
  assert.deepEqual(r1.report, [{ service: 'S1', removed: ['STALE'] }]);
  assert.deepEqual((await getKey(B, 'services'))[0].count, ['KA', 'KB'], 'stored pruned + order preserved');
  const r2 = await reconcileBranchServiceCounts(pool, B, 'test');
  assert.equal(r2.changed, false, 'idempotent: second run writes nothing');
});

// ---------- DELETE /api/codes cascade ----------
test('DELETE /api/codes removes the code from master AND every services[].count; other branch untouched', async (t) => {
  if (!dbOk) return t.skip('no database');
  const B = 'ZZSVCB'; const OTHER = 'ZZSVCC';
  await setCfg(B, 'codes', codesArr(['KA', 'KB', 'KC']));
  await setCfg(B, 'services', [
    { key: 'S1', label: 'One', count: ['KA', 'KB', 'KC'] },
    { key: 'S2', label: 'Two', count: ['KB'] },
  ]);
  // A different branch that also references KC — must NOT be touched by the cascade.
  await setCfg(OTHER, 'codes', codesArr(['KA', 'KB', 'KC']));
  await setCfg(OTHER, 'services', [{ key: 'S1', label: 'One', count: ['KC'] }]);

  const del = lastHandler(codesRouter, 'delete', '/:code');
  const r = await callHandler(del, { params: { code: 'KC' }, query: { branch: B } });
  assert.equal(r.statusCode, 200, 'delete ok');
  assert.equal(r.body.ok, true);

  // master lost only KC
  assert.deepEqual((await getKey(B, 'codes')).map((c) => c.code), ['KA', 'KB'], 'master: only KC removed');
  // services pruned, valid codes + other services kept
  const svc = await getKey(B, 'services');
  assert.deepEqual(svc.find((s) => s.key === 'S1').count, ['KA', 'KB'], 'KC removed from S1, KA/KB kept');
  assert.deepEqual(svc.find((s) => s.key === 'S2').count, ['KB'], 'S2 unchanged');
  // other branch untouched
  assert.deepEqual((await getKey(OTHER, 'services'))[0].count, ['KC'], 'other branch not modified');
});

// ---------- config/import invariant ----------
test('POST /config/import prunes services[].count to the master before persisting', async (t) => {
  if (!dbOk) return t.skip('no database');
  const D = 'ZZSVCD';
  const imp = lastHandler(schedulerRouter, 'post', '/config/import');
  const r = await callHandler(imp, {
    body: {
      branch_code: D,
      config: {
        codes: codesArr(['KA', 'KB']),
        services: [{ key: 'S1', label: 'One', count: ['KA', 'KB', 'STALE'] }],
      },
    },
  });
  assert.ok(r.statusCode === 200 || r.statusCode === 502, 'import handled (sync may warn)');
  assert.deepEqual((await getKey(D, 'services'))[0].count, ['KA', 'KB'], 'stale code pruned on import');
});

// ---------- display filter equivalence ----------
test('Display filter hides stale codes (same rule as the UI safeguard)', () => {
  // The Servizi UI intersects count with the current master before rendering;
  // that is the same set pruneServiceCounts computes.
  const codes = codesArr(['KA', 'KB']);
  const shown = pruneServiceCounts([{ key: 'S1', count: ['KA', 'GHOST', 'KB'] }], codes).services[0].count;
  assert.deepEqual(shown, ['KA', 'KB'], 'stale GHOST not displayed');
});
