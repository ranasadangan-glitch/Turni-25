/* TurniDSP — SPA Router
   Estratto dal monolite app.html: stesso scope globale, stesso comportamento.
   Ordine di caricamento definito in app.html (vedi fondo pagina). */
// ── SPA Router ───────────────────────────────────────────────────
// One workspace: Scheduler (which now also contains the overview strip
// formerly known as "Dashboard"). Employees / Reports / Settings remain
// separate sections reachable from the sidebar, but they all share the
// exact same shell — header, sidebar, theme, and TurniApi state.
var _currentSection   = 'scheduler';
var _workspaceInited  = false;
var _reportsInited    = false;
var _employeesInited  = false;

var SECTION_TITLES = {
  scheduler: 'Home',
  employees: 'Dipendenti',
  reports:   'Report',
  settings:  'Impostazioni',
  forecast:  'Forecast',
};
// Which half of the scheduler section is showing: 'home' (overview strip) or
// 'planning' (the planner board). Both live in #sec-scheduler.
var _schedMode = 'home';

function navigate(section, opts) {
  opts = opts || {};
  // Unsaved-changes guard: only when actually leaving one section for another.
  // Modules opt in via AppGuard.register(); if none are dirty this is a no-op.
  if (window.AppGuard && _currentSection && section !== _currentSection && AppGuard.isDirty()) {
    if (!AppGuard.confirmLeave()) return;
  }
  var _prevSection = _currentSection;
  _currentSection = section;

  // Show/hide top-level sections
  document.querySelectorAll('.spa-section').forEach(function(el) {
    el.classList.toggle('active', el.id === 'sec-' + section);
  });

  // Update sidebar nav links. Home/Planning are two views of the scheduler
  // section and manage their own active state (goHome/goPlanning); clear them
  // whenever we land on a different top-level section.
  document.querySelectorAll('.nav-item[data-section]').forEach(function(b) {
    var isActive = b.dataset.section === section;
    b.classList.toggle('active', isActive);
    b.setAttribute('aria-current', isActive ? 'page' : 'false');
  });
  if (section !== 'scheduler') {
    ['navHome', 'navPlanning'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) { el.classList.remove('active'); el.setAttribute('aria-current', 'false'); }
    });
  }

  // Update header title
  document.getElementById('pageTitle').textContent = SECTION_TITLES[section] || section;
  document.getElementById('pageSubtitle').textContent = '';

  var workspaceHeader = document.getElementById('workspaceHeader');
  var planToolbar      = document.getElementById('planToolbar');

  if (section === 'scheduler') {
    workspaceHeader.style.display = 'flex';

    // Boot the workspace (overview strip + scheduler engine) exactly once.
    if (!_workspaceInited) {
      _workspaceInited = true;
      bootWorkspaceOverview();
      // loadMonth() è già stato invocato dal bridge auth a parse-time (DB-first)
    } else {
      refreshOverview();
    }

    // Apply the current Home/Planning view. Centralised here so every entry
    // point into the scheduler section (KPI-row clicks, ctrl+F, notifications)
    // shows the right half rather than both stacked.
    var _ov = document.getElementById('workspaceOverview');
    var _bd = document.getElementById('schedulerBoard');
    if (_schedMode === 'planning') {
      if (_ov) _ov.style.display = 'none';
      if (_bd) _bd.style.display = '';
      if (planToolbar) planToolbar.style.display = '';
    } else {
      if (_ov) _ov.style.display = '';
      if (_bd) _bd.style.display = 'none';
      if (planToolbar) planToolbar.style.display = 'none';
    }

    // Apply any filters passed in from an overview widget click
    if (opts.branch) {
      teamFiliale = opts.branch;
      ensureTeamFiliale();
    }
    if (opts.filterStatus) {
      var fs = document.getElementById('fStato');
      if (fs) fs.value = opts.filterStatus;
    }
    // Only call refreshAll if state is already loaded (non-DB-first path)
    if (!DB_SYNC) refreshAll();

  } else if (section === 'employees') {
    workspaceHeader.style.display = 'none';
    if (!_employeesInited) {
      _employeesInited = true;
      bootPeople();
    }

  } else if (section === 'reports') {
    workspaceHeader.style.display = 'none';
    if (!_reportsInited) {
      _reportsInited = true;
      renderReportCharts();
    }

  } else if (section === 'settings') {
    workspaceHeader.style.display = 'none';
    loadUsers();

  } else {
    workspaceHeader.style.display = 'none';
  }

  // Update browser URL without reload
  try { history.pushState({ section: section }, '', '#' + section); } catch(e) {}

  // Announce the navigation so any module can react (no direct dependencies).
  if (window.AppBus) AppBus.emit('route:change', { section: section, prev: _prevSection });
}

// ── Home vs Planning: two views of the scheduler section ─────────
// Home  = the overview strip (KPIs, summaries, alerts), board hidden.
// Planning = the Excel-style planner board, overview hidden.
function _setTopNavActive(id) {
  ['navHome', 'navPlanning'].forEach(function(x) {
    var el = document.getElementById(x);
    if (el) { el.classList.toggle('active', x === id); el.setAttribute('aria-current', x === id ? 'page' : 'false'); }
  });
}
function goHome() {
  _schedMode = 'home';
  navigate('scheduler');           // applies home visibility (see scheduler branch)
  document.getElementById('pageTitle').textContent = 'Home';
  _setTopNavActive('navHome');
  window.scrollTo({ top: 0, behavior: 'auto' });
}
function goPlanning() {
  _schedMode = 'planning';
  navigate('scheduler');           // applies planning visibility
  if (typeof schedSetView === 'function') schedSetView('plan');
  document.getElementById('pageTitle').textContent = 'Pianificazione';
  _setTopNavActive('navPlanning');
  // Default the board to today (current WK/Month/Year, scroll to today column).
  if (typeof schedDefaultToday === 'function') { try { schedDefaultToday(); } catch (e) {} }
}

// Handle browser back/forward
window.addEventListener('popstate', function(e) {
  var section = (e.state && e.state.section) || location.hash.replace('#', '') || 'scheduler';
  navigate(section);
});

// ── Workspace overview: collapse / expand the KPI+Alerts strip ───
var _overviewCollapsed = false;
function toggleOverview() {
  _overviewCollapsed = !_overviewCollapsed;
  var body = document.getElementById('overviewBody');
  var btn  = document.getElementById('overviewToggle');
  if (body) body.style.display = _overviewCollapsed ? 'none' : '';
  if (btn)  btn.textContent = (_overviewCollapsed ? '▸' : '▾') + ' Riepilogo';
}

// ── Jump from the sidebar straight to the overview strip ─────────
function scrollToOverview() {
  // Make sure we're on the scheduler workspace first
  if (_currentSection !== 'scheduler') navigate('scheduler');
  if (_overviewCollapsed) toggleOverview();
  var el = document.getElementById('workspaceOverview');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.querySelectorAll('#sched-subnav .nav-item[data-v]').forEach(function(b) {
    b.classList.toggle('active', b.dataset.v === 'overview');
  });
}

// ── Click a KPI/alert/DSP row on Home → open the Planning board, filtered ──
// Home and Planning are now separate views, so drilling in from a Home widget
// switches to Planning first, then applies the filter.
function openSchedulerWithFilter(filterStatus) {
  goPlanning();
  if (typeof setNavActive === 'function') setNavActive('scheduler');
  var fs = document.getElementById('fStato');
  if (fs) { fs.value = filterStatus; renderGrid(); }
  var board = document.getElementById('boardOuter');
  if (board) board.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Scheduler sub-view navigation ────────────────────────────────
function schedSetView(v) {
  setView(v);
  // Update sidebar scheduler sub-nav
  document.querySelectorAll('#sched-subnav .nav-item[data-v]').forEach(function(b) {
    b.classList.toggle('active', b.dataset.v === v);
  });
  var planToolbar = document.getElementById('planToolbar');
  if (planToolbar) planToolbar.style.display = v === 'plan' ? '' : 'none';
  // The view-switched board sits BELOW the always-on overview strip, sharing
  // one scroll. Without this, picking Config/Legenda/etc. changes content the
  // user can't see (it's below the fold) and reads as a dead button. Scroll
  // the board into view so the chosen view is actually shown.
  var boardEl = document.getElementById('schedulerBoard');
  if (boardEl) boardEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Grouped sidebar menu dispatch ────────────────────────────────
// Every sidebar item calls go('<key>'). Most keys map to a screen that
// already exists (a top-level section, a scheduler sub-view, or a Settings
// tab); the rest open a placeholder until their screen is built.
function setNavActive(key) {
  var active = null;
  document.querySelectorAll('.nav-item[data-nav]').forEach(function(b) {
    var on = b.dataset.nav === key;
    b.classList.toggle('active', on);
    b.setAttribute('aria-current', on ? 'page' : 'false');
    if (on) active = b;
  });
  // Mark + auto-expand the group that owns the active page.
  document.querySelectorAll('.nav-group').forEach(function(g) { g.classList.remove('has-active'); });
  if (active) {
    var g = active.closest('.nav-group');
    if (g) { g.classList.add('has-active'); g.classList.remove('collapsed'); }
  }
}

// Show the scheduler board with a specific sub-view (Contratti, Analisi,
// Audit Log). These sch-views still live in the DOM even though they were
// dropped from the old sub-nav.
function showSchedView(v, title) {
  _schedMode = 'planning';
  navigate('scheduler');            // makes the board visible
  if (typeof schedSetView === 'function') schedSetView(v);
  document.getElementById('pageTitle').textContent = title || v;
}

function showPlaceholder(title, icon, desc) {
  var set = function(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; };
  set('phTitle', title); set('phName', title); set('phIcon', icon || '🚧'); set('phDesc', desc || '');
  navigate('placeholder');
  document.getElementById('pageTitle').textContent = title;
}

function go(key) {
  setNavActive(key);
  switch (key) {
    case 'home':          goHome(); break;
    case 'scheduler':     goPlanning(); break;
    // Forecast lives inside the Scheduler as the Coverage/Forecast view.
    case 'forecast':      navigate('forecast'); if (typeof bootForecastPage === 'function') bootForecastPage(); break;
    // Backward-compat deep-links (menu items removed — Turni/Calendar are now
    // views of the single Scheduler). "Turni" = the generated shifts, so it
    // opens the generator; "Calendario" = the month view.
    case 'turni':         goPlanning(); if (typeof openGenerator === 'function') { setTimeout(function () { try { openGenerator(); } catch (e) {} }, 60); } break;
    case 'calendario':    goPlanning(); if (typeof setPlanMode === 'function') { try { setPlanMode('month'); } catch (e) {} } break;
    case 'servizi':       navigate('settings'); if (typeof setCfgTab === 'function') setCfgTab('services'); break;
    // Config sections moved from the Settings tab-bar into the sidebar.
    case 'legenda':       navigate('settings'); if (typeof setCfgTab === 'function') setCfgTab('codes'); break;
    case 'contratti-cfg': navigate('settings'); if (typeof setCfgTab === 'function') setCfgTab('contracts'); break;
    case 'forecast-cfg':  navigate('settings'); if (typeof setCfgTab === 'function') setCfgTab('forecast'); break;
    case 'regole':        navigate('settings'); if (typeof setCfgTab === 'function') setCfgTab('rules'); break;
    case 'dipendenti':    navigate('employees'); break;
    case 'contratti':     showSchedView('contr', 'Contratti'); break;
    case 'report-dash':
    case 'report':        navigate('reports'); break;
    case 'analisi':       showSchedView('an', 'Analisi'); break;
    case 'esportazioni':  navigate('settings'); if (typeof setCfgTab === 'function') setCfgTab('io'); break;
    case 'sedi':          navigate('settings'); if (typeof setCfgTab === 'function') setCfgTab('filiali'); break;
    case 'audit':         navigate('auditlog'); if (typeof bootAudit === 'function') bootAudit(); break;
    case 'impostazioni':  navigate('settings'); if (typeof setCfgTab === 'function') setCfgTab('general'); break;
    case 'templates':     navigate('templates'); if (typeof bootTemplates === 'function') bootTemplates(); break;
    case 'presenze':      showPlaceholder('Presenze', '✅', 'Registro presenze giornaliere per dipendente. In arrivo.'); break;
    case 'assenze':       navigate('absences'); if (typeof bootAbsences === 'function') bootAbsences(); break;
    case 'documenti':     navigate('documents'); if (typeof bootDocuments === 'function') bootDocuments(); break;
    case 'ruoli':         navigate('roles'); if (typeof bootRoles === 'function') bootRoles(); break;
    // Settings-hub shortcuts (single page, different tabs — not duplicate pages).
    case 'utenti':        navigate('settings'); if (typeof setCfgTab === 'function') setCfgTab('account'); break;
    case 'importa':       navigate('settings'); if (typeof setCfgTab === 'function') setCfgTab('io'); break;
    // Sections not built yet → existing placeholder (no new pages).
    case 'team':          showPlaceholder('Team', '👥', 'Gestione team e squadre operative. In arrivo.'); break;
    case 'rotte':         showPlaceholder('Rotte', '🗺️', 'Gestione rotte e percorsi di consegna. In arrivo.'); break;
    case 'performance':   showPlaceholder('Performance', '📈', 'Performance operativa per dipendente e filiale. In arrivo.'); break;
    case 'kpi':           showPlaceholder('KPI', '🎯', 'KPI operativi Amazon DSP. In arrivo.'); break;
    default:              goHome();
  }
}

// ── Collapsible nav groups (persisted) ───────────────────────────
function toggleNavGroup(id) {
  var g = document.querySelector('.nav-group[data-group="' + id + '"]');
  if (!g) return;
  var collapsed = g.classList.toggle('collapsed');
  try { var s = JSON.parse(localStorage.getItem('turniDSP_navGroups') || '{}'); s[id] = collapsed; localStorage.setItem('turniDSP_navGroups', JSON.stringify(s)); } catch (e) {}
}
function _restoreNavGroups() {
  try {
    var s = JSON.parse(localStorage.getItem('turniDSP_navGroups') || '{}');
    Object.keys(s).forEach(function (id) { if (s[id]) { var g = document.querySelector('.nav-group[data-group="' + id + '"]'); if (g) g.classList.add('collapsed'); } });
  } catch (e) {}
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _restoreNavGroups);
else _restoreNavGroups();

// ── setSaveState (SPA version - updates both places) ─────────────
function setSaveState(st) {
  var el1 = document.getElementById('saveState');
  var el2 = document.getElementById('schedSaveState');
  var ns  = document.getElementById('navSync');
  var text = '';
  if (st === 'saving') text = '⏳ salvataggio…';
  else if (st === 'saved')  text = '✓ salvato ' + new Date().toLocaleTimeString('it-IT', {hour:'2-digit',minute:'2-digit'});
  else if (st === 'error')  text = '✗ errore DB';
  else if (st === 'queued') text = '⏳ in coda…';
  else if (st === 'local')  text = '💾 locale';
  if (el1) el1.textContent = text;
  if (el2) el2.textContent = text;
  if (ns && DB_SYNC) {
    ns.textContent = st==='saved'?'🟢 DB OK': st==='error'?'🔴 DB errore':'🔵 In sync…';
  }
}

// ── saveAll override for SPA ──────────────────────────────────────
var _origSaveAll = saveAll;
saveAll = function(manual) {
  setSaveState(DB_SYNC ? 'queued' : 'local');
  if (manual) toast(DB_SYNC ? 'Salvataggio in corso…' : 'Dati salvati in locale');
  if (DB_SYNC) { clearTimeout(dbSyncTimer); dbSyncTimer = setTimeout(saveMonthToDB, 1200); }
  else { try { localStorage.setItem(lsKey(YM), JSON.stringify(state)); } catch(_) {} }
};

// ── setView override (SPA toolbar sync) ──────────────────────────
var _origSetViewSPA = setView;
setView = function(v) {
  _origSetViewSPA(v);
  var planToolbar = document.getElementById('planToolbar');
  if (planToolbar) planToolbar.style.display = v === 'plan' ? '' : 'none';
};

// ── Autosave indicator ────────────────────────────────────────────
var _autoTimer = null;
function showAutosave(st) {
  var el = document.getElementById('autosaveIndicator');
  var icon = document.getElementById('autosaveIcon');
  var txt  = document.getElementById('autosaveText');
  if (!el) return;
  el.className = 'show ' + st;
  if (st==='saving') { icon.textContent='⏳'; txt.textContent='Salvataggio…'; }
  else if (st==='saved') { icon.textContent='✓'; txt.textContent='Salvato'; }
  else if (st==='error') { icon.textContent='✗'; txt.textContent='Errore salvataggio'; }
  clearTimeout(_autoTimer);
  _autoTimer = setTimeout(function(){ el.classList.remove('show'); }, 2200);
}


function showKbdHint(msg) {
  var el = document.getElementById('kbdHint');
  if (!el) return; el.textContent = msg; el.classList.add('show');
  clearTimeout(_hintTimer); _hintTimer = setTimeout(function(){ el.classList.remove('show'); }, 1400);
}


// ── Undo/Redo — implementazione reale (era un wrapper difensivo verso
//    funzioni mai definite: i pulsanti restavano disabilitati per sempre) ──
var UNDO_MAX = 50;
var undoStack = [], redoStack = [];
function pushUndo(snapshot) { undoStack.push(snapshot); if (undoStack.length > UNDO_MAX) undoStack.shift(); redoStack = []; updateUndoBar(); }
function snapshotSchedule() { return JSON.parse(JSON.stringify(state.schedule)); }
function doUndo() { if (!undoStack.length) return; redoStack.push(snapshotSchedule()); state.schedule = undoStack.pop(); dirty(); renderGrid(); updateUndoBar(); showKbdHint('\u21a9 Annullato'); toast('Modifica annullata'); }
function doRedo() { if (!redoStack.length) return; undoStack.push(snapshotSchedule()); state.schedule = redoStack.pop(); dirty(); renderGrid(); updateUndoBar(); showKbdHint('\u21aa Ripetuto'); toast('Modifica ripetuta'); }
function updateUndoBar() { var bar=document.getElementById('undoBar'),u=document.getElementById('undoBtn'),r=document.getElementById('redoBtn'); if(!bar)return; bar.classList.toggle('show', !!(undoStack.length||redoStack.length)); if(u)u.disabled=!undoStack.length; if(r)r.disabled=!redoStack.length; }
function spaDoUndo() { doUndo(); }
function spaDoRedo() { doRedo(); }

// ── Scheduler toolbar: single Filters toggle + "More" menu ───────
// Filters live in one collapsible bar (schedFilterBar); this button shows/hides
// it, cutting toolbar clutter while keeping the powerful multi-select popovers.
// NOTE: named distinctly from the legacy window.toggleSchedFilters (which
// targets a removed #schedFilters panel and is now dead), to avoid collision.
function toggleSchedFilterBar() {
  var bar = document.getElementById('schedFilterBar'); if (!bar) return;
  var open = bar.getAttribute('data-open') !== '1';
  bar.setAttribute('data-open', open ? '1' : '0');
  bar.style.display = open ? '' : 'none';
  var btn = document.getElementById('schedFiltersBtn');
  if (btn) { btn.classList.toggle('active', open); btn.setAttribute('aria-expanded', open ? 'true' : 'false'); }
}
// Advanced/occasional actions live in this dropdown (Centro, Forecast, Versioni,
// undo actions, Importa, +DAS). Their handlers/ids are unchanged.
function toggleSchedMore(ev) {
  if (ev && ev.stopPropagation) ev.stopPropagation();
  var panel = document.getElementById('schedMorePanel'); if (!panel) return;
  var open = panel.classList.toggle('on');
  var btn = document.getElementById('schedMoreBtn'); if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}
document.addEventListener('click', function (e) {
  var panel = document.getElementById('schedMorePanel');
  if (!panel || !panel.classList.contains('on')) return;
  // Close after choosing an item, or when clicking outside the menu.
  if (e.target.closest('.sch-more-item') || !e.target.closest('.sch-more')) panel.classList.remove('on');
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') { var p = document.getElementById('schedMorePanel'); if (p) p.classList.remove('on'); }
});

// ── showWorkspace(name): API pubblica del router (nessun reload) ──
function showWorkspace(name) {
  var map = { dashboard:'scheduler', workspace:'scheduler', scheduler:'scheduler',
              employees:'employees', people:'employees',
              reports:'reports', analytics:'reports',
              forecast:'scheduler', settings:'settings' };
  var section = map[name] || 'scheduler';
  navigate(section);
  if (name === 'dashboard') setTimeout(function(){ if (typeof scrollToOverview==='function') scrollToOverview(); }, 60);
  if (name === 'forecast')  setTimeout(function(){ if (typeof schedSetView==='function') schedSetView('cov'); }, 60);
}
