-- ============================================================
-- 18 — Compatibility view: v_schedule_days
--
-- ADDITIVE and NON-DESTRUCTIVE. Part of the Critical #2 (dual schedule
-- model) consolidation. `schedule_entries` is the real source of truth for
-- shift cells (written by the auto-engine, the scheduler UI, and absence
-- sync), but it is keyed by (schedule_month, day_of_month). Legacy readers
-- (reports, pdf, forecast, employee profile, kpi) were written against the
-- older `schedules` table shape: (employee_id, work_date DATE).
--
-- This view presents schedule_entries in that legacy per-day shape so those
-- readers can be repointed onto the true source of truth in a later phase,
-- one route at a time, without a big-bang rewrite. Nothing is dropped here
-- and no existing query is changed by this file.
-- ============================================================

CREATE OR REPLACE VIEW v_schedule_days AS
SELECT
  se.employee_id,
  se.local_driver_id,
  (se.schedule_month + (se.day_of_month - 1) * INTERVAL '1 day')::date AS work_date,
  se.shift_code,
  se.branch_code,
  se.updated_by,
  se.updated_at
FROM schedule_entries se;
