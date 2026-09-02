/* TurniDSP — Excel-style per-day column AutoFilter for the Scheduler board.
 * ---------------------------------------------------------------------------
 * Every day column header carries a ▼ button; clicking it opens a popup anchored
 * under that column with a search box, "Select all", a checkbox list of the
 * unique values in that day, plus Apply / Clear. Each day keeps its own filter;
 * all active filters combine with AND logic (exactly like Excel AutoFilter) and
 * are applied by filteredDrivers() — so the existing (virtualized) render shows
 * only matching employees with no extra full re-render.
 *
 * Reusable pieces (vanilla-JS, no build step):
 *   FilterStateManager  → _f + colFilterMatch / colFilterActive / clear(All)
 *   ColumnFilterButton  → rendered by board.js (calls colFilterOpen)
 *   ColumnFilterPopup   → colFilterOpen builds it
 *   FilterCheckboxList  → the option rows + Select-all
 *   FilterSearch        → colFilterSearch
 * The system is generic: any column that renders a ▼ calling colFilterOpen(day)
 * with a value-provider gets filtering for free.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  var LS = 'turniDSP_colFilters';
  // FilterStateManager: day(number) → { set:{ code:1, … } }. Presence = active.
  var _f = {};
  (function load() { try { _f = JSON.parse(localStorage.getItem(LS)) || {}; } catch (e) { _f = {}; } })();
  function save() { try { localStorage.setItem(LS, JSON.stringify(_f)); } catch (e) {} }

  function cellVal(id, day) { return (typeof getCode === 'function' ? getCode(id, day) : '') || ''; }

  // ── public state API ────────────────────────────────────────────────
  window.colFilterActive = function (day) { return !!_f[day]; };
  window.colFilterCount = function () { return Object.keys(_f).length; };
  // AND across every active day filter (memo-friendly: pure over _f + schedule).
  window.colFilterMatch = function (id) {
    for (var day in _f) { if (!_f.hasOwnProperty(day)) continue; if (!_f[day].set[cellVal(id, +day)]) return false; }
    return true;
  };
  window.colFilterClear = function (day) { if (_f[day]) { delete _f[day]; save(); _rerender(); } _close(); };
  window.colFilterClearAll = function () { _f = {}; save(); _rerender(); _close(); };

  function _rerender() { if (typeof renderGrid === 'function') renderGrid(); _syncClearBtn(); }
  function _syncClearBtn() {
    var b = document.getElementById('colfClearAll'); if (!b) return;
    var n = window.colFilterCount();
    b.style.display = n ? 'inline-flex' : 'none';
    var c = b.querySelector('.colf-n'); if (c) c.textContent = n;
  }
  window._colfSyncClearBtn = _syncClearBtn;

  // Unique values in a day column, respecting the OTHER active filters
  // (categorical bar + other day columns) but NOT this column's own filter —
  // exactly like Excel. Computed on popup open only (not per render).
  function uniqueValues(day) {
    var saved = _f[day]; if (saved) delete _f[day];
    var drivers = (typeof filteredDrivers === 'function') ? filteredDrivers()
                : (typeof scopedActive === 'function' ? scopedActive() : []);
    if (saved) _f[day] = saved;
    var seen = {}, out = [];
    drivers.forEach(function (dr) { var v = cellVal(dr.id, day); if (!(v in seen)) { seen[v] = 1; out.push(v); } });
    out.sort(function (a, b) { if (a === '') return 1; if (b === '') return -1; return String(a).localeCompare(String(b)); });
    return out;
  }

  // ── ColumnFilterPopup + FilterCheckboxList + FilterSearch ───────────
  var _openDay = null;

  // The ▼ button for a given day (used to (re)anchor the popup).
  function _btnFor(day) { return document.querySelector('.col-day-h[data-day="' + day + '"] .colf-btn'); }

  // Position the popup from the button's live rect: below if it fits, else flip
  // ABOVE, else the roomier side; clamped fully inside the viewport on all edges.
  function _position(pop, btn) {
    var r = btn.getBoundingClientRect();
    var w = pop.offsetWidth || 236, h = pop.offsetHeight || 300;
    var vw = window.innerWidth, vh = window.innerHeight, gap = 3, pad = 6;
    var left = Math.max(pad, Math.min(r.left, vw - w - pad));
    var below = vh - r.bottom - pad, above = r.top - pad, top;
    if (h <= below) top = r.bottom + gap;
    else if (h <= above) top = r.top - h - gap;
    else top = (below >= above) ? r.bottom + gap : r.top - h - gap;
    top = Math.max(pad, Math.min(top, vh - h - pad));
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }
  window.colFilterOpen = function (ev, day) {
    ev.stopPropagation();
    var btn = ev.currentTarget || ev.target;
    if (_openDay === day) { _close(); return; }
    _close();
    _openDay = day;
    var vals = uniqueValues(day), f = _f[day];
    var lbl = String(day).padStart(2, '0') + '/' + YM.split('-')[1];
    var rows = vals.map(function (v) {
      var checked = !f || f.set[v];
      var disp = v === '' ? '(Vuoto)' : v;
      var lab = (v !== '' && typeof codeLabel === 'function') ? (codeLabel(v) || '') : '';
      return "<label class='colf-opt' data-v='" + esc((disp + ' ' + lab).toLowerCase()) + "'>" +
        "<input type='checkbox' value=\"" + esc(v) + "\"" + (checked ? ' checked' : '') + " data-act-change='call' data-call='colFilterRowChange'>" +
        "<span class='colf-code'>" + esc(disp) + "</span>" + (lab ? "<span class='colf-lbl'>" + esc(lab) + "</span>" : "") + "</label>";
    }).join('');
    var pop = document.createElement('div'); pop.className = 'colf-pop'; pop.id = 'colfPop';
    // Critical positioning set INLINE so a stale/cached stylesheet can never
    // lower it: fixed, above every app layer. inset/margin override the popover
    // UA centering so our left/top win.
    pop.style.position = 'fixed';
    pop.style.zIndex = '2147483647';
    pop.style.margin = '0';
    pop.style.inset = 'auto';
    pop.innerHTML =
      "<div class='colf-h'>Filtro colonna · <b>" + lbl + "</b></div>" +
      "<div class='colf-search'><span>🔍</span><input type='search' placeholder='Cerca valori…' data-act-input='call' data-call='colFilterSearch' data-args='[&quot;@value&quot;]' autocomplete='off'></div>" +
      "<label class='colf-all'><input type='checkbox' id='colfAll' data-act-change='call' data-call='colFilterToggleAll' data-args='[&quot;@checked&quot;]'><b>Seleziona tutto</b></label>" +
      "<div class='colf-list' id='colfList'>" + (rows || "<div class='colf-empty'>Nessun valore</div>") + "</div>" +
      "<div class='colf-foot'><button class='colf-clear' data-act-click='call' data-call='colFilterClear' data-args='[" + day + "]'>Cancella filtro</button>" +
      "<button class='colf-apply' data-act-click='call' data-call='colFilterApply'>Applica</button></div>";
    // Render in the browser TOP LAYER (Popover API) — above EVERY stacking
    // context, sticky header and overflow container, regardless of z-index. Falls
    // back to the z-index + <body> portal above when unsupported.
    var _pv = (typeof pop.showPopover === 'function');
    if (_pv) pop.setAttribute('popover', 'manual');
    document.body.appendChild(pop);
    if (_pv) { try { pop.showPopover(); } catch (e) { pop.removeAttribute('popover'); } }
    _position(pop, btn);              // anchored to the clicked ▼, flips above if needed
    _updateAllChk();
    var s = pop.querySelector('.colf-search input'); if (s) setTimeout(function () { s.focus(); }, 0);
  };

  window.colFilterSearch = function (q) {
    q = (q || '').toLowerCase();
    document.querySelectorAll('#colfList .colf-opt').forEach(function (o) {
      o.style.display = (!q || o.dataset.v.indexOf(q) >= 0) ? '' : 'none';
    });
    _updateAllChk();
  };
  window.colFilterToggleAll = function (on) {
    document.querySelectorAll('#colfList .colf-opt').forEach(function (o) {
      if (o.style.display !== 'none') o.querySelector('input').checked = on;
    });
  };
  window.colFilterRowChange = function () { _updateAllChk(); };
  function _updateAllChk() {
    var all = document.getElementById('colfAll'); if (!all) return;
    var vis = Array.prototype.filter.call(document.querySelectorAll('#colfList .colf-opt'), function (o) { return o.style.display !== 'none'; });
    var chk = vis.filter(function (o) { return o.querySelector('input').checked; });
    all.checked = vis.length > 0 && chk.length === vis.length;
    all.indeterminate = chk.length > 0 && chk.length < vis.length;
  }
  window.colFilterApply = function () {
    if (_openDay == null) return;
    var boxes = Array.prototype.slice.call(document.querySelectorAll('#colfList .colf-opt input'));
    var checked = boxes.filter(function (b) { return b.checked; });
    if (checked.length === boxes.length) { delete _f[_openDay]; }   // all selected = no filter
    else { var set = {}; checked.forEach(function (b) { set[b.value] = 1; }); _f[_openDay] = { set: set }; }
    save(); _rerender(); _close();
  };
  function _close() {
    var p = document.getElementById('colfPop');
    if (p) { try { if (p.hidePopover && p.matches(':popover-open')) p.hidePopover(); } catch (e) {} p.remove(); }
    _openDay = null;
  }
  window._colfClose = _close;

  // Closing never resets filters (spec §10). Outside click / Esc / scroll close.
  document.addEventListener('mousedown', function (e) {
    if (_openDay != null && !e.target.closest('#colfPop') && !e.target.closest('.colf-btn')) _close();
  }, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') _close(); });
  // Keep the popup aligned with its column while the board scrolls (spec).
  // Scrolling the popup's own list is ignored; if the column scrolls out of
  // view the popup closes (filters are untouched). rAF-throttled.
  var _rafScroll = 0;
  document.addEventListener('scroll', function (e) {
    if (_openDay == null) return;
    var t = e.target;
    if (t && t.closest && t.closest('#colfPop')) return;   // scrolling inside the list
    if (_rafScroll) return;
    _rafScroll = requestAnimationFrame(function () {
      _rafScroll = 0;
      var pop = document.getElementById('colfPop'); if (!pop) return;
      var btn = _btnFor(_openDay);
      var r = btn && btn.getBoundingClientRect();
      if (!btn || r.right < 0 || r.left > window.innerWidth || r.bottom < 0 || r.top > window.innerHeight) { _close(); return; }
      _position(pop, btn);
    });
  }, true);

  // Keep the toolbar "Clear all" button in sync once the shell is ready.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(_syncClearBtn, 0); });
  else setTimeout(_syncClearBtn, 0);
})();
