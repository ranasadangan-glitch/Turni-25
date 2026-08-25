-- ─────────────────────────────────────────────────────────────────────────
-- Unify planning data on a single source of truth.
-- The standalone Forecast page used its own `forecast` (week-based) and
-- `forecast_history` (per-day snapshot) tables, which diverged from the
-- Scheduler's `schedule_forecasts`. Forecast is now just a VIEW of the same
-- planning records, reading/writing schedule_forecasts via the board's
-- forecastOf()/setFc(). These duplicate tables are removed.
--
-- NOTE: on the dev DB the 3 `forecast` rows were migrated into
-- schedule_forecasts (week→date, label→service_key, ON CONFLICT DO NOTHING)
-- before dropping. An environment that still holds real `forecast` data should
-- run that one-off migration first; this file only drops the now-empty tables.
-- ─────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS forecast_history CASCADE;
DROP TABLE IF EXISTS forecast CASCADE;
