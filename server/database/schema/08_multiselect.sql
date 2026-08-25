-- ============================================================
-- 08 — Multi-select employee fields
--
-- Filiale, Servizio and Codice turno become multi-valued in the employee
-- form. Rather than migrating the existing single-value columns away (they
-- are load-bearing: branch_id drives RBAC scoping via loadScope/scopeWhere,
-- service_type_id and default_shift_code are used by the planner, the KPI
-- queries and the Excel export), we ADD parallel array columns and keep the
-- singular column as the PRIMARY value — always the first entry of the array.
--
-- That way every existing query keeps working unchanged, while the full
-- selection is preserved. The API layer keeps the two in sync on write
-- (see routes/employees.js → syncPrimaryFromArrays).
--
-- Idempotent: safe to re-run on every deploy.
-- ============================================================

ALTER TABLE employees ADD COLUMN IF NOT EXISTS branch_ids          INT[];
ALTER TABLE employees ADD COLUMN IF NOT EXISTS service_type_ids    INT[];
ALTER TABLE employees ADD COLUMN IF NOT EXISTS default_shift_codes TEXT[];

-- Backfill from the existing singular values so current rows round-trip
-- through the new multi-select form without losing their assignment.
UPDATE employees
   SET branch_ids = ARRAY[branch_id]
 WHERE branch_ids IS NULL AND branch_id IS NOT NULL;

UPDATE employees
   SET service_type_ids = ARRAY[service_type_id]
 WHERE service_type_ids IS NULL AND service_type_id IS NOT NULL;

UPDATE employees
   SET default_shift_codes = ARRAY[default_shift_code]
 WHERE default_shift_codes IS NULL
   AND default_shift_code IS NOT NULL AND default_shift_code <> '';

-- Lookups by "does this employee cover branch X / service Y"
CREATE INDEX IF NOT EXISTS idx_emp_branch_ids   ON employees USING GIN (branch_ids);
CREATE INDEX IF NOT EXISTS idx_emp_service_ids  ON employees USING GIN (service_type_ids);
