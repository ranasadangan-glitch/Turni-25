-- ============================================================
-- 19 — Compatibility view: v_forecast_days
--
-- ADDITIVE and NON-DESTRUCTIVE. Part of the Critical #2 (dual data model)
-- consolidation — the forecast axis. `schedule_forecasts` is the real source
-- of truth for forecast quantities (written by the scheduler board footer and
-- the Settings -> Forecast editor), but it is keyed by
-- (schedule_month, day_of_month) and by the scheduler's rich `service_key`
-- taxonomy. The legacy HR `forecasts` table is keyed by (forecast_date) and
-- by service_type_id, and is effectively unused by the current UI.
--
-- This view presents schedule_forecasts in a per-day (forecast_date) shape so
-- date-total readers can be repointed onto the real source of truth. It is
-- LOSSLESS: service_key is preserved as-is (NOT mapped onto service_type_id,
-- which cannot be done cleanly — branch-prefixed / MM / composite keys have no
-- 1:1 service_type). branch_id is resolved from branch_code where a matching
-- branch exists (LEFT JOIN keeps rows even if it does not). Nothing is dropped
-- and no existing query is changed by this file.
-- ============================================================

CREATE OR REPLACE VIEW v_forecast_days AS
SELECT
  sf.branch_code,
  b.id AS branch_id,
  sf.service_key,
  (sf.schedule_month + (sf.day_of_month - 1) * INTERVAL '1 day')::date AS forecast_date,
  sf.qty,
  sf.updated_by,
  sf.updated_at
FROM schedule_forecasts sf
LEFT JOIN branches b ON b.code = sf.branch_code;
