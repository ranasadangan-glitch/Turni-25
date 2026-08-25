// Mirrors the DEF_GROUPS / DEF_CODES / DEF_CONTRACTS / DEF_SERVICES / DEF_COUNTERS /
// DEF_FILIALI / DEF_STYPES constants hardcoded in
// server/frontend/modules/scheduler/scheduler.js (search that file for the same
// names). Those were the *only* place this vocabulary lived — scheduler_config
// was never actually populated, so the app fell back to these on every load.
// seed-scheduler-config.js writes them into scheduler_config once (DLO1) so the
// DB becomes the real source of truth; sync-shift-vocab.js then derives
// shift_codes/contract_types from scheduler_config, not from this file directly.
// If the frontend's DEF_* constants change, update them here too.

const DEF_GROUPS = [
  { cls: 'next', name: 'Rotte NEXT (DLO1)' },
  { cls: 'samea', name: 'Same Day — furgone' },
  { cls: 'sameb', name: 'Same Day — furgone (B/C)' },
  { cls: 'mm', name: 'Micromobilità (cargo bike)' },
  { cls: 'abs', name: 'Altri servizi' },
  { cls: 'mal', name: 'Assenze' },
  { cls: 'off', name: 'Riposo' },
];

const DEF_CODES = [
  ['X', 'NEXT', 'next'], ['L1', 'NEXT L1', 'next'], ['L2', 'NEXT L2', 'next'], ['L3', 'NEXT L3', 'next'],
  ['LAVORA', 'Lavora', 'next'], ['XN', 'NEXT N', 'next'], ['EXTRA', 'Extra', 'next'], ['CT', 'CT', 'next'],
  ['SameA', 'Same A', 'samea'], ['SameE', 'Same E', 'samea'], ['SameAE', 'Same A+E', 'samea'],
  ['SameB', 'Same B', 'sameb'], ['SameC', 'Same C', 'sameb'], ['SameBC', 'Same B+C', 'sameb'],
  ['MM', 'CargoBike NEXT', 'mm'], ['MMA', 'MM Same A', 'mm'], ['MME', 'MM Same E', 'mm'],
  ['MMAE', 'MM Same A+E', 'mm'], ['MMB', 'MM Same B', 'mm'], ['MMC', 'MM Same C', 'mm'], ['MMBC', 'MM Same B+C', 'mm'],
  ['XW', 'Walker', 'abs'], ['N', 'Navetta', 'abs'], ['NAV', 'Navetta AMZ', 'abs'], ['NAVETTA', 'Navetta', 'abs'],
  ['FEDEX', 'FedEx', 'abs'], ['TNT', 'TNT', 'abs'], ['MILKMAN', 'Milkman', 'abs'], ['UFFICIO', 'Ufficio', 'abs'],
  ['FLEET', 'Fleet', 'abs'], ['AFF', 'Affiancato', 'abs'], ['CORSO', 'Corso', 'abs'],
  ['DLZ1', 'DLZ1', 'abs'], ['DLZ2', 'DLZ2', 'abs'], ['DLZ3', 'DLZ3', 'abs'],
  ['DLO1', 'DLO1', 'abs'], ['DLO7', 'DLO7', 'abs'], ['DLO8', 'Altri appalti', 'abs'],
  ['M', 'Malattia', 'mal'], ['I', 'Infortunio', 'mal'], ['AI', 'Assenza ing.', 'mal'], ['PT', 'Paternità', 'mal'],
  ['F', 'Ferie', 'mal'], ['ROL', 'ROL', 'mal'], ['PS', 'Perm. sindacale', 'mal'], ['104', 'Legge 104', 'mal'],
  ['LUTTO', 'Lutto', 'mal'], ['ASP', 'Aspettativa', 'mal'], ['DS', 'Donazione sangue', 'mal'],
  ['SOSPESO', 'Sospeso', 'mal'], ['PR', 'Perm. retribuito', 'mal'], ['EXF', 'Ex festività', 'mal'],
  ['CI', 'Cassa int.', 'mal'], ['MATR', 'Matrimoniale', 'mal'], ['CONG', 'Congedo', 'mal'],
  ['SCIOPERO', 'Sciopero', 'mal'], ['EM', 'Emergency', 'mal'], ['OFF', 'Riposo', 'off'],
].map(([code, label, cls]) => ({ code, label, cls }));

// Contracts are defined by WORKING DAYS + HR rules (type, days/week,
// consecutive rest, allowed days), never by hours.
const DEF_CONTRACTS = [
  { code: '21', label: 'Full time', type: 'full', workDays: 6, restDays: 1, defDays: [1, 2, 3, 4, 5, 6] },
  { code: 'PTV 18h', label: 'Part-time Verticale', type: 'vertical', workDays: 3, restDays: 4, defDays: [1, 2, 3] },
  { code: 'PTV 13h', label: 'Part-time Verticale', type: 'vertical', workDays: 2, restDays: 5, defDays: [1, 2] },
  { code: '13', label: 'Part-time', type: 'part', workDays: 5, restDays: 2, defDays: [1, 2, 3, 4, 5] },
  { code: 'PTO 24h', label: 'Part-time Orizzontale', type: 'part', workDays: 4, restDays: 3, defDays: [1, 2, 3, 4] },
  { code: 'PTI 26h', label: 'Part-time', type: 'part', workDays: 5, restDays: 2, defDays: [1, 2, 3, 4, 5] },
  { code: 'PTO 26h', label: 'Part-time Orizzontale', type: 'part', workDays: 5, restDays: 2, defDays: [1, 2, 3, 4, 5] },
  { code: 'PTO 32h', label: 'Part-time Orizzontale', type: 'part', workDays: 6, restDays: 1, defDays: [1, 2, 3, 4, 5, 6] },
];

const DEF_SERVICES = [
  { key: 'DLO1_NEXT', label: 'DLO1 NEXT', count: ['X', 'L1', 'L2', 'L3', 'LAVORA', 'XN', 'EXTRA', 'CT'], filiali: ['DLO1'] },
  { key: 'DLO1_MM_NEXT', label: 'DLO1 MM NEXT', count: ['MM'], filiali: ['DLO1'] },
  { key: 'DLO1_SAMEB', label: 'DLO1 Same B', count: ['SameB'], dlo1b: true, filiali: ['DLO1'] },
  { key: 'DLO1_MM_SAMEB', label: 'DLO1 MM Same B', count: ['MMB'], dlo1b: true, filiali: ['DLO1'] },
  { key: 'SAMEAE', label: 'SAME AE', count: ['SameAE'], minOf: ['SAMEA', 'SAMEE'], filiali: [] },
  { key: 'SAMEA', label: 'SAME A', count: ['SameA', 'SameAE'], filiali: [] },
  { key: 'SAMEE', label: 'SAME E', count: ['SameE', 'SameAE'], filiali: [] },
  { key: 'SAMEBC', label: 'SAME BC', count: ['SameBC'], minOf: ['SAMEB', 'SAMEC'], filiali: [] },
  { key: 'SAMEB', label: 'SAME B', count: ['SameB', 'SameBC'], filiali: [] },
  { key: 'SAMEC', label: 'SAME C', count: ['SameC', 'SameBC'], filiali: [] },
  { key: 'MM_SAMEAE', label: 'MM Same AE', count: ['MMAE'], minOf: ['MM_SAMEA', 'MM_SAMEE'], filiali: [] },
  { key: 'MM_SAMEA', label: 'MM Same A', count: ['MMA', 'MMAE'], filiali: [] },
  { key: 'MM_SAMEE', label: 'MM Same E', count: ['MME', 'MMAE'], filiali: [] },
  { key: 'MM_SAMEBC', label: 'MM Same BC', count: ['MMBC'], minOf: ['MM_SAMEB', 'MM_SAMEC'], filiali: [] },
  { key: 'MM_SAMEB', label: 'MM Same B', count: ['MMB', 'MMBC'], filiali: [] },
  { key: 'MM_SAMEC', label: 'MM Same C', count: ['MMC', 'MMBC'], filiali: [] },
];

const DEF_COUNTERS = {
  next: ['X', 'L1', 'L2', 'L3', 'LAVORA', 'XN', 'EXTRA', 'CT'],
  unavail: ['M', 'I', 'AI', 'PT', 'F', 'UFFICIO', 'ROL', 'TNT', 'MILKMAN', 'NAVETTA', 'PS', '104', 'LUTTO', 'ASP', 'DS', 'SOSPESO', 'PR', 'EXF', 'CI', 'MATR', 'FLEET', 'OFF', 'CONG', 'SCIOPERO'],
  sick: ['M', 'I'],
};

const DEF_FILIALI = ['DLO1', 'DLO7'];

const SERVICE_TYPES = ['NEXT', 'SAME A', 'SAME E', 'SAME AE', 'SAME B', 'SAME C', 'MM', 'MM SAME A', 'MM SAME B', 'WALKER', 'NAVETTA'];
const SERVICE_DEFAULT_CODE = { NEXT: 'X', 'SAME A': 'SameA', 'SAME E': 'SameE', 'SAME AE': 'SameAE', 'SAME B': 'SameB', 'SAME C': 'SameC', MM: 'MM', 'MM SAME A': 'MMA', 'MM SAME B': 'MMB', WALKER: 'XW', NAVETTA: 'NAVETTA' };
const DEF_STYPES = SERVICE_TYPES.map((n) => ({ name: n, defaultCode: SERVICE_DEFAULT_CODE[n] || 'X' }));

module.exports = { DEF_GROUPS, DEF_CODES, DEF_CONTRACTS, DEF_SERVICES, DEF_COUNTERS, DEF_FILIALI, DEF_STYPES };
