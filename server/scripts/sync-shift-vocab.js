// Derives shift_codes / contract_types from scheduler_config — the scheduler
// UI's real, editable config store — so those two reference tables never
// drift from what the Config screen (and the Workspace/Legenda tab) actually
// show. Run this any time scheduler_config changes:
//   node scripts/sync-shift-vocab.js [branch]   (default branch: DLO1)
// It is also run automatically at the end of `npm run seed`.
//
// Mapping: scheduler_config's `cls` (next|samea|sameb|mm|abs|mal|off) becomes
// shift_codes.category directly. is_absence = cls==='mal', is_off = cls==='off',
// is_work = everything else (this includes cls==='abs', which despite the
// short name is the "Altri servizi" group — UFFICIO, AFF, N, DLO7, etc. are
// worked days, just not core NEXT/SAME/MM routes).
// contract_types.weekly_hours is derived from `ore` (a monthly-hours figure)
// divided by 4.33 (average weeks/month) — an approximation, not a figure the
// source data states directly.
const { pool } = require('../src/db/pool');

async function syncShiftVocab(branch = 'DLO1') {
  const { rows: cfgRows } = await pool.query(
    `SELECT config_key, config_value FROM scheduler_config WHERE branch_code=$1 AND config_key IN ('codes','contracts')`,
    [branch]
  );
  const codes = cfgRows.find((r) => r.config_key === 'codes')?.config_value || [];
  const contracts = cfgRows.find((r) => r.config_key === 'contracts')?.config_value || [];

  if (!codes.length && !contracts.length) {
    console.log(`scheduler_config[${branch}] has no 'codes' or 'contracts' key yet — nothing to sync. Run seed-scheduler-config.js first.`);
    return { codes: 0, contracts: 0 };
  }

  let codeCount = 0;
  for (const c of codes) {
    const isAbsence = c.cls === 'mal';
    const isOff = c.cls === 'off';
    const isWork = !isAbsence && !isOff;
    await pool.query(
      `INSERT INTO shift_codes (code, label, category, is_work, is_absence, is_off)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (code) DO UPDATE SET
         label = EXCLUDED.label, category = EXCLUDED.category,
         is_work = EXCLUDED.is_work, is_absence = EXCLUDED.is_absence, is_off = EXCLUDED.is_off`,
      [c.code, c.label, c.cls, isWork, isAbsence, isOff]
    );
    codeCount++;
  }
  // Reconcile: scheduler_config is authoritative, so a code removed there must
  // also disappear from shift_codes. Without this, upsert-only sync leaves
  // orphan rows behind after a delete. shift_codes has no FK referencing it
  // (schedules.shift_code is free TEXT), so removing a row is non-destructive
  // to historical schedule data.
  const keptCodes = codes.map((c) => c.code);
  const delCodes = await pool.query(
    keptCodes.length
      ? 'DELETE FROM shift_codes WHERE code <> ALL($1::text[])'
      : 'DELETE FROM shift_codes',
    keptCodes.length ? [keptCodes] : []
  );

  // Contracts are day-based, not hour-based: default_days = number of working
  // days per week. weekly_hours is left NULL (the column stays for schema
  // compatibility but is no longer used by scheduling).
  let contractCount = 0;
  for (const c of contracts) {
    const defaultDays = c.workDays != null ? c.workDays
      : (Array.isArray(c.defDays) ? c.defDays.length : 5);
    await pool.query(
      `INSERT INTO contract_types (code, label, weekly_hours, default_days)
       VALUES ($1,$2,0,$3)
       ON CONFLICT (code) DO UPDATE SET
         label = EXCLUDED.label, weekly_hours = 0, default_days = EXCLUDED.default_days`,
      [c.code, c.label, defaultDays]
    );
    contractCount++;
  }
  // Reconcile contract_types too. employees.contract_type_id is ON DELETE SET
  // NULL, so removing a contract type that employees still reference simply
  // clears their contract link rather than failing — acceptable, and the
  // alternative (orphan contract types) is worse for a source-of-truth model.
  const keptContracts = contracts.map((c) => c.code);
  if (keptContracts.length) {
    await pool.query('DELETE FROM contract_types WHERE code <> ALL($1::text[])', [keptContracts]);
  } else if (contracts.length === 0 && codes.length === 0) {
    // guard already returned above; here contracts is simply empty in config
  }

  console.log(`Synced from scheduler_config[${branch}]: ${codeCount} shift_codes (removed ${delCodes.rowCount}), ${contractCount} contract_types.`);
  return { codes: codeCount, contracts: contractCount, removedCodes: delCodes.rowCount };
}

if (require.main === module) {
  (async () => {
    try {
      await syncShiftVocab(process.argv[2] || 'DLO1');
      await pool.end();
    } catch (e) {
      console.error('sync-shift-vocab failed:', e.message);
      process.exit(1);
    }
  })();
}

module.exports = { syncShiftVocab };
