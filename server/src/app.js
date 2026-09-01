require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { pool } = require('./db/pool');

const app = express();

// Trust exactly ONE reverse-proxy hop. Every deploy target in this project is
// single-hop (Render/Railway edge, or Nginx on a VPS). `true` trusted every
// upstream, which let a client spoof X-Forwarded-For and poison req.ip — the
// value the login rate limiter and account lockout key on. `1` takes the
// client IP from the entry the trusted proxy appended, which the client
// cannot forge.
app.set('trust proxy', 1);

// ---- (1) HTTPS only: redirect HTTP -> HTTPS, but ONLY when explicitly enabled ----
// This used to trigger on NODE_ENV=production alone. That is correct on Render/
// Railway (which always terminate TLS at their edge and reliably set
// x-forwarded-proto), but breaks a self-managed VPS deployment in two ways:
//   1. If Nginx hasn't been configured with `proxy_set_header X-Forwarded-Proto
//      $scheme;` yet, Express never sees "https" even when the client really is
//      on HTTPS -> it 301s to https://... -> Nginx forwards that new HTTPS
//      request to Node over plain HTTP again -> infinite redirect loop.
//   2. If the VPS doesn't have a TLS certificate yet (very common while first
//      standing up a box, testing over plain HTTP), EVERY request gets redirected
//      to an https:// URL that has nothing listening on it -> the site is
//      completely unreachable, with no useful error for the operator.
// Fix: require an explicit FORCE_HTTPS=true opt-in, independent of NODE_ENV.
// Render/Railway set FORCE_HTTPS=true in their env config (see render.yaml /
// railway.json); a VPS operator turns it on only once Nginx is verified to be
// forwarding the proto header correctly. See docs/VPS.md.
const FORCE_HTTPS = process.env.FORCE_HTTPS === 'true';
app.use((req, res, next) => {
  if (!FORCE_HTTPS) return next();
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  if (proto === 'https') return next();
  if (req.path.startsWith('/api/')) {
    return res.status(400).json({ error: 'Richiesta HTTPS richiesta. Usa https://' + req.headers.host + req.originalUrl });
  }
  return res.redirect(301, 'https://' + req.headers.host + req.originalUrl);
});

// ---- (1)(4) security headers ----
// HSTS is included ONLY when FORCE_HTTPS is on: sending it on a deployment that
// isn't guaranteed to be reachable over HTTPS is actively harmful — browsers
// that receive it will refuse to connect over plain HTTP for the full maxAge,
// with no easy way for an operator to undo it short of the user manually
// clearing HSTS state in their browser.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // cdnjs.cloudflare.com hosts Chart.js, loaded by app.html for the
      // Workspace/Analytics charts. Without this, Helmet's CSP silently
      // blocks that <script> tag in any environment where CSP is enforced —
      // charts would just never render, with no visible error to the user
      // (only a CSP violation in the browser devtools console).
      // CSP hardening (Phases 1–2): all inline <script> blocks were externalized
      // to self-hosted .js files, and every inline on*= handler was migrated to
      // delegated listeners (js/core/actions.js). So neither 'unsafe-inline' is
      // needed any longer. cdnjs hosts Chart.js (Workspace/Analytics charts).
      scriptSrc: ["'self'", 'https://cdnjs.cloudflare.com'],
      // No inline event-handler attributes remain, so forbid them outright.
      scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'self'"],
    },
  },
  hsts: FORCE_HTTPS ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
  crossOriginEmbedderPolicy: false,
}));

// ---- restricted CORS (item 1) ----
// The frontend is served by this same Express server, so its own origin must
// always be allowed automatically — no manual CORS_ORIGIN configuration should
// be required for the app to work out of the box. Additional cross-origin
// hosts (e.g. a separately hosted frontend) can still be added via CORS_ORIGIN.
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

app.use(cors((req, cb) => {
  const origin = req.headers.origin;
  const corsOptions = { credentials: true };
  if (!origin) { corsOptions.origin = true; return cb(null, corsOptions); }      // same-origin / curl
  if (allowedOrigins.includes(origin)) { corsOptions.origin = true; return cb(null, corsOptions); }
  // Always allow the request's own host (covers Render/Railway/any domain where
  // the frontend and API share the same server) without any manual configuration.
  try {
    if (new URL(origin).host === req.headers.host) { corsOptions.origin = true; return cb(null, corsOptions); }
  } catch { /* malformed Origin header, fall through */ }
  corsOptions.origin = false;
  return cb(null, corsOptions);
}));

app.use(express.json({ limit: '2mb' }));

// ---- API routes ----
app.use('/api/auth', require('./routes/auth'));
app.use('/api/password', require('./routes/password').router);
app.use('/api/employees', require('./routes/employees'));
app.use('/api/schedules', require('./routes/schedules'));
app.use('/api/teams', require('./routes/teams'));
app.use('/api/forecast', require('./routes/forecast'));
app.use('/api/absences', require('./routes/absences'));
app.use('/api/disciplinary', require('./routes/disciplinary'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api/alerts', require('./routes/alerts'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/audit', require('./routes/audit'));
app.use('/api/meta', require('./routes/meta'));
app.use('/api/xlsx', require('./routes/xlsx'));
app.use('/api/pdf', require('./routes/pdf'));
app.use('/api/scheduler', require('./routes/scheduler'));
app.use('/api/kpi',           require('./routes/kpi'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/search',        require('./routes/search'));
app.use('/api/roles',         require('./routes/roles'));

// Load the DB-backed permission matrix into the RBAC cache at startup, with a
// bounded, non-blocking retry/backoff so a transient DB hiccup at boot self-
// heals. Not awaited: the server starts listening immediately and falls back to
// the hardcoded matrix until a load succeeds. /api/health reports readiness.
const rbac = require('./middleware/rbac');
rbac.loadPermissionsWithRetry().catch(() => {});

// uploaded files (PDFs) — honor UPLOAD_DIR (e.g. a Railway/Render volume).
// Protected: these are disciplinary/HR documents, so require a valid token
// (accepted via Authorization header or ?token= for direct links).
const UPLOADS = process.env.UPLOAD_DIR || path.resolve(__dirname, '../uploads');
const { auth } = require('./middleware/auth');
app.use('/uploads', auth, express.static(UPLOADS, { dotfiles: 'deny', index: false }));

// health — verifies DB connectivity AND that the schema is present, so a
// reachable-but-unmigrated instance (e.g. Render's first deploy skips the
// pre-deploy migrate) fails the platform healthcheck instead of silently
// receiving traffic it can't serve. A single, bounded catalog lookup covers
// both: to_regclass() is a cheap system-catalog probe (no table scan) that
// returns NULL — never an error — when the table is absent, so the query
// succeeding proves connectivity and its boolean proves the schema exists.
// `users` is the core table login depends on.
app.get('/api/health', async (_req, res) => {
  try {
    const r = await Promise.race([
      pool.query("SELECT to_regclass('public.users') IS NOT NULL AS ready"),
      new Promise((_, rej) => setTimeout(() => rej(new Error('db timeout')), 2500)),
    ]);
    if (!r.rows[0].ready) {
      // DB reachable but schema not installed yet.
      return res.status(503).json({ ok: false, db: 'up', schema: 'missing', ts: new Date().toISOString() });
    }
    // DB + schema are up. Also surface RBAC readiness: the app still functions
    // via the hardcoded MATRIX fallback when the DB-backed matrix hasn't loaded,
    // but that's a degraded state an operator should see — so fail the
    // healthcheck (503) with a clear, non-secret status rather than hide it.
    if (!rbac.rbacReady()) {
      return res.status(503).json({ ok: false, db: 'up', rbac: 'not_ready', ts: new Date().toISOString() });
    }
    res.json({ ok: true, db: 'up', rbac: 'ready', ts: new Date().toISOString() });
  } catch (e) {
    res.status(503).json({ ok: false, db: 'down', ts: new Date().toISOString() });
  }
});

// Any /api/* request that reached this point matched no API route above.
// Return a JSON 404 instead of falling through to the SPA catch-all
// (app.get('*') → login.html), which would answer a bad/removed endpoint
// with 200 + HTML and silently break JSON clients. Placed after every API
// route (incl. /api/health) and before the static/SPA handlers.
app.all('/api/*', (_req, res) => res.status(404).json({ error: 'Not found' }));

// ---- serve the frontend ----
// The login page IS the index: '/' serves login.html directly. After
// authentication, app.html (the unified Workspace shell — Dashboard +
// Scheduler merged into one continuous view, plus People/Analytics/
// Settings as sibling sections) is the app's single entry point.
//
// True SPA: the only two HTML files on disk are login.html and app.html.
// The legacy feature pages (index/dashboard/scheduler/employees.html) have
// been DELETED. Their old URLs still resolve: the LEGACY_REDIRECTS list
// below 301-redirects each one to /app so existing bookmarks never 404.
// URL hashes aren't sent to the server, so an old employees.html#123
// bookmark lands on the Workspace without auto-opening that profile —
// accepted trade-off. In-app notification links use navFromUrl() to
// preserve deep links client-side. New code must never reference these URLs.
const FRONT = path.resolve(__dirname, '../frontend');

const LEGACY_REDIRECTS = ['/index.html', '/dashboard.html', '/scheduler.html', '/employees.html'];
LEGACY_REDIRECTS.forEach((route) => {
  app.get(route, (_req, res) => res.redirect(301, '/app'));
});

app.use(express.static(FRONT, { index: false }));   // don't auto-serve index.html at '/'

app.get('/', (_req, res) => res.sendFile(path.join(FRONT, 'login.html')));
// The application shell — Workspace/People/Analytics/Settings all live here.
app.get('/app', (_req, res) => res.sendFile(path.join(FRONT, 'app.html')));

// fallback: unknown non-API routes go to the login page
app.get('*', (_req, res) => res.sendFile(path.join(FRONT, 'login.html')));

// error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Errore interno' });
});

// Safety net: log unexpected async errors instead of letting the process die.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason && reason.message ? reason.message : reason);
});

const PORT = +(process.env.PORT || 3000);
app.listen(PORT, () => console.log(`TurniDSP Platform API on http://localhost:${PORT}`));
