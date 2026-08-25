-- ============================================================
-- Seed data for TurniDSP Platform
-- Default admin password is 'admin123' (bcrypt hash below) — CHANGE IT.
-- Run after 01_schema.sql
-- ============================================================

-- Branches (5-7)
INSERT INTO branches (code, name, address) VALUES
  ('DLO1','DLO1 — Milano','Via Salomone 1, Milano'),
  ('DLO7','DLO7 — Milano',NULL),
  ('DLO2','DLO2',NULL),
  ('DLO3','DLO3',NULL),
  ('DLO4','DLO4',NULL)
ON CONFLICT (code) DO NOTHING;

-- Parking points (example for DLO1)
INSERT INTO parking_points (branch_id, name, address, meet_time)
  SELECT id, 'Parcheggio Via Salomone 1', 'Via Salomone 1, Milano', '09:00' FROM branches WHERE code='DLO1'
ON CONFLICT DO NOTHING;

-- Service types
INSERT INTO service_types (code, name, default_shift_code, meet_time, color, sort_order) VALUES
  ('NEXT','NEXT DAY','X','09:00','#B97E10',1),
  ('SAMEA','Same A','SameA','11:30','#1F5FBF',2),
  ('SAMEB','Same B','SameB','13:00','#7A3FB8',3),
  ('SAMEC','Same C','SameC','14:00','#0E7E74',4),
  ('SAMEE','Same E','SameE','15:00','#2E9E5B',5),
  ('CARGO','Cargo','Cargo','08:00','#475066',6),
  ('RESCUE','Rescue','Rescue','12:00','#C77700',7),
  ('EXTRA','Extra','Extra',NULL,'#6FA8FF',8)
ON CONFLICT (code) DO NOTHING;

-- Shift codes / contract types are NOT seeded here directly. scheduler_config
-- (per-branch, edited via the Workspace Config screen) is the source of
-- truth for this vocabulary; shift_codes/contract_types are derived from it.
-- migrate.js runs, in order: this file -> scripts/seed-scheduler-config.js
-- (writes the scheduler's defaults into scheduler_config, once, only if
-- empty) -> scripts/sync-shift-vocab.js (upserts shift_codes/contract_types
-- from whatever is currently in scheduler_config). Re-run the sync script
-- alone after editing codes/contracts via the Config screen:
--   node scripts/sync-shift-vocab.js DLO1

-- Admin user (password: admin123 — bcrypt, cost 10). CHANGE IMMEDIATELY.
INSERT INTO users (username,password_hash,full_name,role)
VALUES ('admin','$2a$10$93mNMBZBFxDXeyGm6wb0iO5z.cv202M.KJ8a0/ieaMLtsxNH2.30.','Amministratore','admin')
ON CONFLICT (username) DO NOTHING;

-- Example team + leader
INSERT INTO teams (branch_id,name)
  SELECT id,'Team Milano A' FROM branches WHERE code='DLO1'
ON CONFLICT DO NOTHING;
