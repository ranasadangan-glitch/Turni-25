const router = require('express').Router();
const { pool } = require('../db/pool');
const { auth, loadScope, audit } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { regenerateEmployee } = require('../services/autoschedule');
router.use(auth, loadScope);

// Real-time scheduler sync (spec §5): every absence mutation regenerates the
// affected employee's auto-managed days BEFORE the response, so the client's
// immediate refetch already sees the override (or the restored contract shift).
async function autoRegen(empId, actor) {
  if (!empId) return;
  try { await regenerateEmployee(empId, actor); } catch (e) { console.error('[autoschedule] absence regen', empId, e.message); }
}

router.get('/', async (req, res) => {
  const params = [];
  let sql = `SELECT a.*, e.first_name, e.last_name, e.branch_id
               FROM absences a JOIN employees e ON e.id=a.employee_id WHERE 1=1`;
  if (!req.scope.admin) {
    if (!req.scope.branches.length) return res.json([]);
    params.push(req.scope.branches); sql += ` AND e.branch_id = ANY($${params.length})`;
  }
  if (req.query.employee_id) { params.push(req.query.employee_id); sql += ` AND a.employee_id=$${params.length}`; }
  sql += ' ORDER BY a.start_date DESC';
  const { rows } = await pool.query(sql, params);
  res.json(rows);
});

router.post('/', requirePermission('absence.manage'), async (req, res) => {
  const { employee_id, absence_type, start_date, end_date, note } = req.body || {};
  // Auto-approve on creation (spec): a new absence is immediately 'approved' so
  // the autoscheduler (which only applies approved absences) lands it on the
  // grid right away — no separate approval step needed.
  const { rows } = await pool.query(
    `INSERT INTO absences (employee_id,absence_type,start_date,end_date,note,created_by,status)
     VALUES ($1,$2,$3,$4,$5,$6,'approved') RETURNING *`,
    [employee_id, absence_type, start_date, end_date, note || null, req.user.username]);
  await audit(req, 'absence', rows[0].id, 'create', `${absence_type} ${start_date}→${end_date} (auto-approvata)`);
  await autoRegen(rows[0].employee_id, req.user.username);
  res.status(201).json(rows[0]);
});

// UPDATE an absence (edit). Non-breaking addition alongside POST/DELETE.
router.put('/:id', requirePermission('absence.manage'), async (req, res) => {
  const { employee_id, absence_type, start_date, end_date, note } = req.body || {};
  // Editing can move the absence to another employee: capture the previous
  // owner so BOTH schedules regenerate (old one restored, new one overridden).
  const { rows: prevRows } = await pool.query('SELECT employee_id FROM absences WHERE id=$1', [req.params.id]);
  const prevEmp = prevRows[0] ? prevRows[0].employee_id : null;
  const { rows } = await pool.query(
    `UPDATE absences
        SET employee_id = COALESCE($1, employee_id),
            absence_type = COALESCE($2, absence_type),
            start_date  = COALESCE($3, start_date),
            end_date    = COALESCE($4, end_date),
            note        = $5
      WHERE id = $6 RETURNING *`,
    [employee_id || null, absence_type || null, start_date || null, end_date || null, note || null, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Assenza non trovata' });
  await audit(req, 'absence', req.params.id, 'update', `${rows[0].absence_type} ${rows[0].start_date}→${rows[0].end_date}`);
  await autoRegen(rows[0].employee_id, req.user.username);
  if (prevEmp && prevEmp !== rows[0].employee_id) await autoRegen(prevEmp, req.user.username);
  res.json(rows[0]);
});

// Approve / reject / reset an absence request.
router.patch('/:id/status', requirePermission('absence.manage'), async (req, res) => {
  const { status } = req.body || {};
  if (!['pending', 'approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'status non valido' });
  }
  const { rows } = await pool.query('UPDATE absences SET status=$1 WHERE id=$2 RETURNING *', [status, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Assenza non trovata' });
  await audit(req, 'absence', req.params.id, status === 'approved' ? 'approve' : status === 'rejected' ? 'reject' : 'update', `Stato → ${status}`);
  // Approve → override lands on the schedule; un-approve/reject → contract shift restored.
  await autoRegen(rows[0].employee_id, req.user.username);
  res.json(rows[0]);
});

router.delete('/:id', requirePermission('absence.manage'), async (req, res) => {
  // Read the owner BEFORE deleting so we can restore their contract shifts.
  const { rows: prevRows } = await pool.query('SELECT employee_id FROM absences WHERE id=$1', [req.params.id]);
  await pool.query('DELETE FROM absences WHERE id=$1', [req.params.id]);
  await audit(req, 'absence', req.params.id, 'delete', 'Assenza rimossa');
  if (prevRows[0]) await autoRegen(prevRows[0].employee_id, req.user.username);
  res.json({ ok: true });
});

module.exports = router;
