// Derives the `branches` reference table from scheduler_config.filiali — the same
// authoritative store the Config "Filiali" screen edits — so the employee form's
// Filiale dropdown (via /api/meta/branches) never drifts from management. This is
// the Filiali sibling of scripts/sync-shift-vocab.js (codes/contracts) and runs at
// the same point (scheduler config import).
//
// Also syncs scheduler_config.services (FORECAST/coverage defs: DLO1_NEXT,
// MM_SAMEA…) -> service_types, so the employee Servizio dropdown offers the same
// services as the rest of the app (per the product decision that employees are
// assigned to forecast services). service_types.code = service.key,
// service_types.name = service.label. ADDITIVE + reversible: legacy service_types
// NOT in config are deactivated ONLY when no employee uses them, so nobody's
// current assignment is broken (in-use legacy services stay until reassigned).
//
// Mapping: scheduler_config.filiali (branch CODES) -> branches.code;
//   branches.name from scheduler_config.filDetails[code].name, else the code.
// Reconcile = UPSERT + DEACTIVATE-IF-UNUSED. branches is FK-referenced with
// ON DELETE CASCADE (schedules) / SET NULL (employees), so we never hard-delete.
// active=FALSE is a plain flag (no cascade); and we only deactivate branches with
// NO employees, so a branch still in use is never hidden.
const { pool } = require('../src/db/pool');

async function syncOrgVocab(branch = 'DLO1') {
  const { rows } = await pool.query(
    `SELECT config_key, config_value FROM scheduler_config
      WHERE branch_code=$1 AND config_key IN ('filiali','filDetails','services')`,
    [branch]
  );
  const filiali = rows.find((r) => r.config_key === 'filiali')?.config_value || [];
  const filDetails = rows.find((r) => r.config_key === 'filDetails')?.config_value || {};
  const services = rows.find((r) => r.config_key === 'services')?.config_value || [];

  let branchCount = 0;
  for (const code of filiali) {
    if (!code) continue;
    const name = (filDetails[code] && filDetails[code].name) || code;
    await pool.query(
      `INSERT INTO branches (code, name, active) VALUES ($1,$2,TRUE)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, active = TRUE`,
      [code, name]
    );
    branchCount++;
  }
  // Deactivate non-config branches, but ONLY when no employee references them
  // (so an in-use branch is never hidden). Removed-and-empty branches stop
  // appearing as options; the row survives for any historical schedule/absence.
  let branchesDeactivated = 0;
  if (filiali.length) {
    const r = await pool.query(
      `UPDATE branches SET active = FALSE
        WHERE active AND code <> ALL($1::text[])
          AND id NOT IN (SELECT DISTINCT branch_id FROM employees WHERE branch_id IS NOT NULL)`,
      [filiali]
    );
    branchesDeactivated = r.rowCount;
  }

  // ── Service types (from forecast services) ────────────────────────
  let svcCount = 0, so = 0;
  for (const s of services) {
    if (!s || !s.key) continue;
    await pool.query(
      `INSERT INTO service_types (code, name, active, sort_order) VALUES ($1,$2,TRUE,$3)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, active = TRUE, sort_order = EXCLUDED.sort_order`,
      [s.key, s.label || s.key, so++]
    );
    svcCount++;
  }
  // Deactivate non-config service types ONLY when unused (same safety as branches):
  // an in-use legacy service (e.g. NEXT with employees) stays selectable until
  // those employees are reassigned, so no assignment is silently orphaned.
  let svcDeactivated = 0;
  if (services.length) {
    const keys = services.map((s) => s.key).filter(Boolean);
    if (keys.length) {
      const r = await pool.query(
        `UPDATE service_types SET active = FALSE
          WHERE active AND code <> ALL($1::text[])
            AND id NOT IN (SELECT DISTINCT service_type_id FROM employees WHERE service_type_id IS NOT NULL)`,
        [keys]
      );
      svcDeactivated = r.rowCount;
    }
  }

  console.log(`Synced from scheduler_config[${branch}]: ${branchCount} branches (deactivated ${branchesDeactivated} unused), ${svcCount} service_types (deactivated ${svcDeactivated} unused).`);
  return { branches: branchCount, branchesDeactivated, service_types: svcCount, svcDeactivated };
}

if (require.main === module) {
  (async () => {
    try {
      await syncOrgVocab(process.argv[2] || 'DLO1');
      await pool.end();
    } catch (e) {
      console.error('sync-org-vocab failed:', e.message);
      process.exit(1);
    }
  })();
}

module.exports = { syncOrgVocab };
