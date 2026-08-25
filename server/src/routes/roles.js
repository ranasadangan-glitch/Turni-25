// Roles & permissions management (admin only). Backs the Roles & Permissions
// UI. The RBAC cache in middleware/rbac.js is reloaded after every change so
// permission edits take effect immediately.
const router = require('express').Router();
const { pool } = require('../db/pool');
const { auth, requireAdmin, audit } = require('../middleware/auth');
const { ALL_PERMISSIONS, loadPermissions } = require('../middleware/rbac');

router.use(auth, requireAdmin);

// GET /api/roles → roles, the full permission catalogue, and the matrix
router.get('/', async (_req, res) => {
  const roles = (await pool.query('SELECT role, label, builtin FROM role_defs ORDER BY builtin DESC, role')).rows;
  const perms = (await pool.query('SELECT role, permission FROM role_permissions')).rows;
  const matrix = {};
  roles.forEach((r) => { matrix[r.role] = {}; });
  perms.forEach((p) => { if (!matrix[p.role]) matrix[p.role] = {}; matrix[p.role][p.permission] = true; });
  // usage counts so the UI can warn before deleting a role in use
  const usage = (await pool.query("SELECT role, count(*)::int AS n FROM users GROUP BY role")).rows
    .reduce((a, r) => { a[r.role] = r.n; return a; }, {});
  res.json({ roles, permissions: ALL_PERMISSIONS, matrix, usage });
});

// PUT /api/roles/:role/permissions  { permissions: [...] } — replace the set
router.put('/:role/permissions', async (req, res) => {
  const role = req.params.role;
  if (role === 'admin') return res.status(400).json({ error: "L'amministratore ha sempre tutti i permessi" });
  const def = await pool.query('SELECT 1 FROM role_defs WHERE role=$1', [role]);
  if (!def.rowCount) return res.status(404).json({ error: 'Ruolo non trovato' });
  const wanted = (Array.isArray(req.body && req.body.permissions) ? req.body.permissions : [])
    .filter((p) => ALL_PERMISSIONS.includes(p));
  await pool.query('DELETE FROM role_permissions WHERE role=$1', [role]);
  for (const p of wanted) {
    await pool.query('INSERT INTO role_permissions (role, permission) VALUES ($1,$2) ON CONFLICT DO NOTHING', [role, p]);
  }
  await loadPermissions();
  await audit(req, 'config', role, 'update', `Permessi ruolo ${role}: ${wanted.length}`);
  res.json({ ok: true, count: wanted.length });
});

// POST /api/roles  { role, label, clone_from? } — create (optionally clone)
router.post('/', async (req, res) => {
  let { role, label, clone_from } = req.body || {};
  role = String(role || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (!role) return res.status(400).json({ error: 'Codice ruolo obbligatorio' });
  const exists = await pool.query('SELECT 1 FROM role_defs WHERE role=$1', [role]);
  if (exists.rowCount) return res.status(409).json({ error: 'Ruolo già esistente' });
  await pool.query('INSERT INTO role_defs (role, label, builtin) VALUES ($1,$2,FALSE)', [role, label || role]);
  if (clone_from) {
    await pool.query(
      'INSERT INTO role_permissions (role, permission) SELECT $1, permission FROM role_permissions WHERE role=$2 ON CONFLICT DO NOTHING',
      [role, clone_from]);
  }
  await loadPermissions();
  await audit(req, 'config', role, 'create', `Ruolo creato: ${role}${clone_from ? ' (clone di ' + clone_from + ')' : ''}`);
  res.status(201).json({ ok: true, role });
});

// DELETE /api/roles/:role — custom, unused roles only
router.delete('/:role', async (req, res) => {
  const role = req.params.role;
  const def = await pool.query('SELECT builtin FROM role_defs WHERE role=$1', [role]);
  if (!def.rowCount) return res.status(404).json({ error: 'Ruolo non trovato' });
  if (def.rows[0].builtin) return res.status(400).json({ error: 'I ruoli predefiniti non possono essere eliminati' });
  const inUse = await pool.query('SELECT count(*)::int AS n FROM users WHERE role=$1', [role]);
  if (inUse.rows[0].n > 0) return res.status(409).json({ error: `Ruolo assegnato a ${inUse.rows[0].n} utenti` });
  await pool.query('DELETE FROM role_permissions WHERE role=$1', [role]);
  await pool.query('DELETE FROM role_defs WHERE role=$1', [role]);
  await loadPermissions();
  await audit(req, 'config', role, 'delete', `Ruolo eliminato: ${role}`);
  res.json({ ok: true });
});

module.exports = router;
