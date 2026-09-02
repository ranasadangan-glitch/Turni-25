// Centralized security configuration — the single source of truth for the auth
// rate-limit, token-refresh, password-reset and account-lockout thresholds that
// were previously duplicated inline across routes/auth.js, routes/password.js
// and middleware/auth.js.
//
// Every value reads from an env var using the SAME coercion and default that
// was previously inline (`+(process.env.X || default)`), so limits and behavior
// are byte-for-byte unchanged — this only removes duplication and makes the
// knobs discoverable and overridable in one place. No secrets live here (only
// numeric thresholds); secret material stays in its own env vars.

const MINUTE_MS = 60 * 1000;

// Mirror the historical `+(process.env.X || default)` semantics exactly:
// undefined/'' -> default; '0' -> 0; any numeric string -> that number.
function num(name, def) {
  return +(process.env[name] || def);
}

const RATE_WINDOW_MIN = 15; // shared 15-minute window for all IP rate limiters

// bcrypt cost factor (rounds). Default 10 — the value historically hardcoded at
// every hashing call site. Validated safely: BCRYPT_ROUNDS must be an integer in
// the range bcryptjs supports (4–31). Anything missing, non-numeric, or out of
// range falls back to the default rather than producing an unusable/weak cost.
const BCRYPT_ROUNDS_DEFAULT = 10;
const BCRYPT_ROUNDS_MIN = 4;   // bcryptjs minimum
const BCRYPT_ROUNDS_MAX = 31;  // bcryptjs maximum

function resolveBcryptRounds() {
  const raw = process.env.BCRYPT_ROUNDS;
  if (raw === undefined || raw === '') return BCRYPT_ROUNDS_DEFAULT;
  // Reject non-integer strings (e.g. "10.5", "abc", "0x0a") explicitly.
  if (!/^\d+$/.test(String(raw).trim())) return BCRYPT_ROUNDS_DEFAULT;
  const n = parseInt(raw, 10);
  if (!Number.isInteger(n) || n < BCRYPT_ROUNDS_MIN || n > BCRYPT_ROUNDS_MAX) return BCRYPT_ROUNDS_DEFAULT;
  return n;
}

module.exports = {
  bcryptRounds: resolveBcryptRounds(),
  // IP rate limiters (express-rate-limit)
  loginRate:   { windowMs: RATE_WINDOW_MIN * MINUTE_MS, max: num('LOGIN_RATE_MAX', 20) },
  refreshRate: { windowMs: RATE_WINDOW_MIN * MINUTE_MS, max: num('REFRESH_RATE_MAX', 60) },
  resetRate:   { windowMs: RATE_WINDOW_MIN * MINUTE_MS, max: num('RESET_RATE_MAX', 10) },
  // DB-backed account lockout (middleware/auth.js)
  lockout:     { windowMin: num('LOCK_WINDOW_MIN', 15), maxFails: num('LOCK_MAX_FAILS', 5) },
};
