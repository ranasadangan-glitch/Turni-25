// ============================================================
// Scheduler UX — committed headless-Chromium regression harness.
//
// Drives the REAL frontend modules (board.js / workspace.js / scheduler.js /
// router.js) inside headless Chromium via --dump-dom and asserts a RESULT
// block. Covers the 5 prioritized cases from the coverage review:
//   1. paint write-path re-applies rule (#2) + edit (#5) markers
//   2. save-state pill: unsaved count + last-saved time lifecycle (#5)
//   3. coverage strip stays in sync under bulk paint, coalesced (#1/#3)
//   4. range select + fill/clear + repeat previous week (#3)
//   5. per-cell attribution: session edit wins over persisted DB meta (#5)
//
// Dependency-free: Node's built-in test runner + a Chromium binary already on
// the machine (no Playwright/puppeteer install). Each case is a self-contained
// HTML harness in test/browser/ that references the real modules through the
// tokens below.
//
// Requires a Chromium binary (CHROME_BIN, PLAYWRIGHT_BROWSERS_PATH/chromium, or
// /opt/pw-browsers/chromium). If none is found the suite SKIPS rather than
// failing, so it is safe in environments without a browser.
//
// Run with:  npm test   (from the server/ directory)
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FE = path.join(__dirname, '..', 'frontend');
const MOD = path.join(FE, 'modules', 'scheduler');
// Token -> absolute path of the real module the harness loads via <script src>.
const TOKENS = {
  SCHED_JS: path.join(MOD, 'scheduler.js'),
  BOARD_JS: path.join(MOD, 'board.js'),
  WS_JS: path.join(MOD, 'workspace.js'),
  ROUTER_JS: path.join(FE, 'js', 'router.js'),
};

function findChrome() {
  const cands = [
    process.env.CHROME_BIN,
    process.env.PLAYWRIGHT_BROWSERS_PATH && path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium'),
    '/opt/pw-browsers/chromium',
  ];
  return cands.find((p) => p && fs.existsSync(p)) || null;
}
const CHROME = findChrome();
const SKIP = CHROME ? false : 'Chromium not found — scheduler UX browser tests skipped';

// Render a harness in headless Chromium and return the #out lines it emitted.
function run(harnessFile) {
  let html = fs.readFileSync(path.join(__dirname, 'browser', harnessFile), 'utf8');
  for (const [tok, abs] of Object.entries(TOKENS)) html = html.split(tok).join(abs);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sux-'));
  try {
    const htmlPath = path.join(dir, 'h.html');
    fs.writeFileSync(htmlPath, html);
    const out = execFileSync(CHROME, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--allow-file-access-from-files',
      '--no-first-run', '--no-default-browser-check',
      '--user-data-dir=' + path.join(dir, 'ud'),
      '--virtual-time-budget=5000', '--dump-dom', 'file://' + htmlPath,
    ], { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'ignore'] });
    const m = out.match(/<pre id="out">([\s\S]*?)<\/pre>/);
    assert.ok(m, 'no #out block in rendered DOM (harness ' + harnessFile + ')');
    return m[1]
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
      .trim().split('\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function expectAllPass(lines) {
  const failed = lines.filter((l) => /: false$/.test(l));
  assert.deepStrictEqual(failed, [], 'failing assertions:\n' + lines.join('\n'));
  assert.ok(lines.includes('RESULT: ALL PASS'), 'missing ALL PASS:\n' + lines.join('\n'));
}

test('paint write-path re-applies rule (#2) + edit (#5) markers on the live board', { skip: SKIP }, () => {
  expectAllPass(run('paint-markers.html'));
});
test('save-state pill: unsaved count + last-saved time lifecycle (#5)', { skip: SKIP }, () => {
  expectAllPass(run('save-state.html'));
});
test('coverage strip stays in sync under bulk paint, coalesced (#1/#3)', { skip: SKIP }, () => {
  expectAllPass(run('coverage-strip.html'));
});
test('range select + fill/clear + repeat previous week (#3)', { skip: SKIP }, () => {
  expectAllPass(run('range-tools.html'));
});
test('per-cell attribution: session edit wins over persisted DB meta (#5)', { skip: SKIP }, () => {
  expectAllPass(run('attribution.html'));
});
