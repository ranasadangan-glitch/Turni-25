// ============================================================
// Critical #2 — dual schedule model: regression safety net.
//
// These tests pin down the DESIRED behaviour before any reader is migrated:
//   • schedule_entries is the real source of truth for shift cells.
//   • v_schedule_days (migration 18) exposes those rows in the legacy
//     per-day (employee_id, work_date) shape that reports/pdf/forecast/kpi
//     were written against.
//   • The `schedules` table is NOT where scheduler/engine data lives.
//
// Dependency-free: uses Node's built-in test runner (node:test) + node:assert.
// Run with:  npm test   (from the server/ directory)
//
// Requires a reachable PostgreSQL (same connection as the app, from .env).
// If the DB can't be reached the suite skips rather than failing, so it is
// safe to run in environments without a database.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const { pool } = require('../src/db/pool');

// Sentinel values kept well clear of real data; all cleaned up in after().
const MONTH = '2099-01-01';      // schedule_month (first of month)
const BRANCH = 'ZZTEST';
const CODE_WORK = 'ZZW';
const CODE_OFF = 'ZZO';
const LOCAL_DRIVER_ID = 990001;  // a scheduler-local (non-employee) driver

let dbReachable = false;
let empId = null;
let branchId = null;

test.before(async () => {
  try {
    await pool.query('SELECT 1');
    dbReachable = true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[schedule-model.test] DB not reachable, skipping suite:', e.message);
    return;
  }

  // Fixtures (idempotent where possible).
  await pool.query(
    `INSERT INTO shift_codes (code, label, category, is_work, is_absence, is_off)
     VALUES ($1,'test work','next',TRUE,FALSE,FALSE),
            ($2,'test off','off',FALSE,FALSE,TRUE)
     ON CONFLICT (code) DO NOTHING`, [CODE_WORK, CODE_OFF]);

  const b = await pool.query(
    `INSERT INTO branches (code, name) VALUES ($1,'Test Branch (temp)')
     ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name RETURNING id`, [BRANCH]);
  branchId = b.rows[0].id;

  const e = await pool.query(
    `INSERT INTO employees (first_name, last_name, branch_id, status, work_days)
     VALUES ('Test','Driver',$1,'active','{1,2,3,4,5}') RETURNING id`, [branchId]);
  empId = e.rows[0].id;

  // Employee-linked cells: day 1 = work, day 2 = off.
  await pool.query(
    `INSERT INTO schedule_entries
       (schedule_month, employee_id, day_of_month, shift_code, branch_code, updated_by)
     VALUES ($1,$2,1,$3,$4,'test'),
            ($1,$2,2,$5,$4,'test')`, [MONTH, empId, CODE_WORK, BRANCH, CODE_OFF]);

  // A scheduler-local (non-employee) cell on day 1.
  await pool.query(
    `INSERT INTO schedule_entries
       (schedule_month, local_driver_id, day_of_month, shift_code, branch_code, updated_by)
     VALUES ($1,$2,1,$3,$4,'test')`, [MONTH, LOCAL_DRIVER_ID, CODE_WORK, BRANCH]);
});

test.after(async () => {
  if (dbReachable) {
    await pool.query(`DELETE FROM schedule_entries WHERE branch_code=$1`, [BRANCH]);
    if (empId) await pool.query('DELETE FROM employees WHERE id=$1', [empId]);
    await pool.query('DELETE FROM branches WHERE code=$1', [BRANCH]);
    await pool.query('DELETE FROM shift_codes WHERE code IN ($1,$2)', [CODE_WORK, CODE_OFF]);
  }
  await pool.end();
});

test('v_schedule_days maps schedule_month + day_of_month to a real work_date', async (t) => {
  if (!dbReachable) return t.skip('no database');
  const { rows } = await pool.query(
    `SELECT work_date::text AS d FROM v_schedule_days
      WHERE employee_id=$1 AND shift_code=$2`, [empId, CODE_WORK]);
  assert.equal(rows.length, 1, 'exactly one work cell for the test employee');
  assert.equal(rows[0].d, '2099-01-01', 'day_of_month=1 of 2099-01 resolves to 2099-01-01');
});

test('employee-linked shifts are visible through the view; legacy schedules table is gone', async (t) => {
  if (!dbReachable) return t.skip('no database');
  const viaView = await pool.query(
    `SELECT count(*)::int AS n FROM v_schedule_days WHERE employee_id=$1`, [empId]);
  assert.equal(viaView.rows[0].n, 2, 'both employee cells (work + off) are exposed by the view');

  // Phase 4 regression guard: the legacy `schedules` table has been dropped
  // (migration 20). schedule_entries is the sole source of truth; every reader
  // now goes through v_schedule_days above.
  const legacy = await pool.query(
    `SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema='public' AND table_name='schedules'`);
  assert.equal(legacy.rows[0].n, 0, 'the legacy schedules table no longer exists');
});

test('unified planned count (reports.js semantic) sees employee work days via the view', async (t) => {
  if (!dbReachable) return t.skip('no database');
  // Mirrors the reports.js "worked_days" aggregation, but sourced from the
  // view instead of the (empty) schedules table.
  const { rows } = await pool.query(
    `SELECT count(*) FILTER (WHERE sc.is_work)::int AS worked,
            count(*) FILTER (WHERE sc.is_off)::int  AS off
       FROM v_schedule_days v
       JOIN employees e   ON e.id = v.employee_id
       JOIN shift_codes sc ON sc.code = v.shift_code
      WHERE v.work_date = '2099-01-01' AND e.id = $1`, [empId]);
  assert.equal(rows[0].worked, 1, 'one worked day counted through the view');
  assert.equal(rows[0].off, 0, 'the off cell is on a different day (2099-01-02)');
});

test('scheduler-local (non-employee) cells are also exposed by the view', async (t) => {
  if (!dbReachable) return t.skip('no database');
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM v_schedule_days
      WHERE local_driver_id=$1 AND employee_id IS NULL`, [LOCAL_DRIVER_ID]);
  assert.equal(rows[0].n, 1, 'the local-driver cell is visible (HR readers can filter it out)');
});
