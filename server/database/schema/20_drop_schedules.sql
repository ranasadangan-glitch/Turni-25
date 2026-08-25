-- ============================================================
-- 20 — Drop the legacy `schedules` table (Critical #2, phase 4)
--
-- schedule_entries (06_scheduler.sql) is the single source of truth for shift
-- cells; every reader now goes through v_schedule_days (18) and every writer
-- targets schedule_entries (phase 3). This migration removes the now-unused
-- legacy table.
--
-- SAFETY: before dropping, migrate any rows that still linger in `schedules`
-- (e.g. an environment that used the old xlsx import before phase 3) into
-- schedule_entries. Existing schedule_entries always win (ON CONFLICT DO
-- NOTHING) so the current source of truth is never clobbered — the copy only
-- fills gaps. Idempotent: once the table is gone the guard is a no-op.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'schedules'
  ) THEN
    INSERT INTO schedule_entries
      (schedule_month, employee_id, day_of_month, shift_code, branch_code, updated_by, updated_at)
    SELECT
      date_trunc('month', s.work_date)::date,
      s.employee_id,
      EXTRACT(DAY FROM s.work_date)::int,
      s.shift_code,
      (SELECT b.code FROM branches b WHERE b.id = e.branch_id),
      COALESCE(s.updated_by, 'legacy-import'),
      now()
    FROM schedules s
    JOIN employees e ON e.id = s.employee_id
    ON CONFLICT (employee_id, schedule_month, day_of_month) WHERE employee_id IS NOT NULL
    DO NOTHING;
  END IF;
END $$;

DROP TABLE IF EXISTS schedules CASCADE;
