// One-time-per-branch bootstrap: writes the frontend's hardcoded scheduler
// defaults (scheduler-defaults.js) into scheduler_config, so the DB — not a
// client-side JS fallback — becomes the actual source of truth.
// Idempotent: ON CONFLICT DO NOTHING, so it never clobbers config an admin
// has since edited via the Config screen (PUT /api/scheduler/config).
const { pool } = require('../src/db/pool');
const DEFAULTS = require('./scheduler-defaults');

async function seedSchedulerConfig(branch = 'DLO1') {
  const entries = {
    groups: DEFAULTS.DEF_GROUPS,
    codes: DEFAULTS.DEF_CODES,
    contracts: DEFAULTS.DEF_CONTRACTS,
    services: DEFAULTS.DEF_SERVICES,
    counters: DEFAULTS.DEF_COUNTERS,
    filiali: DEFAULTS.DEF_FILIALI,
    serviceTypes: DEFAULTS.DEF_STYPES,
  };
  let inserted = 0;
  for (const [key, value] of Object.entries(entries)) {
    const r = await pool.query(
      `INSERT INTO scheduler_config (branch_code, config_key, config_value, updated_by)
       VALUES ($1,$2,$3,'seed')
       ON CONFLICT (branch_code, config_key) DO NOTHING`,
      [branch, key, JSON.stringify(value)]
    );
    if (r.rowCount) inserted++;
  }
  console.log(`scheduler_config[${branch}]: ${inserted}/${Object.keys(entries).length} keys inserted (existing keys left untouched).`);
  return inserted;
}

if (require.main === module) {
  (async () => {
    try {
      await seedSchedulerConfig(process.argv[2] || 'DLO1');
      await pool.end();
    } catch (e) {
      console.error('seed-scheduler-config failed:', e.message);
      process.exit(1);
    }
  })();
}

module.exports = { seedSchedulerConfig };
