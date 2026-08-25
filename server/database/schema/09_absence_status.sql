-- ============================================================
-- 09 — Absence approval workflow
--
-- The Absences HR page needs an approval status (pending / approved /
-- rejected) that the original table didn't have. Add it, and backfill any
-- pre-existing rows to 'approved' ONCE — guarded so re-running the migration
-- on every deploy never re-approves genuinely pending requests.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'absences' AND column_name = 'status'
  ) THEN
    ALTER TABLE absences ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
    -- Rows that existed before the approval flow are treated as approved.
    UPDATE absences SET status = 'approved';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_abs_status ON absences(status);
