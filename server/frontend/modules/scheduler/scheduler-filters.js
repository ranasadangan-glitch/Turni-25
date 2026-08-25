/* TurniDSP — Scheduler horizontal filter bar (Excel-Turni style)
 * ---------------------------------------------------------------------------
 * Replaces the left filter sidebar with a sticky horizontal toolbar above the
 * grid, maximising planner width. Excel-style MULTI-SELECT dropdowns for
 * Filiale / Servizio / Team / Contratto / Disponibilità / Supervisor, plus
 * Search and WK / Month / Year navigation, an employee count, remembered
 * filters and Reset.
 *
 * Reuses the existing filter model: the hidden native <select>s (#fFiliale,
 * #fService, #fStato, #fContract, #fTeam, #fManager) are still populated by
 * refreshFilSelects()/populateSchedFilters(); this bar reads their options and
 * mirrors the chosen values into window._schedMS (arrays) that the patched
 * filteredDrivers() consumes. No API/DB change; nothing else in the scheduler
 * is touched.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  window._schedMS = window._schedMS || {};          // { key: [values] }
  var LS = 'turniDSP_schedFilters';
  var MONTHS = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
  // key → { label, all } (label shown on the button, all = "nothing selected" text)
  var CATS = [
    { key: 'fFiliale', label: 'Filiale', all: 'Tutte' },
    { key: 'fService', label: 'Servizio', all: 'Tutti' },
    { key: 'fTeam', label: 'Team', all: 'Tutti' },
    { key: 'fContract', label: 'Contratto', all: 'Tutti' },
    { key: 'fStato', label: 'Disponibilità', all: 'Tutte' },
    { key: 'fManager', label: 'Supervisor', all: 'Tutti' }
  ];
  var STATO_OPTS = [
    { v: 'turno', l: 'In turno' }, { v: 'riposo', l: 'Riposo (OFF)' },
    { v: 'assente', l: 'Assenti' }, { v: 'dispo', l: 'Disponibili' }
  ];

  // ── option sources ─────────────────────────────────────────────────
  function _opts(key) {
    if (key === 'fStato') return STATO_OPTS.map(function (o) { return { v: o.v, l: o.l }; });
    var sel = document.getElementById(key);
    if (!sel) return [];
    return Array.prototype.slice.call(sel.options)
      .filter(function (o) { return o.value !== ''; })
      .map(function (o) { return { v: o.value, l: o.textContent }; });
  }
  function _labelFor(key, v) { var o = _opts(key).find(function (x) { return x.v === v; }); return o ? o.l : v; }

  // ── build the bar (once) ───────────────────────────────────────────
  window.schedBuildFilterBar = function () {
    var host = document.getElementById('schedFilterBar'); if (!host) return;
    var h = "<div class='sfb-row'>";
    // Month / Year / WK navigation
    h += "<div class='sfb-nav'>";
    // (The toolbar already has an "Oggi" button — no duplicate here.) Month/Year/
    // Week jumping stays, since the toolbar has no month/year picker.
    h += "<select id='sfbMonth' class='sfb-sel' onchange='schedSetMonth(this.value)' title='Mese'></select>";
    h += "<select id='sfbYear' class='sfb-sel' onchange='schedSetYear(this.value)' title='Anno'></select>";
    h += "<select id='sfbWeek' class='sfb-sel' onchange='schedSetWeek(this.value)' title='Settimana'></select>";
    h += "</div><div class='sfb-div'></div>";
    // Employee search (§2): "Tutti i dipendenti" filter with live search. Reuses
    // the existing #q field + _drvHay() (name, surname, ID, transporter, branch,
    // service, contract) via schedSearchInput().
    h += "<div class='sfb-search'>" +
      "<input type='search' id='sfbSearch' placeholder='🔍 Cerca tra tutti i dipendenti…' oninput='schedSearchInput(this.value)' onkeydown='schedSearchKey(event)' autocomplete='off' title='Nome, cognome, ID, badge, telefono, filiale, servizio, team (Ctrl+F)'>" +
      "<button class='sfb-search-x' id='sfbSearchX' style='display:none' onclick='schedSearchClear()' title='Cancella (Esc)' tabindex='-1'>✕</button>" +
      "</div>";
    h += "<div class='sfb-div'></div>";
    // Multi-select categorical filters
    CATS.forEach(function (c) {
      h += "<div class='sfb-ms' data-key='" + c.key + "'>" +
        "<button class='sfb-ms-btn' onclick='schedToggleMS(event,\"" + c.key + "\")'>" +
        "<span class='sfb-ms-lbl'>" + c.label + "</span>" +
        "<span class='sfb-ms-badge' id='badge_" + c.key + "'>" + c.all + "</span>▾</button></div>";
    });
    // Count + Clear-all. The single free-text "filter" input is removed (spec §1):
    // day-level filtering is now the per-column Excel AutoFilter (▼ on each day).
    h += "<div class='sfb-div'></div>";
    h += "<div class='sfb-count' id='sfbCount'>—</div>";
    h += "<button class='sfb-reset colf-clearall' id='colfClearAll' style='display:none' onclick='colFilterClearAll()' title='Rimuovi tutti i filtri colonna'>✕ Filtri colonna <span class='colf-n'>0</span></button>";
    h += "<button class='sfb-reset' onclick='schedResetFilters()' title='Rimuovi tutti i filtri'>↺ Cancella filtri</button>";
    h += "</div>";
    host.innerHTML = h;
    _fillNav();
    _restore();
    var _q = document.getElementById('q'); if (_q) _q.value = '';   // no visible search box → no stale hidden search
    _syncBadges();
    if (typeof window._colfSyncClearBtn === 'function') window._colfSyncClearBtn();
  };

  function _fillNav() {
    var mSel = document.getElementById('sfbMonth'), ySel = document.getElementById('sfbYear');
    var y = +YM.split('-')[0], m = +YM.split('-')[1];
    if (mSel) mSel.innerHTML = MONTHS.map(function (n, i) { return "<option value='" + (i + 1) + "'" + (i + 1 === m ? ' selected' : '') + '>' + n + '</option>'; }).join('');
    if (ySel) { var opt = ''; for (var yy = y - 2; yy <= y + 2; yy++) opt += "<option value='" + yy + "'" + (yy === y ? ' selected' : '') + '>' + yy + '</option>'; ySel.innerHTML = opt; }
    _fillWeeks();
  }
  function _fillWeeks() {
    var wSel = document.getElementById('sfbWeek'); if (!wSel) return;
    var weeks = (typeof monthWeeks === 'function') ? monthWeeks() : [];
    var cur = (typeof weekIdx !== 'undefined') ? weekIdx : 0;
    var opt = "<option value='month'>Tutte le settimane</option>";
    weeks.forEach(function (w, i) {
      opt += "<option value='" + i + "'" + (i === cur && (typeof planMode === 'undefined' || planMode !== 'month') ? ' selected' : '') + '>WK' + w.week + ' · ' + fmtDM(YM, w.days[0]) + '–' + fmtDM(YM, w.days[w.days.length - 1]) + '</option>';
    });
    wSel.innerHTML = opt;
    if (typeof planMode !== 'undefined' && planMode === 'month') wSel.value = 'month';
  }

  // Keep nav selects + employee count in sync with the board (called from a
  // renderGrid wrapper — cheap, never rebuilds the whole bar).
  window.schedSyncNav = function () {
    var mSel = document.getElementById('sfbMonth'), ySel = document.getElementById('sfbYear');
    if (!mSel || !ySel) return;
    var y = +YM.split('-')[0], m = +YM.split('-')[1];
    if (+mSel.value !== m) mSel.value = m;
    if (!ySel.querySelector('option[value="' + y + '"]')) _fillNav(); else ySel.value = y;
    _fillWeeks();
    _updateCount();
  };
  function _updateCount() {
    var el = document.getElementById('sfbCount'); if (!el) return;
    var n = 0; try { n = (typeof filteredDrivers === 'function') ? filteredDrivers().length : 0; } catch (e) {}
    var tot = 0; try { tot = (typeof scopedActive === 'function') ? scopedActive().length : 0; } catch (e) {}
    // "Showing X of Y employees" (n highlighted amber when a filter narrows it).
    el.innerHTML = 'Mostra <b' + (n < tot ? ' class="sfb-count-hl"' : '') + '>' + n + '</b> di ' + tot + ' dipendenti';
  }

  // ── multi-select popover ───────────────────────────────────────────
  var _openKey = null;
  // Anchor the (top-layer) dropdown under its filter chip; flip above if needed.
  function _placeMS(pop, anchor) {
    var r = anchor.getBoundingClientRect();
    var w = pop.offsetWidth || 230, h = pop.offsetHeight || 300;
    var vw = window.innerWidth, vh = window.innerHeight, gap = 4, pad = 6;
    var left = Math.max(pad, Math.min(r.left, vw - w - pad));
    var below = vh - r.bottom - pad, above = r.top - pad, top;
    if (h <= below) top = r.bottom + gap;
    else if (h <= above) top = r.top - h - gap;
    else top = (below >= above) ? r.bottom + gap : r.top - h - gap;
    top = Math.max(pad, Math.min(top, vh - h - pad));
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
  }
  window.schedToggleMS = function (ev, key) {
    ev.stopPropagation();
    if (_openKey === key) { _closePop(); return; }
    _closePop();
    _openKey = key;
    var wrap = document.querySelector('.sfb-ms[data-key="' + key + '"]'); if (!wrap) return;
    var sel = window._schedMS[key] || [];
    var opts = _opts(key);
    var pop = document.createElement('div'); pop.className = 'sfb-pop'; pop.id = 'sfbPop';
    var h = "<div class='sfb-pop-search'><input type='search' placeholder='Filtra…' oninput='schedPopFilter(this.value)' autocomplete='off'></div>";
    h += "<div class='sfb-pop-actions'><button onclick='schedMSall(\"" + key + "\",true)'>Tutti</button><button onclick='schedMSall(\"" + key + "\",false)'>Nessuno</button></div>";
    h += "<div class='sfb-pop-list'>";
    if (!opts.length) h += "<div class='sfb-pop-empty'>Nessuna opzione</div>";
    opts.forEach(function (o) {
      var on = sel.indexOf(o.v) >= 0;
      h += "<label class='sfb-opt' data-l='" + esc((o.l || '').toLowerCase()) + "'><input type='checkbox'" + (on ? ' checked' : '') + " onchange='schedMSpick(\"" + key + "\",\"" + esc(o.v).replace(/"/g, '&quot;') + "\",this.checked)'><span>" + esc(o.l) + "</span></label>";
    });
    h += "</div>";
    pop.innerHTML = h;
    // Render in the browser TOP LAYER (Popover API) / portaled to <body> so the
    // sticky date header (higher stacking context) can't cover the dropdown.
    // Inline fixed + max z-index + inset/margin reset are immune to stale CSS.
    pop.style.position = 'fixed';
    pop.style.zIndex = '2147483647';
    pop.style.margin = '0';
    pop.style.inset = 'auto';
    var _pv = (typeof pop.showPopover === 'function');
    if (_pv) pop.setAttribute('popover', 'manual');
    document.body.appendChild(pop);
    if (_pv) { try { pop.showPopover(); } catch (e) { pop.removeAttribute('popover'); } }
    _placeMS(pop, wrap);
    var inp = pop.querySelector('input'); if (inp) setTimeout(function () { inp.focus(); }, 0);
  };
  function _closePop() {
    var p = document.getElementById('sfbPop');
    if (p) { try { if (p.hidePopover && p.matches(':popover-open')) p.hidePopover(); } catch (e) {} p.remove(); }
    _openKey = null;
  }
  window.schedPopFilter = function (q) {
    q = (q || '').toLowerCase();
    document.querySelectorAll('#sfbPop .sfb-opt').forEach(function (o) { o.style.display = (!q || o.dataset.l.indexOf(q) >= 0) ? '' : 'none'; });
  };
  window.schedMSpick = function (key, v, on) {
    var a = window._schedMS[key] || (window._schedMS[key] = []);
    var i = a.indexOf(v);
    if (on && i < 0) a.push(v); else if (!on && i >= 0) a.splice(i, 1);
    _afterChange(key);
  };
  window.schedMSall = function (key, all) {
    window._schedMS[key] = all ? _opts(key).map(function (o) { return o.v; }) : [];
    // reflect in the open popover checkboxes
    document.querySelectorAll('#sfbPop .sfb-opt input').forEach(function (c) { c.checked = all; });
    _afterChange(key);
  };
  function _afterChange(key) {
    // Mirror single-value selections into the native <select> for the few
    // consumers that still read .value (refreshBottomBar, drill-in filters).
    var sel = document.getElementById(key), a = window._schedMS[key] || [];
    if (sel) sel.value = a.length === 1 ? a[0] : '';
    // Filiale is the master branch filter: keep the coverage view's _covFil in
    // sync so forecast/coverage scope to the same branch (scopeServices reads it).
    if (key === 'fFiliale') {
      window._covFil = a.length === 1 ? a[0] : '';
      var cf = document.getElementById('covFil'); if (cf) cf.value = window._covFil;
    }
    _syncBadge(key);
    _persist();
    if (typeof renderGrid === 'function') renderGrid();  // instant filtering
    _updateCount();
  }
  function _syncBadge(key) {
    var b = document.getElementById('badge_' + key); if (!b) return;
    var a = window._schedMS[key] || [], cat = CATS.find(function (c) { return c.key === key; });
    var wrap = document.querySelector('.sfb-ms[data-key="' + key + '"]');
    if (wrap) wrap.classList.toggle('active', a.length > 0);
    if (!a.length) { b.textContent = cat ? cat.all : 'Tutti'; return; }
    b.textContent = a.length === 1 ? _labelFor(key, a[0]) : (a.length + ' selez.');
  }
  function _syncBadges() { CATS.forEach(function (c) { _syncBadge(c.key); }); }

  // ── search (live, debounced) ───────────────────────────────────────
  var _searchTimer = null;
  window.schedSearchInput = function (v) {
    var q = document.getElementById('q'); if (q) q.value = v;   // reuse existing #q + filteredDrivers()
    var x = document.getElementById('sfbSearchX'); if (x) x.style.display = v ? '' : 'none';
    clearTimeout(_searchTimer);
    // Debounced (~220ms) so typing stays smooth with 1000+ drivers.
    _searchTimer = setTimeout(function () {
      _persist();
      if (typeof renderGrid === 'function') renderGrid();
      _updateCount();
      _scrollToSoleMatch();
    }, 220);
  };
  window.schedSearchClear = function () {
    var s = document.getElementById('sfbSearch'); if (s) s.value = '';
    schedSearchInput('');
    if (s) s.focus();
  };
  window.schedSearchKey = function (e) {
    if (e.key === 'Escape') { e.stopPropagation(); schedSearchClear(); }
  };
  // If exactly one driver matches, scroll its row into view.
  function _scrollToSoleMatch() {
    try {
      var v = (document.getElementById('q') || {}).value || '';
      if (!v.trim() || typeof filteredDrivers !== 'function') return;
      var f = filteredDrivers();
      if (f.length !== 1) return;
      var cell = document.querySelector('[id^="c_' + f[0].id + '_"]');
      var target = cell ? (cell.closest('.emp-board-row') || cell) : null;
      if (target && target.scrollIntoView) target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch (e) {}
  }
  // Highlight the search term(s) inside already-HTML-escaped text (used by the
  // board's driver name/sub). Exposed globally so board.js can call it.
  window._schedHL = function (escaped, q) {
    q = (q || '').trim();
    if (!q || !escaped) return escaped;
    var terms = q.split(/\s+/).filter(Boolean).map(function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
    if (!terms.length) return escaped;
    try { return escaped.replace(new RegExp('(' + terms.join('|') + ')', 'ig'), '<mark class="q-hl">$1</mark>'); }
    catch (e) { return escaped; }
  };

  // ── WK / Month / Year navigation ──────────────────────────────────
  window.schedSetWeek = function (v) {
    if (v === 'month') { if (typeof setPlanMode === 'function') setPlanMode('month'); return; }
    if (typeof planMode !== 'undefined' && planMode !== 'week' && typeof setPlanMode === 'function') setPlanMode('week');
    weekIdx = parseInt(v, 10) || 0;
    if (typeof renderGrid === 'function') renderGrid();
    _scrollTodayIfCurrent();
  };
  window.schedSetMonth = function (v) { _setYM(+YM.split('-')[0], parseInt(v, 10)); };
  window.schedSetYear = function (v) { _setYM(parseInt(v, 10), +YM.split('-')[1]); };
  function _setYM(y, m) {
    YM = y + '-' + String(m).padStart(2, '0');
    weekIdx = 0;
    if (typeof loadMonth === 'function') loadMonth();   // DB reload + refreshAll
    setTimeout(function () { _fillNav(); _updateCount(); }, 350);
  }

  // ── Reset ──────────────────────────────────────────────────────────
  window.schedResetFilters = function () {
    window._schedMS = {};
    CATS.forEach(function (c) { var s = document.getElementById(c.key); if (s && !s.disabled) s.value = ''; });
    var q = document.getElementById('q'); if (q) q.value = '';
    var qb = document.getElementById('qBar'); if (qb) qb.value = '';
    var sq = document.getElementById('sfbSearch'); if (sq) sq.value = '';
    var sx = document.getElementById('sfbSearchX'); if (sx) sx.style.display = 'none';
    window._covFil = '';   // clearing filters also clears the branch scope
    _syncBadges(); _persist();
    if (typeof colFilterClearAll === 'function') colFilterClearAll();   // also clear per-day column filters
    if (typeof schedExtClearAll === 'function') schedExtClearAll();      // + Employee / Week / SEM filters & sort
    if (typeof renderGrid === 'function') renderGrid();
    _updateCount();
  };

  // ── persistence ────────────────────────────────────────────────────
  function _persist() {
    try { localStorage.setItem(LS, JSON.stringify({ ms: window._schedMS, q: (document.getElementById('q') || {}).value || '' })); } catch (e) {}
  }
  function _restore() {
    var raw; try { raw = localStorage.getItem(LS); } catch (e) {}
    if (!raw) { _updateCount(); return; }
    try {
      var d = JSON.parse(raw);
      window._schedMS = d.ms || {};
      CATS.forEach(function (c) { var a = window._schedMS[c.key] || []; var s = document.getElementById(c.key); if (s) s.value = a.length === 1 ? a[0] : ''; });
      if (d.q != null) { var q = document.getElementById('q'), qb = document.getElementById('qBar'), sq = document.getElementById('sfbSearch'); if (q) q.value = d.q; if (qb) qb.value = d.q; if (sq) sq.value = d.q; var sx = document.getElementById('sfbSearchX'); if (sx) sx.style.display = d.q ? '' : 'none'; }
      // Re-apply the saved Filiale as the coverage branch too.
      var fa = window._schedMS.fFiliale || []; window._covFil = fa.length === 1 ? fa[0] : '';
    } catch (e) {}
    _updateCount();
  }

  // ── Default view = today (Part 2) ──────────────────────────────────
  window.schedDefaultToday = function () {
    var now = new Date(), ti = now.toISOString().slice(0, 7);
    if (YM !== ti) {                       // auto-switch month
      YM = ti; weekIdx = 0;
      if (typeof planMode !== 'undefined' && planMode === 'month' && typeof setPlanMode === 'function') { /* keep month if chosen */ }
      if (typeof loadMonth === 'function') loadMonth();
      setTimeout(_pickTodayWeek, 450);     // after DB reload + render
      return;
    }
    _pickTodayWeek();
  };
  function _pickTodayWeek() {
    var td = new Date().getDate(), weeks = (typeof monthWeeks === 'function') ? monthWeeks() : [];
    if (typeof planMode !== 'undefined' && planMode !== 'month') {
      for (var i = 0; i < weeks.length; i++) { if (weeks[i].days.indexOf(td) >= 0) { weekIdx = i; break; } }
    }
    window._schedScrollToToday = true;           // let this render jump to today
    if (typeof renderGrid === 'function') renderGrid();
    _fillNav(); _updateCount();
    _scrollTodayIfCurrent();
  }
  function _scrollTodayIfCurrent() {
    var now = new Date();
    if (now.toISOString().slice(0, 7) !== YM) { window._schedScrollToToday = false; return; }
    setTimeout(function () {
      var bo = document.getElementById('boardOuter');
      var t = bo && bo.querySelector('.today-h, .today-sc');
      if (t && t.scrollIntoView) { try { t.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); } catch (e) { t.scrollIntoView(); } }
      window._schedScrollToToday = false;         // resume scroll-preservation
    }, 80);
  }

  // ── wiring ─────────────────────────────────────────────────────────
  document.addEventListener('click', function (e) {
    if (_openKey && !e.target.closest('.sfb-ms') && !e.target.closest('#sfbPop')) _closePop();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') _closePop(); });

  // Rebuild badges/options after the board re-renders (options change with the
  // roster). Wrap renderGrid without disturbing the original.
  function _wrapRender() {
    if (window.__sfbWrapped || typeof window.renderGrid !== 'function') return;
    var orig = window.renderGrid;
    window.renderGrid = function () {
      // §4: remember the board scroll so filtering / month change / cell edits
      // don't jump the planner back to the top-left. "Go to today" opts out.
      // Horizontal scroll lives on #boardOuter; vertical on #sec-scheduler
      // (.page-scroll) — see the scheduler-scroll-layout note.
      var bo = document.getElementById('boardOuter');
      var sec = document.getElementById('sec-scheduler');
      var sl = bo ? bo.scrollLeft : 0, st = sec ? sec.scrollTop : 0;
      var r = orig.apply(this, arguments);
      try { if (document.getElementById('schedFilterBar') && !document.getElementById('sfbMonth')) window.schedBuildFilterBar(); } catch (e) {}
      try { window.schedSyncNav(); } catch (e) {}
      if (!window._schedScrollToToday) {
        if (bo && sl) bo.scrollLeft = sl;
        if (sec && st) sec.scrollTop = st;
      }
      return r;
    };
    window.__sfbWrapped = true;
  }

  function _boot() {
    if (!document.getElementById('schedFilterBar')) return;
    _wrapRender();
    window.schedBuildFilterBar();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(_boot, 0); });
  else setTimeout(_boot, 0);
})();
