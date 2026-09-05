// Enforces the invariant between the global shift-code master and each service's
// Harmony/Delta counted-code subset:
//
//   scheduler_config.services[].count  ⊆  scheduler_config.codes[].code
//
// A service MAY count a subset of the master codes, but it must NEVER reference a
// code absent from the master. This is the single place that prunes stale
// references; it is used by the codes-delete cascade, the config-import save path
// and the reconciliation script, so the rule is enforced identically everywhere.
//
// Nothing here is hardcoded — the valid set is always derived from the passed-in
// master codes. Pruning preserves order and every other service property.

// Build the lower-cased set of valid master codes. Accepts either the config
// shape (array of {code,label,cls}) or a plain array of code strings.
function masterCodeSet(codes) {
  const set = new Set();
  (Array.isArray(codes) ? codes : []).forEach((c) => {
    const code = c && typeof c === 'object' ? c.code : c;
    if (code != null && String(code) !== '') set.add(String(code).toLowerCase());
  });
  return set;
}

// Pure: return { services, changed, report } where each service's `count` is
// filtered to the master set. `report` lists { service, removed[] } for services
// that lost stale codes. Services without a `count` array are returned untouched.
function pruneServiceCounts(services, codes) {
  const valid = masterCodeSet(codes);
  const report = [];
  let changed = false;
  const out = (Array.isArray(services) ? services : []).map((s) => {
    if (!s || !Array.isArray(s.count) || s.count.length === 0) return s;
    const removed = [];
    const kept = s.count.filter((code) => {
      const ok = valid.has(String(code).toLowerCase());
      if (!ok) removed.push(code);
      return ok;                       // preserves original order of kept codes
    });
    if (removed.length === 0) return s; // untouched
    changed = true;
    report.push({ service: s.key || s.label || '', removed });
    return Object.assign({}, s, { count: kept });
  });
  return { services: out, changed, report };
}

// Read a branch's codes + services from scheduler_config, prune the services to
// the master, and write the services key back ONLY if something changed.
// Idempotent: a second run finds nothing to prune and writes nothing.
// `db` is a pg client (inside a transaction) or the pool. Returns
// { branch, changed, report }.
async function reconcileBranchServiceCounts(db, branch, actor) {
  const { rows } = await db.query(
    "SELECT config_key, config_value FROM scheduler_config WHERE branch_code=$1 AND config_key IN ('codes','services')",
    [branch]
  );
  let codes = []; let services = null;
  for (const r of rows) {
    if (r.config_key === 'codes') codes = Array.isArray(r.config_value) ? r.config_value : [];
    else if (r.config_key === 'services') services = Array.isArray(r.config_value) ? r.config_value : [];
  }
  if (services === null) return { branch, changed: false, report: [] }; // no services key → nothing to do
  const { services: pruned, changed, report } = pruneServiceCounts(services, codes);
  if (changed) {
    await db.query(
      `INSERT INTO scheduler_config (branch_code, config_key, config_value, updated_by)
       VALUES ($1,'services',$2,$3)
       ON CONFLICT (branch_code, config_key)
       DO UPDATE SET config_value=EXCLUDED.config_value, updated_by=EXCLUDED.updated_by, updated_at=now()`,
      [branch, JSON.stringify(pruned), actor || 'reconcile']
    );
  }
  return { branch, changed, report };
}

module.exports = { masterCodeSet, pruneServiceCounts, reconcileBranchServiceCounts };
