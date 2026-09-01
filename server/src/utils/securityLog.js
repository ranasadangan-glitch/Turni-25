// Structured security events — auth failures, account lockouts, and rate-limit
// rejections. Emitted through the shared logger under the "security" category so
// they are greppable in production and correlated to the access log by request
// id.
//
// SAFETY: only the request id, the endpoint path, and a fixed, safe reason
// string are ever logged. Request bodies, headers (Authorization / Cookie),
// tokens, passwords, and other user data are never read or logged here — the
// function only ever touches req.id and req.originalUrl.
const logger = require('./logger');

function securityEvent(req, event, reason) {
  logger.warn('security', event, {
    id: (req && req.id) || null,
    // originalUrl is the full path even inside a mounted sub-router; strip any
    // query string so ?token=… style params never reach the logs.
    endpoint: req ? String(req.originalUrl || req.url || '').split('?')[0] : null,
    reason: reason || null,
  });
}

// express-rate-limit `handler` that records a security event, then reproduces
// the limiter's normal response (status code + JSON message). The rate-limit
// headers (RateLimit-*, Retry-After) are applied by the middleware BEFORE the
// handler runs, so they are preserved unchanged.
function rateLimitEventHandler(event) {
  return (req, res, _next, options) => {
    securityEvent(req, event, 'rate_limited');
    res.status(options.statusCode).json(options.message);
  };
}

module.exports = { securityEvent, rateLimitEventHandler };
