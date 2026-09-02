const router = require('express').Router();
const bcrypt = require('bcryptjs');
const logger = require('../utils/logger');
const rateLimit = require('express-rate-limit');
const { pool } = require('../db/pool');
const { loginRate, refreshRate } = require('../config/security');
const { securityEvent, rateLimitEventHandler } = require('../utils/securityLog');
const {
  signToken, auth, audit,
  issueRefreshToken, rotateRefreshToken, revokeRefreshToken,
  isLocked, recordAttempt, LOCK_MAX_FAILS,
} = require('../middleware/auth');

// IP-level rate limit (defence layer 1). Thresholds from the centralized
// security config; a 429 emits a structured security event (no secrets).
const loginLimiter = rateLimit({
  windowMs: loginRate.windowMs,
  max: loginRate.max,
  standardHeaders: true, legacyHeaders: false,
  validate: { trustProxy: false }, // we set trust proxy globally; suppress the warning
  message: { error: 'Troppi tentativi di accesso. Riprova tra qualche minuto.' },
  handler: rateLimitEventHandler('login_rate_limited'),
});

// IP-level rate limit for the token-refresh endpoint. /refresh is
// unauthenticated and touches the DB on every call (token lookup + rotation),
// so without a throttle it is an unbounded abuse/guessing surface — the only
// credential-bearing auth endpoint that previously had no limiter. Generous
// enough for legitimate rotation across tabs/devices behind a shared NAT.
const refreshLimiter = rateLimit({
  windowMs: refreshRate.windowMs,
  max: refreshRate.max,
  standardHeaders: true, legacyHeaders: false,
  validate: { trustProxy: false }, // trust proxy is set globally; suppress the warning
  message: { error: 'Troppe richieste. Riprova tra qualche minuto.' },
  handler: rateLimitEventHandler('refresh_rate_limited'),
});

// POST /api/auth/login  { username, password }
router.post('/login', loginLimiter, async (req, res) => {
  try {
    let { username, password } = req.body || {};
    username = (username || '').trim();
    if (!username || !password)
      return res.status(400).json({ error: 'Credenziali mancanti' });

    // Account lockout check (defence layer 2) — skipped gracefully if table absent
    try {
      if (await isLocked(username, req.ip)) {
        securityEvent(req, 'login_locked', 'account_locked');
        return res.status(429).json({
          error: `Account bloccato dopo ${LOCK_MAX_FAILS} tentativi falliti. Riprova tra 15 minuti.`,
        });
      }
    } catch { /* login_attempts table may not exist on first deploy; allow login */ }

    const { rows } = await pool.query(
      'SELECT * FROM users WHERE lower(username)=lower($1)', [username]
    );
    const u = rows[0];
    if (!u || !u.active || !bcrypt.compareSync(String(password), u.password_hash)) {
      try { await recordAttempt(username, req.ip, false); } catch { /* non-fatal */ }
      securityEvent(req, 'login_failed', 'invalid_credentials');
      return res.status(401).json({ error: 'Credenziali non valide' });
    }

    try { await recordAttempt(username, req.ip, true); } catch { /* non-fatal */ }
    await pool.query('UPDATE users SET last_login=now() WHERE id=$1', [u.id]);

    const access = signToken(u);

    // Refresh token: best-effort — skipped if sessions table not yet migrated.
    let refresh = null;
    try { refresh = await issueRefreshToken(u.id, req); } catch { /* non-fatal */ }

    try {
      await audit({ user: u, ip: req.ip }, 'auth', u.id, 'login', 'Accesso effettuato');
    } catch { /* non-fatal */ }

    return res.json({
      token: access,
      ...(refresh ? { refresh } : {}),
      user: { id: u.id, username: u.username, full_name: u.full_name, role: u.role },
    });
  } catch (e) {
    logger.error('auth', 'login error', e);
    return res.status(503).json({ error: 'Servizio non disponibile, riprova tra poco.' });
  }
});

// POST /api/auth/refresh  { refresh }
router.post('/refresh', refreshLimiter, async (req, res) => {
  try {
    const raw = req.body && req.body.refresh;
    if (!raw) return res.status(400).json({ error: 'Refresh token mancante' });
    const r = await rotateRefreshToken(raw, req);
    if (r.error) return res.status(401).json({ error: 'Sessione non valida, effettua di nuovo l\'accesso' });
    return res.json({
      token: r.access, refresh: r.refresh,
      user: { id: r.user.id, username: r.user.username, full_name: r.user.full_name, role: r.user.role },
    });
  } catch (e) {
    logger.error('auth', 'refresh error', e);
    return res.status(503).json({ error: 'Servizio non disponibile' });
  }
});

// POST /api/auth/logout  { refresh? }
router.post('/logout', auth, async (req, res) => {
  try {
    const raw = req.body && req.body.refresh;
    if (raw) await revokeRefreshToken(raw).catch(() => {});
    await audit(req, 'auth', req.user.id, 'logout', 'Logout').catch(() => {});
  } catch { /* non-fatal */ }
  return res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', auth, (req, res) => res.json({ user: req.user }));

// GET /api/auth/sessions
router.get('/sessions', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, user_agent, ip, created_at, last_used_at, expires_at, revoked_at
         FROM sessions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`,
      [req.user.id]
    );
    return res.json(rows);
  } catch { return res.json([]); }
});

// DELETE /api/auth/sessions/:id
router.delete('/sessions/:id', auth, async (req, res) => {
  try {
    await pool.query(
      'UPDATE sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL',
      [req.params.id, req.user.id]
    );
    await audit(req, 'auth', req.user.id, 'logout', 'Sessione revocata').catch(() => {});
  } catch { /* non-fatal */ }
  return res.json({ ok: true });
});

// POST /api/auth/sessions/revoke-all
router.post('/sessions/revoke-all', auth, async (req, res) => {
  try {
    await pool.query(
      'UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',
      [req.user.id]
    );
    await audit(req, 'auth', req.user.id, 'logout', 'Logout da tutti i dispositivi').catch(() => {});
  } catch { /* non-fatal */ }
  return res.json({ ok: true });
});

module.exports = router;
