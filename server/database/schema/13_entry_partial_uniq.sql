-- 13_entry_partial_uniq.sql
-- Fix schedule_entries uniqueness so employee-linked and scheduler-local rows
-- don't collide. The original constraints were UNIQUE NULLS NOT DISTINCT on
-- (employee_id, month, day) and (local_driver_id, month, day): because a row is
-- EITHER an employee entry (employee_id set, local_driver_id NULL) OR a local
-- driver entry (local_driver_id set, employee_id NULL), the NULL side collided
-- across every row of the other kind — so two local drivers could not both have
-- a shift on the same day, and bulk saves failed with a unique-violation.
--
-- The route code already targets PARTIAL indexes
-- (ON CONFLICT (...) WHERE employee_id IS NOT NULL / local_driver_id IS NOT NULL),
-- so replace the full constraints with matching partial unique indexes.

ALTER TABLE schedule_entries DROP CONSTRAINT IF EXISTS schedule_entries_employee_id_schedule_month_day_of_month_key;
ALTER TABLE schedule_entries DROP CONSTRAINT IF EXISTS schedule_entries_local_driver_id_schedule_month_day_of_mont_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sched_entry_emp
  ON schedule_entries (employee_id, schedule_month, day_of_month)
  WHERE employee_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sched_entry_local
  ON schedule_entries (local_driver_id, schedule_month, day_of_month)
  WHERE local_driver_id IS NOT NULL;
