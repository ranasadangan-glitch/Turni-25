// ============================================================
// Security configuration + structured security events — regression + safety.
//
// Covers:
//   - config/security.js exposes the historical defaults and honors env
//     overrides (so centralizing the thresholds did not change any limit).
//   - utils/securityLog.js emits an event carrying ONLY request id, endpoint
//     and a safe reason, and never leaks secrets (tokens, Authorization/Cookie
//     headers, passwords, or a ?token= query string).
//   - rateLimitEventHandler logs the event and preserves the limiter's
//     status code + JSON body.
//
// Dependency-free: Node's built-in test runner (node:test) + node:assert.
// No database required. Run with:  npm test  (from the server/ directory)
// ============================================================
const test = require('node:test');
const assert = require('node:assert');

const CONFIG_PATH = require.resolve('../src/config/security');
const LOG_PATH = require.resolve('../src/utils/securityLog');

// Capture whatever the shared logger writes to console during fn().
function capture(fn) {
  const lines = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...a) => lines.push(a.join(' '));
  console.warn = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  try { fn(); } finally { Object.assign(console, orig); }
  return lines.join('\n');
}

function freshConfig() {
  delete require.cache[CONFIG_PATH];
  return require('../src/config/security');
}

test('config: defaults match the historical inline values', () => {
  const keys = ['LOGIN_RATE_MAX', 'REFRESH_RATE_MAX', 'RESET_RATE_MAX', 'LOCK_WINDOW_MIN', 'LOCK_MAX_FAILS'];
  const saved = {};
  keys.forEach((k) => { saved[k] = process.env[k]; delete process.env[k]; });
  try {
    const s = freshConfig();
    assert.equal(s.loginRate.max, 20);
    assert.equal(s.refreshRate.max, 60);
    assert.equal(s.resetRate.max, 10);
    assert.equal(s.lockout.windowMin, 15);
    assert.equal(s.lockout.maxFails, 5);
    // shared 15-minute window
    assert.equal(s.loginRate.windowMs, 15 * 60 * 1000);
    assert.equal(s.refreshRate.windowMs, 15 * 60 * 1000);
    assert.equal(s.resetRate.windowMs, 15 * 60 * 1000);
  } finally {
    keys.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
    freshConfig(); // restore cache to real env
  }
});

test('config: env overrides are honored', () => {
  const saved = { L: process.env.LOGIN_RATE_MAX, F: process.env.LOCK_MAX_FAILS };
  process.env.LOGIN_RATE_MAX = '7';
  process.env.LOCK_MAX_FAILS = '3';
  try {
    const s = freshConfig();
    assert.equal(s.loginRate.max, 7);
    assert.equal(s.lockout.maxFails, 3);
  } finally {
    if (saved.L === undefined) delete process.env.LOGIN_RATE_MAX; else process.env.LOGIN_RATE_MAX = saved.L;
    if (saved.F === undefined) delete process.env.LOCK_MAX_FAILS; else process.env.LOCK_MAX_FAILS = saved.F;
    freshConfig();
  }
});

test('securityEvent logs id + endpoint + reason', () => {
  const { securityEvent } = require('../src/utils/securityLog');
  const req = { id: 'REQ-abc123', originalUrl: '/api/auth/login', method: 'POST' };
  const out = capture(() => securityEvent(req, 'login_failed', 'invalid_credentials'));
  assert.match(out, /\[security\]/);
  assert.match(out, /login_failed/);
  assert.match(out, /REQ-abc123/);
  assert.match(out, /\/api\/auth\/login/);
  assert.match(out, /invalid_credentials/);
});

test('securityEvent never leaks secrets (headers, body, token, query string)', () => {
  const { securityEvent } = require('../src/utils/securityLog');
  const req = {
    id: 'REQ-secret-test',
    // a query string that carries a token — must be stripped from the endpoint
    originalUrl: '/api/password/reset?token=QUERY_SECRET_TOKEN',
    method: 'POST',
    headers: {
      authorization: 'Bearer HEADER_SECRET_JWT',
      cookie: 'sid=COOKIE_SECRET_VALUE',
    },
    body: { username: 'admin', password: 'BODY_SECRET_PASSWORD' },
  };
  const out = capture(() => securityEvent(req, 'password_reset_rate_limited', 'rate_limited'));
  // endpoint present without its query string (note: the path itself contains
  // the word "password" — that is the route name, not a secret value)
  assert.match(out, /\/api\/password\/reset/);
  assert.doesNotMatch(out, /token=/); // query string fully stripped
  // none of the concrete secret VALUES appear
  for (const secret of ['QUERY_SECRET_TOKEN', 'HEADER_SECRET_JWT', 'COOKIE_SECRET_VALUE', 'BODY_SECRET_PASSWORD', 'Bearer']) {
    assert.doesNotMatch(out, new RegExp(secret), `leaked: ${secret}`);
  }
});

test('securityEvent tolerates a missing/partial req', () => {
  const { securityEvent } = require('../src/utils/securityLog');
  const out = capture(() => securityEvent(null, 'login_failed', 'invalid_credentials'));
  assert.match(out, /login_failed/);
  assert.match(out, /"id":null/);
  assert.match(out, /"endpoint":null/);
});

test('rateLimitEventHandler logs the event and preserves status + JSON body', () => {
  const { rateLimitEventHandler } = require('../src/utils/securityLog');
  const req = { id: 'REQ-rl', originalUrl: '/api/auth/refresh' };
  let sentStatus = null; let sentJson = null;
  const res = { status(c) { sentStatus = c; return this; }, json(b) { sentJson = b; return this; } };
  const options = { statusCode: 429, message: { error: 'Troppe richieste. Riprova tra qualche minuto.' } };
  const out = capture(() => rateLimitEventHandler('refresh_rate_limited')(req, res, () => {}, options));
  assert.equal(sentStatus, 429);
  assert.deepEqual(sentJson, { error: 'Troppe richieste. Riprova tra qualche minuto.' });
  assert.match(out, /refresh_rate_limited/);
  assert.match(out, /rate_limited/);
  assert.match(out, /REQ-rl/);
});
