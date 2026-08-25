// ============================================================
// Critical #2 (phase 2b) — forecast model: regression safety net.
//
// Pins the behaviour of v_forecast_days (migration 19), the additive view
// that presents schedule_forecasts (the real forecast source of truth) in the
// legacy per-day (forecast_date) shape used by date-total readers such as
// reports.js /forecast-accuracy.
//
// Dependency-free: Node's built-in test runner (node:test) + node:assert.
// Run with:  npm test   (from the server/ directory)
// Requires a reachable PostgreSQL (same connection as the app, from .env);
// skips gracefully if the DB cannot be reached.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const { pool } = require('../src/db/pool');

const MONTH = '2099-01-01';    // schedule_month (first of month)
const DAY = 1;                 // day_of_month -> forecast_date 2099-01-01
const BRANCH = 'ZZFC';
const KEY_A = 'ZZ_KEY_A';
const KEY_B = 'ZZ_KEY_B';

let dbReachable = false;

test.before(async () => {
  try {
    await pool.query('SELECT 1');
    dbReachable = true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[forecast-model.test] DB not reachable, skipping suite:', e.message);
    return;
  }

  await pool.query(
    `INSERT INTO branches (code, name) VALUES ($1,'Forecast Test Branch (temp)')
     ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name`, [BRANCH]);

  // Two service_keys on the same day -> daily total should be 5 + 3 = 8.
  await pool.query(
    `INSERT INTO schedule_forecasts
       (schedule_month, branch_code, service_key, day_of_month, qty, updated_by)
     VALUES ($1,$2,$3,$4,5,'test'),
            ($1,$2,$5,$4,3,'test')
     ON CONFLICT (schedule_month, branch_code, service_key, day_of_month)
     DO UPDATE SET qty=EXCLUDED.qty`, [MONTH, BRANCH, KEY_A, DAY, KEY_B]);
});

test.after(async () => {
  if (dbReachable) {
    await pool.query('DELETE FROM schedule_forecasts WHERE branch_code=$1', [BRANCH]);
    await pool.query('DELETE FROM branches WHERE code=$1', [BRANCH]);
  }
  await pool.end();
});

test('v_forecast_days maps schedule_month + day_of_month to a real forecast_date', async (t) => {
  if (!dbReachable) return t.skip('no database');
  const { rows } = await pool.query(
    `SELECT DISTINCT forecast_date::text AS d FROM v_forecast_days
      WHERE branch_code=$1`, [BRANCH]);
  assert.equal(rows.length, 1, 'both rows are on the same day');
  assert.equal(rows[0].d, '2099-01-01', 'day_of_month=1 of 2099-01 resolves to 2099-01-01');
});

test('v_forecast_days resolves branch_id and preserves service_key (lossless)', async (t) => {
  if (!dbReachable) return t.skip('no database');
  const { rows } = await pool.query(
    `SELECT v.service_key, v.qty, v.branch_id, b.id AS expected_branch_id
       FROM v_forecast_days v JOIN branches b ON b.code=v.branch_code
      WHERE v.branch_code=$1 ORDER BY v.service_key`, [BRANCH]);
  assert.equal(rows.length, 2, 'both service_keys are exposed');
  assert.equal(rows[0].service_key, KEY_A, 'service_key preserved as-is');
  assert.equal(rows[0].branch_id, rows[0].expected_branch_id, 'branch_id resolved from branch_code');
});

test('daily forecast total via the view (reports /forecast-accuracy semantic)', async (t) => {
  if (!dbReachable) return t.skip('no database');
  // Mirrors the forecast-accuracy fc CTE: sum(qty) grouped by forecast_date.
  const { rows } = await pool.query(
    `SELECT forecast_date::text AS d, sum(qty)::int AS f
       FROM v_forecast_days
      WHERE forecast_date='2099-01-01' AND branch_code=$1
      GROUP BY 1`, [BRANCH]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].f, 8, 'daily total is the sum across service_keys (5 + 3)');
});
