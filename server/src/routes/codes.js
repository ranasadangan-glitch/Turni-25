// Standalone shift-code management ("Codici"): CRUD over the flow
//   Dipendente → Codice → Codice (descrizione) → Categoria
//
// SOURCE-OF-TRUTH SAFETY: the authoritative store for codes is
// scheduler_config[branch].codes (a JSON array of {code,label,cls}); the
// shift_codes table is a DERIVED read-model that syncShiftVocab rebuilds from
// it (and which the scheduler, KPI and reports JOIN). So this CRUD edits
// scheduler_config and then re-runs the sync — it never writes shift_codes
// directly, which would be clobbered on the next sync and could desync the
// scheduler. `category` maps 1:1 to the scheduler group `cls`.
const router = require('express').Router();
const { pool, withTx } = require('../db/pool');
const { auth, audit } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const logger = require('../utils/logger');

router.use(auth);

const DEFAULT_BRANCH = 'DLO1';
// A code's category IS the scheduler group `cls`. These are the built-in groups.
const CATEGORIES = ['next', 'samea', 'sameb', 'mm', 'abs', 'mal', 'off'];
const CODE_RE = /^[A-Za-z0-9_.\-]{1,20}$/;

function branchOf(req) {
  const b = (req.query.branch || (req.body && req.body.branch) || DEFAULT_BRANCH);
  return String(b).trim() || DEFAULT_BRANCH;
}
const normLabel = (v) => String(v == null ? '' : v).trim().slice(0, 60);
const toDto = (c) => ({ code: c.code, label: c.label || '', category: c.cls || '' });

async function readCodes(branch) {
  const { rows } = await pool.query(
    "SELECT config_value FROM scheduler_config WHERE branch_code=$1 AND config_key='codes'", [branch]);
  const v = rows[0] && rows[0].config_value;
  return Array.isArray(v) ? v : [];
}

// Read-modify-write the codes array under a row lock, then resync the derived
// shift_codes table. `fn(codes)` returns the new array (or the same one to
// signal a no-op). syncShiftVocab reads via the shared pool, so it runs AFTER
// the transaction commits, and only when the array actually changed.
async function mutateCodes(branch, user, fn) {
  let changed = false;
  await withTx(async (c) => {
    const { rows } = await c.query(
      "SELECT config_value FROM scheduler_config WHERE branch_code=$1 AND config_key='codes' FOR UPDATE", [branch]);
    const cur = Array.isArray(rows[0] && rows[0].config_value) ? rows[0].config_value : [];
    const next = fn(cur.slice());
    if (next === null) return;                 // fn signalled no-op (conflict / not-found)
    changed = true;
    await c.query(
      `INSERT INTO scheduler_config (branch_code, config_key, config_value, updated_by)
       VALUES ($1,'codes',$2,$3)
       ON CONFLICT (branch_code, config_key)
       DO UPDATE SET config_value=EXCLUDED.config_value, updated_by=EXCLUDED.updated_by, updated_at=now()`,
      [branch, JSON.stringify(next), user]);
  });
  if (changed) {
    const { syncShiftVocab } = require('../../scripts/sync-shift-vocab');
    await syncShiftVocab(branch);
  }
  return changed;
}

// GET /api/codes?branch= — list codes + the valid category set (any authed user)
router.get('/', async (req, res) => {
  try {
    const codes = await readCodes(branchOf(req));
    res.json({ categories: CATEGORIES, codes: codes.map(toDto) });
  } catch (e) { logger.error('codes', 'list failed', e); res.status(500).json({ error: 'Errore interno' }); }
});

// POST /api/codes — create { code, label, category, branch? }
router.post('/', requirePermission('config.manage'), async (req, res) => {
  try {
    const branch = branchOf(req);
    const code = String((req.body && req.body.code) || '').trim();
    const label = normLabel(req.body && req.body.label);
    const category = String((req.body && req.body.category) || '').trim();
    if (!CODE_RE.test(code)) return res.status(400).json({ error: 'Codice non valido (lettere, numeri, . _ -, max 20)' });
    if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'Categoria non valida' });
    const changed = await mutateCodes(branch, req.user.username, (codes) => {
      if (codes.some((c) => String(c.code).toLowerCase() === code.toLowerCase())) return null; // conflict
      codes.push({ code, label, cls: category });
      return codes;
    });
    if (!changed) return res.status(409).json({ error: 'Codice già esistente' });
    await audit(req, 'config', null, 'create', `Codice creato: ${code} (${category})`);
    res.status(201).json({ ok: true, code: toDto({ code, label, cls: category }) });
  } catch (e) { logger.error('codes', 'create failed', e); res.status(500).json({ error: 'Errore interno' }); }
});

// PUT /api/codes/:code — update label/category { label, category, branch? }
router.put('/:code', requirePermission('config.manage'), async (req, res) => {
  try {
    const branch = branchOf(req);
    const target = String(req.params.code || '').trim();
    const label = normLabel(req.body && req.body.label);
    const category = String((req.body && req.body.category) || '').trim();
    if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'Categoria non valida' });
    let found = false;
    const changed = await mutateCodes(branch, req.user.username, (codes) => {
      const next = codes.map((c) => {
        if (String(c.code).toLowerCase() === target.toLowerCase()) { found = true; return { ...c, label, cls: category }; }
        return c;
      });
      return found ? next : null;
    });
    if (!found || !changed) return res.status(404).json({ error: 'Codice non trovato' });
    await audit(req, 'config', null, 'update', `Codice aggiornato: ${target} (${category})`);
    res.json({ ok: true });
  } catch (e) { logger.error('codes', 'update failed', e); res.status(500).json({ error: 'Errore interno' }); }
});

// DELETE /api/codes/:code?branch=
router.delete('/:code', requirePermission('config.manage'), async (req, res) => {
  try {
    const branch = branchOf(req);
    const target = String(req.params.code || '').trim();
    let found = false;
    const changed = await mutateCodes(branch, req.user.username, (codes) => {
      const next = codes.filter((c) => {
        const hit = String(c.code).toLowerCase() === target.toLowerCase();
        if (hit) found = true;
        return !hit;
      });
      return found ? next : null;
    });
    if (!found || !changed) return res.status(404).json({ error: 'Codice non trovato' });
    await audit(req, 'config', null, 'delete', `Codice eliminato: ${target}`);
    res.json({ ok: true });
  } catch (e) { logger.error('codes', 'delete failed', e); res.status(500).json({ error: 'Errore interno' }); }
});

module.exports = router;
