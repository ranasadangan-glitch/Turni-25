// Reconcile scheduler_config.services[].count against the global master codes
// (scheduler_config.codes) for every branch, enforcing the invariant:
//
//   services[].count ⊆ codes[].code
//
// For each branch it loads codes + services, prunes each service's counted set to
// the valid master codes (preserving order and all other service properties),
// prints a report of what would be removed, and writes the services key back
// ONLY when something changed. Idempotent: a second run finds nothing to prune.
//
// It NEVER deletes master codes, and NEVER touches employees, schedule data,
// KPI, filiali/contratti or any config key other than 'services'.
//
// Usage:
//   node scripts/reconcile-service-codes.js            # apply (report + write)
//   node scripts/reconcile-service-codes.js --dry-run  # report only, no writes
//   node scripts/reconcile-service-codes.js --dry-run DLO1   # single branch
const { pool } = require('../src/db/pool');
const { pruneServiceCounts } = require('../src/services/serviceCodes');

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry-run');
  const branchArg = args.find((a) => !a.startsWith('--'));

  const { rows: brs } = await pool.query(
    "SELECT DISTINCT branch_code FROM scheduler_config WHERE config_key='services' ORDER BY branch_code");
  const branches = branchArg ? [branchArg] : brs.map((r) => r.branch_code);

  let changedBranches = 0; let removedTotal = 0;
  for (const branch of branches) {
    const { rows } = await pool.query(
      "SELECT config_key, config_value FROM scheduler_config WHERE branch_code=$1 AND config_key IN ('codes','services')",
      [branch]);
    let codes = []; let services = null;
    for (const r of rows) {
      if (r.config_key === 'codes') codes = Array.isArray(r.config_value) ? r.config_value : [];
      else if (r.config_key === 'services') services = Array.isArray(r.config_value) ? r.config_value : [];
    }
    if (services === null) { console.log(`[${branch}] no services key — skipped`); continue; }

    const { services: pruned, changed, report } = pruneServiceCounts(services, codes);
    if (!changed) { console.log(`[${branch}] OK — no stale codes`); continue; }

    report.forEach((r) => {
      removedTotal += r.removed.length;
      console.log(`[${branch}] service "${r.service}": remove ${r.removed.join(', ')}`);
    });
    if (dry) {
      console.log(`[${branch}] DRY-RUN — ${report.length} service(s) would change (not written)`);
    } else {
      await pool.query(
        `INSERT INTO scheduler_config (branch_code, config_key, config_value, updated_by)
         VALUES ($1,'services',$2,'reconcile-service-codes')
         ON CONFLICT (branch_code, config_key)
         DO UPDATE SET config_value=EXCLUDED.config_value, updated_by=EXCLUDED.updated_by, updated_at=now()`,
        [branch, JSON.stringify(pruned)]);
      console.log(`[${branch}] WRITTEN — ${report.length} service(s) updated`);
    }
    changedBranches++;
  }
  console.log(dry
    ? `Dry-run complete: ${changedBranches} branch(es), ${removedTotal} stale reference(s) would be removed.`
    : `Reconciliation complete: ${changedBranches} branch(es) updated, ${removedTotal} stale reference(s) removed.`);
}

if (require.main === module) {
  main()
    .then(() => pool.end())
    .catch((e) => { console.error('reconcile-service-codes failed:', e.message); process.exit(1); });
}

module.exports = { main };
