// Request correlation ID + lightweight structured access logging.
//
// Every request gets a stable id (req.id) echoed back in the X-Request-ID
// response header, so a browser/network error can be tied to the exact server
// log lines. An inbound X-Request-ID is honored only when it is safe for both
// a log line and an HTTP header (bounded length, no control chars / CRLF);
// anything else is replaced with a freshly generated UUID.
//
// Dependency-free: uses Node's built-in crypto (no new packages) and the
// existing utils/logger. Secrets are never logged here — only method, path
// (no query string, so ?token= style params are excluded), status code and
// duration. Request bodies, headers (Authorization/Cookie), and tokens are
// deliberately not touched.

const crypto = require('crypto');
const logger = require('../utils/logger');

// Safe for a response header value and a log line: printable, bounded, no
// whitespace/CRLF. 8–128 chars keeps ids meaningful while rejecting oversized
// or crafted values.
const VALID_ID = /^[A-Za-z0-9._-]{8,128}$/;

function requestId(req, res, next) {
  const incoming = req.headers['x-request-id'];
  const id = (typeof incoming === 'string' && VALID_ID.test(incoming))
    ? incoming
    : crypto.randomUUID();

  req.id = id;
  res.setHeader('X-Request-ID', id);

  // Capture the path NOW, at the top of the middleware chain, before any
  // mounted sub-router (app.use('/api/employees', ...)) rewrites req.url to its
  // mount-relative form. On 'finish' req.path may still be the stripped path,
  // so the captured value is what we filter and log on. req.path excludes the
  // query string, so ?token=… style params never reach the logs.
  const method = req.method;
  const reqPath = req.path;
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    // Keep production logs signal-rich: log API traffic only. Static assets and
    // frontend HTML (non-/api paths) are skipped to avoid per-asset noise, and
    // the frequent, lightweight /api/health probe is skipped too.
    if (!reqPath.startsWith('/api/') || reqPath === '/api/health') return;
    const durMs = Number(process.hrtime.bigint() - start) / 1e6;
    const level = res.statusCode >= 500 ? 'error' : (res.statusCode >= 400 ? 'warn' : 'info');
    logger[level]('http', `${method} ${reqPath} ${res.statusCode} ${durMs.toFixed(1)}ms`, { id });
  });

  next();
}

module.exports = requestId;
