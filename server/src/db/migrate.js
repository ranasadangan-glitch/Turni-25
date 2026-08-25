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

async function runFile(file) {
  const sql = fs.readFileSync(file, 'utf8');
  console.log('Running', path.basename(file), '...');
  await pool.query(sql);
}

// Guarantees a working admin login even if the seed step was never run.
// Only inserts when the users table is empty, so it never overwrites real data.
async function ensureAdmin() {
  const username = (process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
  const pw = process.env.ADMIN_PASSWORD || 'admin123';
  const reset = process.env.RESET_ADMIN === 'true';

  // Does the admin account exist at all?
  const adm = await pool.query('SELECT id, password_hash, active FROM users WHERE lower(username)=$1', [username]);
  const exists = adm.rowCount > 0;

  // Create if missing, or (re)set when RESET_ADMIN=true, or if the row is inactive.
  const needFix = !exists || reset || (exists && adm.rows[0].active === false);
  if (needFix) {
    const hash = bcrypt.hashSync(pw, 10);
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

(async () => {
  try {
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
    try { await pool.end(); } catch (_) { /* ignore */ }
    process.exit(1);
  }
})();
