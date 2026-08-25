-- ============================================================
-- 11 — Configurable scheduling rule engine
--
-- The automatic shift generator evaluates each candidate against these rules.
-- Rules are DATA, not code: an admin can enable/disable, reprioritise, tune
-- params, or add rows. Each row's `code` maps to an evaluator the engine
-- understands (skip / require / score); `params` (JSONB) tunes it. New codes
-- can be added without a schema change.
-- ============================================================

CREATE TABLE IF NOT EXISTS scheduling_rules (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL,                 -- evaluator key (see generator.js RULE_EVALUATORS)
  name        TEXT NOT NULL,
  description TEXT,
  action      TEXT NOT NULL DEFAULT 'skip',  -- skip | require | score
  priority    INT  NOT NULL DEFAULT 100,     -- lower = evaluated first
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  params      JSONB NOT NULL DEFAULT '{}',
  builtin     BOOLEAN NOT NULL DEFAULT FALSE,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sched_rules_enabled ON scheduling_rules(enabled, priority);
