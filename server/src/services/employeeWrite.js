// Canonical employee write path — the SINGLE place that turns a request body
// into an employees-table INSERT/UPDATE. Both the normal Dipendenti form
// (routes/employees.js POST/PUT) and the Excel importer (routes/xlsx.js) go
// through here, so there is never a second employee business-logic path.
//
// Responsibilities (and ONLY these): keep the multi-select arrays in sync with
// their singular primary columns, apply the field whitelist, and run the SQL.
// Audit logging and scheduler auto-regeneration stay in the callers (they are
// thin, req-/actor-scoped wrappers) so the existing POST/PUT behavior is
// byte-for-byte identical after the extraction.
const { pool } = require('../db/pool');

// Whitelist of employee columns writable through the API. Anything not listed
// is ignored (weekly_hours is intentionally absent: it is derived from the
// contract, never written by the form). Multi-select counterparts live at the
// end (see database/schema/08_multiselect.sql).
const FIELDS = ['employee_code', 'transporter_id', 'first_name', 'last_name', 'email', 'phone', 'device',
  'branch_id', 'team_id', 'service_type_id', 'contract_type_id', 'default_shift_code',
  'work_days', 'hire_date', 'contract_start_date', 'contract_end_date', 'status',
  'emergency_name', 'emergency_phone', 'notes', 'photo_url', 'nationality', 'tax_code',
  'branch_ids', 'service_type_ids', 'default_shift_codes'];

// Branch / service / shift code are multi-valued in the UI but the singular
// columns are still what RBAC scoping, the planner and the Excel export read.
// Keep them in step: the primary value is always the first of the array.
// Only touched when the client actually sent the array, so partial updates
// (e.g. PATCH-style saves of unrelated fields) never clobber it.
function syncPrimaryFromArrays(b) {
  const pairs = [
    ['branch_ids', 'branch_id'],
    ['service_type_ids', 'service_type_id'],
    ['default_shift_codes', 'default_shift_code'],
  ];
  for (const [arrKey, oneKey] of pairs) {
    if (b[arrKey] === undefined) continue;
    const arr = Array.isArray(b[arrKey]) ? b[arrKey].filter((v) => v !== null && v !== '') : [];
    b[arrKey] = arr.length ? arr : null;
    b[oneKey] = arr.length ? arr[0] : null;
  }
  return b;
}

// INSERT a new employee. `db` is a pg client (inside a transaction) or the pool
// (default). Returns the inserted row (RETURNING *).
async function createEmployee(body, actor, db = pool) {
  const b = syncPrimaryFromArrays(body || {});
  const cols = FIELDS.filter((f) => b[f] !== undefined);
  const vals = cols.map((f) => b[f]);
  const ph = cols.map((_, i) => '$' + (i + 1));
  const { rows } = await db.query(
    `INSERT INTO employees (${cols.join(',')}, added_by) VALUES (${ph.join(',')}, $${cols.length + 1}) RETURNING *`,
    [...vals, actor]
  );
  return rows[0];
}

// UPDATE an existing employee by id (partial: only the fields present in `body`
// are written, so unsupplied fields are preserved). Returns the updated row, or
// null if no whitelisted field was supplied or the id does not exist.
async function updateEmployee(id, body, actor, db = pool) {
  const b = syncPrimaryFromArrays(body || {});
  const cols = FIELDS.filter((f) => b[f] !== undefined);
  if (!cols.length) return null;
  const sets = cols.map((f, i) => `${f}=$${i + 1}`);
  const { rows } = await db.query(
    `UPDATE employees SET ${sets.join(',')} WHERE id=$${cols.length + 1} RETURNING *`,
    [...cols.map((f) => b[f]), id]
  );
  return rows[0] || null;
}

module.exports = { FIELDS, syncPrimaryFromArrays, createEmployee, updateEmployee };
