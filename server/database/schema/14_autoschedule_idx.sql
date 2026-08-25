-- 14_autoschedule_idx.sql
-- Indexes for the Automatic Workforce Management Engine: the generator reads
-- per employee/month, matches absences by employee + date range, and filters
-- employees by contract dates. These keep per-employee regeneration fast at
-- thousands of employees.

CREATE INDEX IF NOT EXISTS idx_sched_entry_emp_month
  ON schedule_entries (employee_id, schedule_month);

CREATE INDEX IF NOT EXISTS idx_absences_emp_dates
  ON absences (employee_id, start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_absences_status
  ON absences (status);

CREATE INDEX IF NOT EXISTS idx_employees_contract_dates
  ON employees (contract_start_date, contract_end_date);

CREATE INDEX IF NOT EXISTS idx_employees_status
  ON employees (status);
