-- ============================================================
-- 22 — Retire the legacy HR `forecasts` table (Critical #2, final phase)
--
-- schedule_forecasts (06_scheduler.sql) is the single source of truth for
-- forecast quantities, read everywhere through v_forecast_days (19). By this
-- point:
--   • every WRITER targets schedule_forecasts (forecast.js PUT, XLSX import,
--     scheduler board/editor);
--   • every READER goes through schedule_forecasts / v_forecast_days — the
--     legacy HR reconciliation fallbacks were removed from forecast.js, pdf.js,
--     xlsx.js, kpi.js and reports.js;
--   • 21_forecast_backfill.sql (which runs immediately before this file) has
--     copied every legacy row into schedule_forecasts (scheduler-wins on
--     conflict).
--
-- MUST run after 21_forecast_backfill.sql (see src/db/migrate.js order).
--
-- SAFETY — never silently lose data:
--   Before dropping, assert that every legacy row that CAN be represented as a
--   scheduler key (its branch + service_type still exist) is already present in
--   schedule_forecasts. If any is missing the backfill did not run, so we ABORT
--   with an explicit error rather than dropping. Rows whose branch/service were
--   deleted are unrepresentable by design (the FK-backed HR reader always
--   excluded them, and ON DELETE CASCADE means they cannot exist) — they are not
--   counted. Overlap rows where the scheduler already held a value are counted
--   as present: scheduler-wins intentionally supersedes the HR value, which the
--   readers already did, so nothing the application used is lost.
--
-- IDEMPOTENT: once the table is gone the guard returns early and the DROP is a
-- no-op. On a fresh install the table was never created, so this is a no-op too.
-- ============================================================

DO $$
DECLARE
  missing bigint;
BEGIN
  IF to_regclass('public.forecasts') IS NULL THEN
    RETURN;   -- already retired / never existed
  END IF;

  SELECT count(*) INTO missing
    FROM forecasts f
    JOIN branches b       ON b.id  = f.branch_id            -- representable rows only
    JOIN service_types st ON st.id = f.service_type_id
    LEFT JOIN schedule_forecasts sf
           ON sf.schedule_month = date_trunc('month', f.forecast_date)::date
          AND sf.branch_code    = b.code
          AND sf.service_key    = st.code
          AND sf.day_of_month   = EXTRACT(DAY FROM f.forecast_date)::int
   WHERE sf.id IS NULL;

  IF missing > 0 THEN
    RAISE EXCEPTION
      'Refusing to drop forecasts: % representable row(s) are not yet in schedule_forecasts. Run 21_forecast_backfill.sql first.',
      missing;
  END IF;
END $$;

DROP TABLE IF EXISTS forecasts CASCADE;
