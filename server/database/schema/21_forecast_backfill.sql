-- ============================================================
-- 21 — Backfill legacy HR `forecasts` into schedule_forecasts
--
-- Forecast consolidation (Critical #2): schedule_forecasts is the single source
-- of truth. The two remaining writers (forecast.js PUT, XLSX forecast import)
-- now write there. This backfill copies the historical HR `forecasts` rows so
-- nothing is lost when the readers/UI are repointed.
--
-- SAFE + IDEMPOTENT + SCHEDULER-WINS:
--   • The bridge is lossless and 1:1 — branches.code and service_types.code are
--     both NOT NULL UNIQUE, and forecast_date -> (schedule_month, day_of_month)
--     is exact. So each HR row maps to exactly one schedule_forecasts key and no
--     two HR rows collide with each other.
--   • ON CONFLICT DO NOTHING makes the scheduler's own rows authoritative: where
--     schedule_forecasts already holds a value for that
--     (schedule_month, branch_code, service_key, day_of_month), the HR value is
--     NOT applied. Re-running is a no-op for already-copied rows.
--   • The JOINs drop HR rows whose branch or service_type no longer exists
--     (they cannot be represented as a scheduler key) rather than failing.
--
-- NON-DESTRUCTIVE: the `forecasts` table is left in place (no DROP) so this can
-- be verified and rolled forward before any table removal.
-- ============================================================

-- Guarded so a FRESH install (where the legacy table was never created — see
-- 01_schema.sql) is a clean no-op instead of erroring on a missing relation.
DO $$
BEGIN
  IF to_regclass('public.forecasts') IS NULL THEN
    RETURN;   -- table already retired / never existed
  END IF;

  INSERT INTO schedule_forecasts
    (schedule_month, branch_code, service_key, day_of_month, qty, updated_by, updated_at)
  SELECT date_trunc('month', f.forecast_date)::date,
         b.code,
         st.code,
         EXTRACT(DAY FROM f.forecast_date)::int,
         f.qty,
         COALESCE(f.updated_by, 'hr-backfill'),
         f.updated_at
    FROM forecasts f
    JOIN branches b       ON b.id  = f.branch_id
    JOIN service_types st ON st.id = f.service_type_id
  ON CONFLICT (schedule_month, branch_code, service_key, day_of_month) DO NOTHING;
END $$;
