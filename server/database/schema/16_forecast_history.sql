-- ─────────────────────────────────────────────────────────────────────────
-- Forecast history — per-day metric snapshots for weekly/monthly trends.
-- Additive: coexists with the week-based `forecast` table (editable input).
-- One row per Station × Service × Date (upserted), capturing the forecast plus
-- the live-computed metrics and an optional manually-entered/imported actual.
-- station_id / service_id are TEXT (branch code + service key, as the app uses).
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS forecast_history (
  id              BIGSERIAL PRIMARY KEY,
  station_id      TEXT NOT NULL,
  service_id      TEXT NOT NULL,
  forecast_date   DATE NOT NULL,
  forecast_value  INT,
  scheduled_value INT,
  actual_value    INT,
  available_value INT,
  coverage        INT,            -- percent
  delta           INT,
  created_by      TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (station_id, service_id, forecast_date)
);

CREATE INDEX IF NOT EXISTS idx_forecast_history_lookup
  ON forecast_history (station_id, service_id, forecast_date);
