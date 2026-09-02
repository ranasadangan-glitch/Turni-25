const router = require('express').Router();
const { pool } = require('../db/pool');
const { auth, loadScope, audit } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
router.use(auth, loadScope);

// GET /api/forecast?from=&to=&branch=  -> forecast rows
// Forecast consolidation: reads the single source of truth (schedule_forecasts)
// instead of the legacy HR `forecasts` table, keeping the exact HR response
// shape. schedule_forecasts is keyed by (schedule_month, day_of_month,
// branch_code, service_key); the lossless bridge maps those back to the HR
// fields this response has always returned — service_types.code = service_key
// (-> service_type_id/service_code/service_name), branches.code = branch_code
// (-> branch_id), and schedule_month + day_of_month -> forecast_date (the same
// expression v_forecast_days uses). The INNER JOIN on service_types keeps only
// forecast rows that map to a real HR service, exactly as the FK-backed
// `forecasts` read always did. Filters, scope, empty-result and 400 behavior,
// column shape and (unspecified) ordering are preserved unchanged.
router.get('/', async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from/to richiesti' });
  const params = [from, to];
  let sql = `SELECT sf.id, b.id AS branch_id, st.id AS service_type_id,
                    (sf.schedule_month + (sf.day_of_month - 1) * INTERVAL '1 day')::date AS forecast_date,
                    sf.qty, sf.updated_by, sf.updated_at,
                    st.code AS service_code, st.name AS service_name, b.code AS branch_code
               FROM schedule_forecasts sf
               JOIN service_types st ON st.code = sf.service_key
               JOIN branches b ON b.code = sf.branch_code
              WHERE (sf.schedule_month + (sf.day_of_month - 1) * INTERVAL '1 day')::date BETWEEN $1 AND $2`;
  if (!req.scope.admin) {
    if (!req.scope.branches.length) return res.json([]);
    params.push(req.scope.branches); sql += ` AND b.id = ANY($${params.length})`;
  }
  if (req.query.branch) { params.push(req.query.branch); sql += ` AND b.code=$${params.length}`; }
  const { rows } = await pool.query(sql, params);
  res.json(rows);
});

// PUT /api/forecast  { branch_id, service_type_id, forecast_date, qty }
// Forecast consolidation: this writes to schedule_forecasts — the single source
// of truth read back through v_forecast_days — instead of the legacy HR
// `forecasts` table. The HR request keys (branch_id, service_type_id,
// forecast_date) are translated to the scheduler keys with the lossless bridge:
// branches.code -> branch_code, service_types.code -> service_key, and
// forecast_date -> (schedule_month, day_of_month). Both code columns are
// NOT NULL UNIQUE, so the mapping is 1:1 and the ON CONFLICT target is
// equivalent to the old (branch_id, service_type_id, forecast_date) key.
router.put('/', requirePermission('forecast.manage'), async (req, res) => {
  const { branch_id, service_type_id, forecast_date, qty } = req.body || {};
  await pool.query(
    `INSERT INTO schedule_forecasts (schedule_month, branch_code, service_key, day_of_month, qty, updated_by)
     SELECT date_trunc('month', $3::date)::date, b.code, st.code,
            EXTRACT(DAY FROM $3::date)::int, $4, $5
       FROM branches b, service_types st
      WHERE b.id = $1 AND st.id = $2
     ON CONFLICT (schedule_month, branch_code, service_key, day_of_month)
     DO UPDATE SET qty=EXCLUDED.qty, updated_by=EXCLUDED.updated_by, updated_at=now()`,
    [branch_id, service_type_id, forecast_date, +qty || 0, req.user.username]);
  await audit(req, 'config', null, 'update', `Forecast ${forecast_date} = ${qty}`);
  res.json({ ok: true });
});

// GET /api/forecast/dashboard?from=&to=&branch=
// Returns forecast vs planned vs delta vs coverage% per service/day.
router.get('/dashboard', async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from/to richiesti' });
  const branchFilter = req.query.branch ? ' AND b.code=$3' : '';
  const branchFilterVf = req.query.branch ? ' AND vf.branch_code=$3' : '';
  const params = [from, to];
  if (req.query.branch) params.push(req.query.branch);

  // Forecast comes from the single source of truth: schedule_forecasts via
  // v_forecast_days, keyed by service_key = service_types.code, per (branch,
  // service, date). (The legacy HR `forecasts` fallback leg was removed once the
  // backfill copied every HR row into schedule_forecasts, making it redundant.)
  // planned = count of schedules whose shift_code maps to a service's default_shift_code
  const sql = `
    WITH fc AS (
      SELECT vf.branch_id, st.id AS service_type_id, vf.forecast_date AS d, sum(vf.qty)::int qty
        FROM v_forecast_days vf JOIN service_types st ON st.code = vf.service_key
       WHERE vf.forecast_date BETWEEN $1 AND $2 ${branchFilterVf}
       GROUP BY 1,2,3),
    pl AS (
      SELECT e.branch_id, st.id AS service_type_id, s.work_date AS d, count(*) planned
        FROM v_schedule_days s
        JOIN employees e ON e.id=s.employee_id
        JOIN branches b ON b.id=e.branch_id
        JOIN service_types st ON st.default_shift_code = s.shift_code
       WHERE s.work_date BETWEEN $1 AND $2 ${branchFilter}
       GROUP BY 1,2,3)
    SELECT COALESCE(fc.branch_id,pl.branch_id) branch_id,
           COALESCE(fc.service_type_id,pl.service_type_id) service_type_id,
           st.name service_name, b.code branch_code,
           COALESCE(fc.d,pl.d) d,
           COALESCE(fc.qty,0) forecast, COALESCE(pl.planned,0) planned,
           COALESCE(pl.planned,0)-COALESCE(fc.qty,0) delta
      FROM fc FULL OUTER JOIN pl
        ON fc.branch_id=pl.branch_id AND fc.service_type_id=pl.service_type_id AND fc.d=pl.d
      LEFT JOIN service_types st ON st.id=COALESCE(fc.service_type_id,pl.service_type_id)
      LEFT JOIN branches b ON b.id=COALESCE(fc.branch_id,pl.branch_id)
     ORDER BY d, service_name`;
  const { rows } = await pool.query(sql, params);
  res.json(rows);
});

module.exports = router;
