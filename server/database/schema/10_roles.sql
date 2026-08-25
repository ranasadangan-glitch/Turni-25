-- ============================================================
-- 10 — Persistent roles & permissions
--
-- The RBAC matrix was a hardcoded constant in middleware/rbac.js. To make
-- roles manageable from the UI we persist them here. rbac.js loads these into
-- an in-memory cache (with the hardcoded MATRIX as a safety fallback), and
-- reloads after every change. Seeding from the hardcoded MATRIX happens once
-- in migrate.js (JS side) so existing behaviour is preserved on first upgrade.
-- ============================================================

CREATE TABLE IF NOT EXISTS role_defs (
  role       TEXT PRIMARY KEY,
  label      TEXT,
  builtin    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role       TEXT NOT NULL,
  permission TEXT NOT NULL,
  PRIMARY KEY (role, permission)
);
CREATE INDEX IF NOT EXISTS idx_roleperm_role ON role_permissions(role);

-- Built-in roles (labels shown in the UI). Idempotent.
INSERT INTO role_defs (role, label, builtin) VALUES
  ('admin',       'Amministratore', TRUE),
  ('osm',         'OSM',            TRUE),
  ('hr_manager',  'HR Manager',     TRUE),
  ('team_leader', 'Team Leader',    TRUE)
ON CONFLICT (role) DO NOTHING;
