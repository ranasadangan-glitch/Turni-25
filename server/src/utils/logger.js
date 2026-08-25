// ─────────────────────────────────────────────────────────────────────────
// Centralized logger.
//
// Replaces scattered `console.error(...)` / `console.warn(...)` calls across
// route files with one structured, leveled entry point. Output still goes to
// stdout/stderr (what Render/Railway/PM2 capture today), so this is a
// drop-in — no new infra required — but every log line is now:
//   - timestamped (ISO 8601)
//   - leveled (error / warn / info)
//   - tagged with a category (auth, employees, scheduler, ...)
// which makes it possible to grep/filter logs by category in production,
// and gives a single place to later add remote log shipping if needed.
//
// This does NOT replace the audit trail (middleware/auth.js `audit()`,
// writing to the audit_log table) — that records *business* actions
// (who changed what). This logger is for *technical* events: caught
// exceptions, failed external calls, startup/shutdown, warnings.
// ─────────────────────────────────────────────────────────────────────────

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const CURRENT_LEVEL = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;

function ts() {
  return new Date().toISOString();
}

function format(level, category, message, meta) {
  const base = `[${ts()}] ${level.toUpperCase().padEnd(5)} [${category}] ${message}`;
  if (meta === undefined || meta === null) return base;
  if (meta instanceof Error) return `${base} — ${meta.message}${meta.stack ? '\n' + meta.stack : ''}`;
  if (typeof meta === 'object') {
    try { return `${base} — ${JSON.stringify(meta)}`; } catch { return base; }
  }
  return `${base} — ${meta}`;
}

function emit(level, category, message, meta) {
  if (LEVELS[level] > CURRENT_LEVEL) return;
  const line = format(level, category, message, meta);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

const logger = {
  error: (category, message, meta) => emit('error', category, message, meta),
  warn:  (category, message, meta) => emit('warn',  category, message, meta),
  info:  (category, message, meta) => emit('info',  category, message, meta),
  debug: (category, message, meta) => emit('debug', category, message, meta),
};

module.exports = logger;
