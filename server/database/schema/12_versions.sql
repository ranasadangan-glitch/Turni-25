-- ============================================================
-- 12 — Schedule version history
--
-- Every saved snapshot of a month's schedule (per branch) becomes a version
-- (e.g. "Luglio v1", "v2"…). Managers can save, list, restore and compare.
-- snapshot holds the schedule map {driverId: {day: code}} as JSONB so a
-- restore is a pure client-side apply — no changes to the live tables until
-- the user chooses to restore.
-- ============================================================

CREATE TABLE IF NOT EXISTS schedule_versions (
  id             SERIAL PRIMARY KEY,
  schedule_month DATE NOT NULL,
  branch_code    TEXT,
  label          TEXT NOT NULL,
  snapshot       JSONB NOT NULL,
  coverage_pct   INT,
  created_by     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sched_versions_key ON schedule_versions(schedule_month, branch_code, created_at DESC);
