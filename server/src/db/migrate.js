// Runs the schema (and optionally seeds) against the configured database.
// Reads the connection (incl. SSL) from src/db/pool.js, which honors
// DATABASE_URL + SSL automatically (Render/Railway/Heroku compatible).
//
// Usage:
//   node src/db/migrate.js          -> schema + indexes (idempotent)
//   node src/db/migrate.js --seed   -> schema + indexes + seed data
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { pool } = require('./pool');
const { bcryptRounds } = require('../config/security');

async function runFile(file) {
  const sql = fs.readFileSync(file, 'utf8');
  console.log('Running', path.basename(file), '...');
  await pool.query(sql);
}

// Guarantees a working admin login even if the seed step was never run.
// Only inserts when the users table is empty, so it never overwrites real data.
async function ensureAdmin() {
  const username = (process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD;
  const reset = process.env.RESET_ADMIN === 'true';
  const isProd = process.env.NODE_ENV === 'production';

  // Does the admin account exist at all?
  const adm = await pool.query('SELECT id, password_hash, active FROM users WHERE lower(username)=$1', [username]);
  const exists = adm.rowCount > 0;

  // Create if missing, or (re)set when RESET_ADMIN=true, or if the row is inactive.
  const needFix = !exists || reset || (exists && adm.rows[0].active === false);
  if (needFix) {
    // In production we must NEVER provision the admin with the well-known default
    // password: that ships a publicly guessable credential. Fail the migration
    // clearly (the process exits non-zero, so `npm start` never starts serving)
    // rather than create a predictable account. Set ADMIN_PASSWORD in the deploy
    // env to unblock. Note: this only triggers when the admin actually needs to
    // be (re)created — an already-provisioned prod instance boots unaffected.
    if (isProd && !adminPassword) {
      throw new Error(
        'Refusing to create/reset the admin account with the default password in production. ' +
        'Set ADMIN_PASSWORD (a strong secret) in the deployment environment and redeploy. ' +
        'The password value is never logged.'
      );
    }
    const pw = adminPassword || 'admin123';
    const hash = bcrypt.hashSync(pw, bcryptRounds);
    await pool.query(
      `INSERT INTO users (username, password_hash, full_name, role, active)
       VALUES ($1, $2, 'Amministratore', 'admin', TRUE)
       ON CONFLICT (username)
       DO UPDATE SET password_hash = EXCLUDED.password_hash, active = TRUE, role = 'admin'`,
      [username, hash]
    );
    const how = !exists ? 'created' : (reset ? 'reset (RESET_ADMIN=true)' : 're-activated');
    console.log(`Admin bootstrap: ${how} login "${username}" (password ${process.env.ADMIN_PASSWORD ? 'from ADMIN_PASSWORD' : '"admin123"'}). Change it after first login.`);
  } else {
    console.log(`Admin bootstrap: login "${username}" already present and active. To reset its password set RESET_ADMIN=true (and optionally ADMIN_PASSWORD) and redeploy.`);
  }
}

// Serialize concurrent migration runners (multiple instances / restart storms)
// with a Postgres session advisory lock. Idempotent SQL makes a partial-then-
// retry safe; a crashed holder's session ends and auto-releases the lock.
const MIGRATION_LOCK_KEY = 472025;
let _lockClient = null;

(async () => {
  try {
    _lockClient = await pool.connect();
    await _lockClient.query("SET lock_timeout = '60s'");   // fail visibly rather than hang if a stuck runner holds it
    await _lockClient.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    const root = path.resolve(__dirname, '../../database');
    // Schema is idempotent (CREATE/ALTER ... IF NOT EXISTS) so it is safe to
    // run on every deploy.
    await runFile(path.join(root, 'schema', '01_schema.sql'));
    await runFile(path.join(root, 'schema', '03_contract.sql'));
    await runFile(path.join(root, 'schema', '04_indexes.sql'));
    await runFile(path.join(root, 'schema', '05_security.sql'));
    await runFile(path.join(root, 'schema', '06_scheduler.sql'));
    await runFile(path.join(root, 'schema', '07_platform.sql'));
    await runFile(path.join(root, 'schema', '08_multiselect.sql'));
    await runFile(path.join(root, 'schema', '09_absence_status.sql'));
    await runFile(path.join(root, 'schema', '10_roles.sql'));
    await runFile(path.join(root, 'schema', '11_rules.sql'));
    await runFile(path.join(root, 'schema', '12_versions.sql'));
    await runFile(path.join(root, 'schema', '13_entry_partial_uniq.sql'));
    await runFile(path.join(root, 'schema', '14_autoschedule_idx.sql'));
    // 15_forecast.sql / 16_forecast_history.sql intentionally NOT run: those
    // duplicate forecast stores were unified into schedule_forecasts. 17 drops
    // them where they still exist (older environments).
    await runFile(path.join(root, 'schema', '17_drop_forecast_dup.sql'));
    // 18 — additive compatibility view (v_schedule_days): presents
    // schedule_entries in the legacy per-day (work_date) shape so legacy
    // readers can migrate onto the real source of truth. Non-destructive.
    await runFile(path.join(root, 'schema', '18_schedule_view.sql'));
    // 19 — additive compatibility view (v_forecast_days): presents
    // schedule_forecasts in the legacy per-day (forecast_date) shape so
    // date-total forecast readers can migrate onto the real source of truth.
    // Non-destructive; service_key preserved (not mapped to service_type_id).
    await runFile(path.join(root, 'schema', '19_forecast_view.sql'));
    // 20 — drop the legacy `schedules` table (phase 4). Guarded: migrates any
    // lingering rows into schedule_entries before dropping. Idempotent.
    await runFile(path.join(root, 'schema', '20_drop_schedules.sql'));
    // 21 — backfill legacy HR `forecasts` into schedule_forecasts (single source
    // of truth). Idempotent + scheduler-wins (ON CONFLICT DO NOTHING). Guarded so
    // it is a no-op when the legacy table no longer exists (fresh install).
    await runFile(path.join(root, 'schema', '21_forecast_backfill.sql'));
    // 22 — retire the legacy `forecasts` table. MUST run after 21 (asserts every
    // representable legacy row is already in schedule_forecasts, then drops).
    // Idempotent and a no-op on a fresh install (table never created).
    await runFile(path.join(root, 'schema', '22_drop_forecasts.sql'));
    // Seed the default scheduling rules once (skipped if any row exists).
    {
      const rc = await pool.query('SELECT count(*)::int AS c FROM scheduling_rules');
      if (rc.rows[0].c === 0) {
        const RULES = [
          ['contract_day',    'Giorno contrattuale',      'Assegna solo nei giorni lavorativi consentiti dal contratto', 'skip',   10, {}],
          ['unavailable',     'Assenza / non disponibile', 'Salta chi ha ferie, malattia o altra assenza registrata quel giorno', 'skip', 20, {}],
          ['already_assigned','Già pianificato',          'Salta chi ha già un turno assegnato quel giorno',            'skip',   30, {}],
          ['qualified',       'Qualifica servizio',       'Assegna solo DAS qualificati per il servizio',               'skip',   40, {}],
          ['branch_match',    'Filiale corretta',         'Assegna solo DAS della filiale del servizio',                'require',50, {}],
          ['consecutive',     'Giorni consecutivi',       'Salta chi supererebbe il limite di giorni consecutivi',      'skip',   60, { maxConsecutive: 6 }],
          ['workload_balance','Bilancio carico',          'Preferisce i DAS con meno turni assegnati (equità)',         'score',  70, { weight: 2 }],
          ['weekend_fairness','Equità weekend',           'Distribuisce equamente i turni del fine settimana',          'score',  80, { weight: 1 }],
          ['preferred_code',  'Turno preferito',          'Preferisce di poco i DAS il cui codice predefinito è quello del servizio', 'score', 90, { weight: 1 }],
        ];
        for (const [code, name, description, action, priority, params] of RULES) {
          await pool.query(
            `INSERT INTO scheduling_rules (code,name,description,action,priority,enabled,params,builtin,created_by)
             VALUES ($1,$2,$3,$4,$5,TRUE,$6,TRUE,'seed')`,
            [code, name, description, action, priority, JSON.stringify(params)]);
        }
        console.log('Seeded ' + RULES.length + ' default scheduling rules.');
      }
    }
    // One-time seed of role_permissions from the hardcoded RBAC matrix, so the
    // DB-backed system starts with exactly the current behaviour. Admin gets
    // every permission (super-role). Skipped once the table has any rows.
    {
      const { MATRIX, ALL_PERMISSIONS } = require('../middleware/rbac');
      const rc = await pool.query('SELECT count(*)::int AS c FROM role_permissions');
      if (rc.rows[0].c === 0) {
        for (const [perm, roles] of Object.entries(MATRIX)) {
          for (const role of roles) {
            await pool.query('INSERT INTO role_permissions (role, permission) VALUES ($1,$2) ON CONFLICT DO NOTHING', [role, perm]);
          }
        }
        for (const perm of ALL_PERMISSIONS) {
          await pool.query('INSERT INTO role_permissions (role, permission) VALUES ($1,$2) ON CONFLICT DO NOTHING', ['admin', perm]);
        }
        console.log(`Seeded role_permissions from RBAC matrix (${ALL_PERMISSIONS.length} permissions).`);
      }
    }
    if (process.argv.includes('--seed')) {
      await runFile(path.join(root, 'seeds', '02_seed.sql'));
      // scheduler_config is the scheduler's source of truth for shift codes
      // and contract types; seed it once (no-op if already populated), then
      // derive shift_codes/contract_types from whatever it currently holds.
      const { seedSchedulerConfig } = require('../../scripts/seed-scheduler-config');
      const { syncShiftVocab } = require('../../scripts/sync-shift-vocab');
      await seedSchedulerConfig('DLO1');
      await syncShiftVocab('DLO1');
    }
    // Always make sure a login exists (no-op if users already present).
    await ensureAdmin();
    console.log('Migration complete.');
    await _lockClient.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    _lockClient.release(); _lockClient = null;
    await pool.end();
    process.exit(0);
  } catch (e) {
    console.error('Migration failed:', e.message);
    // Common, actionable hints
    if (/SSL|TLS/i.test(e.message)) {
      console.error(
        'Hint: the database requires SSL. Ensure DATABASE_URL is set and, if needed, set PGSSL=true. ' +
        'This project enables SSL automatically when DATABASE_URL is present.'
      );
    }
    if (/ECONNREFUSED|ENOTFOUND|timeout/i.test(e.message)) {
      console.error('Hint: cannot reach the database. Check DATABASE_URL host/port and that the DB is running.');
    }
    // Destroy the lock client (truthy arg) so its session closes — releasing the
    // advisory lock — and pool.end() won't hang on a checked-out connection.
    try { if (_lockClient) _lockClient.release(new Error('migration failed')); } catch (_) { /* ignore */ }
    try { await pool.end(); } catch (_) { /* ignore */ }
    process.exit(1);
  }
})();
