// Role-based access control for the four roles:
//   admin        — full system access
//   osm          — forecast, schedules, employee VIEW, reports
//   hr_manager   — employees, contracts, documents, absences
//   team_leader  — view schedules, view employees, daily operations only
//
// Permissions are coarse capability strings checked by requirePermission().

const ROLES = ['admin', 'osm', 'hr_manager', 'team_leader'];

// capability -> roles allowed
const MATRIX = {
  // employees
  'employee.view':        ['admin', 'osm', 'hr_manager', 'team_leader'],
  'employee.manage':      ['admin', 'hr_manager'],
  // contracts & documents (HR)
  'contract.manage':      ['admin', 'hr_manager'],
  'document.view':        ['admin', 'hr_manager', 'osm'],
  'document.manage':      ['admin', 'hr_manager'],
  // absences (HR, with OSM/TL view)
  'absence.view':         ['admin', 'hr_manager', 'osm', 'team_leader'],
  'absence.manage':       ['admin', 'hr_manager'],
  // scheduling
  'schedule.view':        ['admin', 'osm', 'hr_manager', 'team_leader'],
  'schedule.manage':      ['admin', 'osm'],
  // forecast
  'forecast.view':        ['admin', 'osm', 'team_leader'],
  'forecast.manage':      ['admin', 'osm'],
  // disciplinary (HR)
  'disciplinary.view':    ['admin', 'hr_manager'],
  'disciplinary.manage':  ['admin', 'hr_manager'],
  // teams
  'team.view':            ['admin', 'osm', 'hr_manager', 'team_leader'],
  'team.manage':          ['admin'],
  // reports
  'report.view':          ['admin', 'osm', 'hr_manager'],
  // audit & users & config
  'audit.view':           ['admin'],
  'user.manage':          ['admin'],
  'config.manage':        ['admin'],
};

// All capability strings the system knows about.
const ALL_PERMISSIONS = Object.keys(MATRIX);

// Effective matrix loaded from the DB (role_permissions). Null until loaded;
// while null we fall back to the hardcoded MATRIX so the server is never left
// without RBAC during startup. Shape: { permission: Set(roles) }.
let EFFECTIVE = null;

// Load / reload the permission cache from the database. Called at startup and
// after any change made through the roles API. Never throws: on failure it
// leaves EFFECTIVE as-is (or null → fallback to MATRIX) and returns false, so
// a transient DB blip can never break authentication. Returns true once a
// permission map is in place.
async function loadPermissions() {
  try {
    const { pool } = require('../db/pool');
    const { rows } = await pool.query('SELECT role, permission FROM role_permissions');
    const m = {};
    for (const r of rows) { (m[r.permission] = m[r.permission] || new Set()).add(r.role); }
    EFFECTIVE = m;
    return true;
  } catch (e) {
    // leave EFFECTIVE as-is (or null → fallback to MATRIX)
    require('../utils/logger').warn('rbac', 'loadPermissions failed: ' + e.message);
    return false;
  }
}

// Startup loader with a bounded exponential backoff. Non-blocking: callers do
// NOT await this (the server starts listening regardless), so a slow/failed DB
// at boot never delays startup — RBAC transparently uses the MATRIX fallback
// until a load succeeds. Stops as soon as EFFECTIVE is populated. Total worst
// case ≈ 7.5s of background retries (500ms doubling over 5 attempts).
async function loadPermissionsWithRetry(maxAttempts = 5, baseDelayMs = 500) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (await loadPermissions()) return true;
    if (attempt < maxAttempts) {
      const delay = baseDelayMs * 2 ** (attempt - 1);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  return false;
}

// Readiness probe for /api/health: true once the DB-backed permission matrix
// has been loaded at least once. While false the app still works via MATRIX,
// but health surfaces "not ready" so the operator/platform can see that the
// DB-backed permissions never loaded. No secrets — a plain boolean.
function rbacReady() {
  return EFFECTIVE !== null;
}

function roleAllowed(permission, role) {
  if (EFFECTIVE) {
    const s = EFFECTIVE[permission];
    return !!(s && s.has(role));
  }
  const allowed = MATRIX[permission];
  return Array.isArray(allowed) && allowed.includes(role);
}

// Express middleware: require one of the given roles.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Non autenticato' });
    if (req.user.role === 'admin' || roles.includes(req.user.role)) return next();
    return res.status(403).json({ error: 'Permesso negato per il tuo ruolo' });
  };
}

// Express middleware: require a capability from the matrix.
function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Non autenticato' });
    // admin is a super-role: always allowed, so no permission edit can ever
    // lock the administrator out of the system.
    if (req.user.role === 'admin') return next();
    if (roleAllowed(permission, req.user.role)) return next();
    return res.status(403).json({ error: 'Permesso negato: ' + permission });
  };
}

module.exports = { ROLES, MATRIX, ALL_PERMISSIONS, roleAllowed, requireRole, requirePermission, loadPermissions, loadPermissionsWithRetry, rbacReady };
