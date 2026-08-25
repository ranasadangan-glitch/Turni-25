-- ─────────────────────────────────────────────────────────────────────────
-- Forecast (typed, weekly) — planning input for the redesigned Forecast page.
-- Additive: coexists with schedule_forecasts (which the Scheduler footer uses).
-- One row per Station × Service × Forecast Type × ISO-Week × Year, holding the
-- seven weekday values. Only the "Forecast" row of the page is stored here; all
-- other metrics are computed live from the Scheduler data.
-- station_id / service_id are TEXT (the branch code e.g. 'DLO1' and the service
-- key/label the app already uses to identify them) — no FK churn.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS forecast (
  id            BIGSERIAL PRIMARY KEY,
  station_id    TEXT     NOT NULL,
  service_id    TEXT     NOT NULL,
  forecast_type TEXT     NOT NULL DEFAULT 'operational',   -- operational|amazon|planned|final|actual
  week          SMALLINT NOT NULL CHECK (week BETWEEN 1 AND 53),
  year          SMALLINT NOT NULL,
  sun           INT      NOT NULL DEFAULT 0,
  mon           INT      NOT NULL DEFAULT 0,
  tue           INT      NOT NULL DEFAULT 0,
  wed           INT      NOT NULL DEFAULT 0,
  thu           INT      NOT NULL DEFAULT 0,
  fri           INT      NOT NULL DEFAULT 0,
  sat           INT      NOT NULL DEFAULT 0,
  created_by    TEXT,
  updated_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (station_id, service_id, forecast_type, week, year)
);

CREATE INDEX IF NOT EXISTS idx_forecast_lookup
  ON forecast (station_id, service_id, forecast_type, year, week);
