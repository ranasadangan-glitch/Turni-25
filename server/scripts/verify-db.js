// Read-only database verification — confirms a connected PostgreSQL (Render OR
// Supabase) has the full TurniDSP schema and seed state, and prints a
// deterministic per-table row-count report for parity checks.
//
// Usage:
//   DATABASE_URL=… node scripts/verify-db.js        # or: npm run db:verify
//
// It ONLY reads (SELECT / catalog lookups) — it never writes, drops, or copies
// data, and never prints the connection string or any secret. Exit code is 0
// when the structure is complete, 1 when anything required is missing, so it is
// safe to gate a migration/cutover on it. Run it against both databases and
// diff the "ROW COUNTS" block to confirm data parity.
const { pool } = require('../src/db/pool');

// The 29 base tables the app depends on (see database/schema/*).
const EXPECTED_TABLES = [
  'absences', 'audit_log', 'branches', 'contract_types', 'disciplinary_actions',
  'documents', 'employees', 'login_attempts', 'notifications', 'parking_points',
  'password_reset_tokens', 'role_defs', 'role_permissions', 'schedule_audit_log',
  'schedule_entries', 'schedule_forecasts', 'schedule_versions', 'scheduler_config',
  'scheduler_drivers', 'scheduling_rules', 'service_types', 'sessions', 'shift_codes',
  'shift_templates', 'teams', 'user_branches', 'user_services', 'user_teams', 'users',
];
const EXPECTED_VIEWS = ['v_employee_profile', 'v_expiry_alerts', 'v_forecast_days', 'v_schedule_days'];
const EXPECTED_EXTENSIONS = ['pgcrypto', 'pg_trgm'];

async function main() {
  const problems = [];

  // Server version (info only)
  const ver = await pool.query('SHOW server_version');
  console.log('PostgreSQL server_version:', ver.rows[0].server_version);

  // Extensions
  const ext = await pool.query('SELECT extname FROM pg_extension');
  const haveExt = new Set(ext.rows.map((r) => r.extname));
  for (const e of EXPECTED_EXTENSIONS) if (!haveExt.has(e)) problems.push('missing extension: ' + e);
  console.log('Extensions present:', EXPECTED_EXTENSIONS.map((e) => e + '=' + (haveExt.has(e) ? 'yes' : 'NO')).join(' '));

  // Tables & views
  const tbl = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'");
  const haveTbl = new Set(tbl.rows.map((r) => r.table_name));
  for (const t of EXPECTED_TABLES) if (!haveTbl.has(t)) problems.push('missing table: ' + t);

  const vw = await pool.query("SELECT table_name FROM information_schema.views WHERE table_schema='public'");
  const haveVw = new Set(vw.rows.map((r) => r.table_name));
  for (const v of EXPECTED_VIEWS) if (!haveVw.has(v)) problems.push('missing view: ' + v);

  console.log(`Tables: ${EXPECTED_TABLES.filter((t) => haveTbl.has(t)).length}/${EXPECTED_TABLES.length} present · ` +
    `Views: ${EXPECTED_VIEWS.filter((v) => haveVw.has(v)).length}/${EXPECTED_VIEWS.length} present`);

  // RBAC + admin seed sanity
  if (haveTbl.has('role_permissions')) {
    const rp = await pool.query('SELECT count(*)::int AS n, count(DISTINCT permission)::int AS p FROM role_permissions');
    console.log(`RBAC: role_permissions rows=${rp.rows[0].n}, distinct permissions=${rp.rows[0].p}`);
    if (rp.rows[0].n === 0) problems.push('role_permissions is empty (RBAC not seeded)');
  }
  if (haveTbl.has('users')) {
    const adm = await pool.query("SELECT count(*)::int AS n FROM users WHERE role='admin' AND active");
    console.log(`Users: active admin accounts=${adm.rows[0].n}`);
    if (adm.rows[0].n === 0) problems.push('no active admin user');
  }

  // Deterministic per-table row counts (sorted) — diff this block across DBs for parity.
  console.log('\n--- ROW COUNTS (diff across databases for parity) ---');
  for (const t of EXPECTED_TABLES) {           // EXPECTED_TABLES is already sorted
    if (!haveTbl.has(t)) { console.log(`${t.padEnd(24)} MISSING`); continue; }
    // eslint-disable-next-line no-await-in-loop
    const c = await pool.query(`SELECT count(*)::bigint AS n FROM ${t}`);
    console.log(`${t.padEnd(24)} ${c.rows[0].n}`);
  }
  console.log('--- END ROW COUNTS ---\n');

  if (problems.length) {
    console.error('VERIFY: FAIL — ' + problems.length + ' problem(s):');
    problems.forEach((p) => console.error('  - ' + p));
    return 1;
  }
  console.log('VERIFY: PASS — schema, extensions, RBAC and admin all present.');
  return 0;
}

main()
  .then((code) => pool.end().then(() => process.exit(code)))
  .catch((e) => {
    console.error('VERIFY: ERROR —', e.message);
    pool.end().finally(() => process.exit(1));
  });
