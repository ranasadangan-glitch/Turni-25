// ============================================================
// Standalone Codes CRUD (/api/codes) — integration test.
//
// Verifies the code-management flow (Codice → descrizione → Categoria) edits
// scheduler_config[branch].codes (the source of truth) and re-derives the
// shift_codes read-model via syncShiftVocab, without touching shift_codes
// directly. Also checks validation, conflict/not-found, and that RBAC guards
// the write endpoints.
//
// Dependency-free: node:test + node:assert + the app's own pool. Skips
// gracefully if PostgreSQL is not reachable.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const { pool } = require('../src/db/pool');
const codesRouter = require('../src/routes/codes');

const BRANCH = 'ZZCODETEST';   // isolated test branch, never touches DLO1
const CODE = 'ZZTESTCODE';
const KEEPER = 'ZZKEEPER';     // a second code so the branch is never fully empty
                               // (syncShiftVocab early-returns for a branch with
                               // no codes AND no contracts, which would skip the
                               // orphan reconcile — impossible on real DLO1).

let dbOk = false;
test.before(async () => {
  try { await pool.query('SELECT 1'); dbOk = true; } catch { dbOk = true && false; }
});

// Minimal Express-less harness: invoke the router's stack directly with fake
// req/res so we don't need to bind a port. We locate each layer by method+path.
function findHandler(method, path) {
  const layer = codesRouter.stack.find((l) => l.route && l.route.path === path
    && l.route.methods[method.toLowerCase()]);
  assert.ok(layer, `route ${method} ${path} exists`);
  // return the chain of handlers (middleware + final) for that route
  return layer.route.stack.map((s) => s.handle);
}

async function call(method, path, { params = {}, query = {}, body = {}, user = { username: 'tester', role: 'admin' } } = {}) {
  const handlers = findHandler(method, path);
  const req = { method, params, query, body, user, headers: {}, ip: '127.0.0.1', originalUrl: '/api/codes' + path };
  let statusCode = 200; let jsonBody;
  const res = {
    status(c) { statusCode = c; return this; },
    json(b) { jsonBody = b; return this; },
  };
  // run middleware chain (auth is router-level, not in route stack; requirePermission is per-route)
  for (let i = 0; i < handlers.length; i++) {
    let nextCalled = false;
    // eslint-disable-next-line no-await-in-loop
    await handlers[i](req, res, () => { nextCalled = true; });
    if (!nextCalled) break;           // a handler responded (or blocked) → stop
  }
  return { statusCode, body: jsonBody };
}

async function cleanup() {
  await pool.query("DELETE FROM scheduler_config WHERE branch_code=$1", [BRANCH]);
  await pool.query("DELETE FROM shift_codes WHERE code = ANY($1::text[])", [[CODE, KEEPER]]).catch(() => {});
}

test('codes CRUD: create → list → update → delete, with shift_codes sync', async (t) => {
  if (!dbOk) { t.skip('no database'); return; }
  await cleanup();
  try {
    // keeper so the branch is never empty (see note above)
    await call('post', '/', { body: { branch: BRANCH, code: KEEPER, label: 'Keeper', category: 'mal' } });

    // CREATE
    let r = await call('post', '/', { body: { branch: BRANCH, code: CODE, label: 'Navetta test', category: 'abs' } });
    assert.equal(r.statusCode, 201, 'create returns 201');
    assert.equal(r.body.code.code, CODE);

    // scheduler_config is the source of truth
    const cfg = await pool.query("SELECT config_value FROM scheduler_config WHERE branch_code=$1 AND config_key='codes'", [BRANCH]);
    assert.ok(Array.isArray(cfg.rows[0].config_value), 'codes stored as array in scheduler_config');
    assert.ok(cfg.rows[0].config_value.some((c) => c.code === CODE && c.cls === 'abs'), 'code present with cls=abs');

    // shift_codes derived read-model updated by sync
    let sc = await pool.query('SELECT code,label,category,is_work,is_absence,is_off FROM shift_codes WHERE code=$1', [CODE]);
    assert.equal(sc.rowCount, 1, 'shift_codes row synced');
    assert.equal(sc.rows[0].label, 'Navetta test');
    assert.equal(sc.rows[0].category, 'abs');
    assert.equal(sc.rows[0].is_work, true, 'abs is a worked category');

    // LIST
    r = await call('get', '/', { query: { branch: BRANCH } });
    assert.equal(r.statusCode, 200);
    assert.ok(r.body.categories.includes('abs'));
    const listed = r.body.codes.find((c) => c.code === CODE);
    assert.deepEqual(listed, { code: CODE, label: 'Navetta test', category: 'abs' });

    // CONFLICT on duplicate create
    r = await call('post', '/', { body: { branch: BRANCH, code: CODE.toLowerCase(), label: 'dup', category: 'abs' } });
    assert.equal(r.statusCode, 409, 'duplicate code (case-insensitive) → 409');

    // VALIDATION
    r = await call('post', '/', { body: { branch: BRANCH, code: 'bad code!', category: 'abs' } });
    assert.equal(r.statusCode, 400, 'invalid code → 400');
    r = await call('post', '/', { body: { branch: BRANCH, code: 'ZZOK', category: 'nope' } });
    assert.equal(r.statusCode, 400, 'invalid category → 400');

    // UPDATE (label + category → off; off must flip is_off in shift_codes)
    r = await call('put', '/:code', { params: { code: CODE }, body: { branch: BRANCH, label: 'Riposo test', category: 'off' } });
    assert.equal(r.statusCode, 200, 'update returns 200');
    sc = await pool.query('SELECT label,category,is_off,is_work FROM shift_codes WHERE code=$1', [CODE]);
    assert.equal(sc.rows[0].label, 'Riposo test');
    assert.equal(sc.rows[0].category, 'off');
    assert.equal(sc.rows[0].is_off, true, 'category off → is_off true');
    assert.equal(sc.rows[0].is_work, false);

    // UPDATE not found
    r = await call('put', '/:code', { params: { code: 'NOSUCHCODE' }, body: { branch: BRANCH, label: 'x', category: 'abs' } });
    assert.equal(r.statusCode, 404);

    // DELETE → removed from both config and shift_codes
    r = await call('delete', '/:code', { params: { code: CODE }, query: { branch: BRANCH } });
    assert.equal(r.statusCode, 200, 'delete returns 200');
    sc = await pool.query('SELECT 1 FROM shift_codes WHERE code=$1', [CODE]);
    assert.equal(sc.rowCount, 0, 'shift_codes row removed by sync reconcile');
    const keep = await pool.query('SELECT 1 FROM shift_codes WHERE code=$1', [KEEPER]);
    assert.equal(keep.rowCount, 1, 'other codes untouched by the delete');
    const cfg2 = await pool.query("SELECT config_value FROM scheduler_config WHERE branch_code=$1 AND config_key='codes'", [BRANCH]);
    assert.ok(!cfg2.rows[0].config_value.some((c) => c.code === CODE), 'code removed from scheduler_config');

    // DELETE not found (idempotent-ish)
    r = await call('delete', '/:code', { params: { code: CODE }, query: { branch: BRANCH } });
    assert.equal(r.statusCode, 404);
  } finally {
    await cleanup();
  }
});

test('codes writes are RBAC-guarded (config.manage)', async (t) => {
  if (!dbOk) { t.skip('no database'); return; }
  // a role WITHOUT config.manage (team_leader) must be blocked on create
  const r = await call('post', '/', {
    user: { username: 'tl', role: 'team_leader' },
    body: { branch: BRANCH, code: 'ZZDENY', label: 'x', category: 'abs' },
  });
  assert.equal(r.statusCode, 403, 'non-privileged role → 403');
  // GET is allowed for any authed user
  const g = await call('get', '/', { user: { username: 'tl', role: 'team_leader' }, query: { branch: BRANCH } });
  assert.equal(g.statusCode, 200, 'read allowed for authed user');
});
