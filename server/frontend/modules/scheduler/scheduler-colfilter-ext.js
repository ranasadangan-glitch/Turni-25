/* TurniDSP — Excel filters, extended columns (Employee · Week/SETT. · SEM)
 * ---------------------------------------------------------------------------
 * The per-day AutoFilter lives in scheduler-colfilter.js. This module adds the
 * same Excel behaviour to three more columns, reusing the .colf-* popup styling
 * and the browser top-layer (Popover API) positioning:
 *
 *   • Employee column ("DAS / Servizio"): search (Name/Surname/ID/Badge/Phone),
 *     Sort A–Z / Z–A, Select-all, multi-select checkboxes, Clear, Apply.
 *   • Week headers (SETT. n): filter drivers by the shift codes they hold that
 *     week (union across the week's days).
 *   • SEM (weekly total) column: Sort by Worked days / Overtime / Absences /
 *     Conflicts (A–Z/Z–A) + quick metric filters (has overtime / conflicts /
 *     absences / above / under contract).
 *
 * All of these feed the SAME filteredDrivers() pipeline (AND logic, combines
 * with the day filters + categorical bar + search), so virtual scrolling and
 * "Showing X of Y" keep working unchanged. State persists in localStorage and
 * therefore survives Day/Week/Month switches. No API/DB change.
 *
 * Public (consumed by scheduler.js filteredDrivers + board.js render):
 *   empFilterMatch(id) · empFilterActive()
 *   weekFilterMatch(id) · weekFilterActive(wkStart)
 *   semFilterMatch(driver) · semFilterActive()
 *   schedApplySort(drivers, visDays)
 *   empFilterOpen(ev) · weekFilterOpen(ev, wkStart) · semFilterOpen(ev)
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  var LS_EMP = 'turniDSP_empFilter', LS_WK = 'turniDSP_wkFilter', LS_SEM = 'turniDSP_semFilter', LS_SORT = 'turniDSP_colSort';
  var _empSel = null;   // null = all; else { id: 1 }
  var _wk = {};         // wkStart(string) → { set: { code: 1 } }
  var _semF = {};       // { overtime, conflicts, absences, above, under } booleans
  try { _empSel = JSON.parse(localStorage.getItem(LS_EMP)) || null; } catch (e) {}
  try { _wk = JSON.parse(localStorage.getItem(LS_WK)) || {}; } catch (e) {}
  try { _semF = JSON.parse(localStorage.getItem(LS_SEM)) || {}; } catch (e) {}
  try { window._schedColSort = JSON.parse(localStorage.getItem(LS_SORT)) || null; } catch (e) {}
  function _save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function _rerender() { if (typeof renderGrid === 'function') renderGrid(); }

  function cellVal(id, day) { return (typeof getCode === 'function' ? getCode(id, day) : '') || ''; }
  // The visible day range for metric maths; board.js sets _schedVisDays before
  // calling filteredDrivers(), falling back to gridDays.
  function _vd() { return window._schedVisDays || (typeof gridDays !== 'undefined' ? gridDays : []) || []; }

  // ── metrics (day-based; the platform has no hours model, so "hours" = worked days) ──
  function _contractDays(dr, vd) {
    if (!dr.workDays || !dr.workDays.length) return 0;
    var n = 0;
    vd.forEach(function (d) { var g = new Date(YM + '-' + String(d).padStart(2, '0')).getDay(); if (dr.workDays.indexOf(g) >= 0 || (g === 0 && dr.workDays.indexOf(7) >= 0)) n++; });
    return n;
  }
  function _worked(dr, vd) { return (typeof workedDays === 'function') ? workedDays(dr, vd) : 0; }
  function _absences(dr, vd) { var n = 0; vd.forEach(function (d) { var c = cellVal(dr.id, d); if (c && typeof codeCls === 'function' && codeCls(c) === 'mal') n++; }); return n; }
  function _conflicts(dr, vd) { var f = (typeof consecutiveFlag === 'function') ? consecutiveFlag(dr) : {}; var n = 0; vd.forEach(function (d) { if (f[d]) n++; }); return n; }
  function _metric(dr, vd, key) {
    switch (key) {
      case 'worked': case 'hours': return _worked(dr, vd);
      case 'contract': return _contractDays(dr, vd);
      case 'overtime': case 'above': return Math.max(0, _worked(dr, vd) - _contractDays(dr, vd));
      case 'under': return Math.max(0, _contractDays(dr, vd) - _worked(dr, vd));
      case 'absences': return _absences(dr, vd);
      case 'conflicts': return _conflicts(dr, vd);
      default: return ((dr.cognome || '') + ' ' + (dr.nome || '')).toLowerCase();   // name
    }
  }

  // ── week helpers ────────────────────────────────────────────────────
  function _weekDays(wkStart, vd) { return vd.filter(function (d) { return String(sunWeek(YM, d).start) === String(wkStart); }); }

  // ── match functions (consumed by filteredDrivers) ───────────────────
  window.empFilterActive = function () { return !!_empSel; };
  window.empFilterMatch = function (id) { return !_empSel || !!_empSel[id]; };

  window.weekFilterActive = function (wkStart) { return !!_wk[String(wkStart)]; };
  window.weekFilterMatch = function (id) {
    var vd = _vd();
    for (var k in _wk) {
      if (!_wk.hasOwnProperty(k)) continue;
      var days = _weekDays(k, vd), set = _wk[k].set, ok = false;
      for (var i = 0; i < days.length; i++) { if (set[cellVal(id, days[i])]) { ok = true; break; } }
      if (!ok) return false;
    }
    return true;
  };

  window.semFilterActive = function () { return !!(_semF.overtime || _semF.conflicts || _semF.absences || _semF.above || _semF.under); };
  window.semFilterMatch = function (dr) {
    if (!window.semFilterActive()) return true;
    var vd = _vd();
    if (_semF.overtime && _metric(dr, vd, 'overtime') <= 0) return false;
    if (_semF.above && _metric(dr, vd, 'above') <= 0) return false;
    if (_semF.under && _metric(dr, vd, 'under') <= 0) return false;
    if (_semF.conflicts && _conflicts(dr, vd) <= 0) return false;
    if (_semF.absences && _absences(dr, vd) <= 0) return false;
    return true;
  };

  // ── sort (applied by board.js after filteredDrivers) ────────────────
  window.schedApplySort = function (drivers, visDays) {
    var s = window._schedColSort;
    if (!s || !s.key) return drivers;
    var vd = visDays || _vd();
    return drivers.slice().sort(function (a, b) {
      var x = _metric(a, vd, s.key), y = _metric(b, vd, s.key), c;
      c = (typeof x === 'string') ? x.localeCompare(y) : (x > y ? 1 : x < y ? -1 : 0);
      return c * (s.dir || 1);
    });
  };
  window.colSortActive = function () { return !!(window._schedColSort && window._schedColSort.key); };

  // ── shared popup shell (top-layer, reuses .colf-* styles) ───────────
  var _extKey = null;
  function _position(pop, btn) {
    var r = btn.getBoundingClientRect();
    var w = pop.offsetWidth || 240, h = pop.offsetHeight || 320;
    var vw = window.innerWidth, vh = window.innerHeight, gap = 3, pad = 6;
    var left = Math.max(pad, Math.min(r.left, vw - w - pad));
    var below = vh - r.bottom - pad, above = r.top - pad, top;
    if (h <= below) top = r.bottom + gap; else if (h <= above) top = r.top - h - gap; else top = (below >= above) ? r.bottom + gap : r.top - h - gap;
    top = Math.max(pad, Math.min(top, vh - h - pad));
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
  }
  function _close() {
    var p = document.getElementById('colfPopExt');
    if (p) { try { if (p.hidePopover && p.matches(':popover-open')) p.hidePopover(); } catch (e) {} p.remove(); }
    _extKey = null;
  }
  function _open(key, inner, btn) {
    if (typeof window._colfClose === 'function') window._colfClose();   // close any day popup
    if (_extKey === key) { _close(); return null; }
    _close();
    _extKey = key;
    var pop = document.createElement('div'); pop.className = 'colf-pop'; pop.id = 'colfPopExt';
    pop.style.position = 'fixed'; pop.style.zIndex = '2147483647'; pop.style.margin = '0'; pop.style.inset = 'auto';
    pop.innerHTML = inner;
    var pv = (typeof pop.showPopover === 'function');
    if (pv) pop.setAttribute('popover', 'manual');
    document.body.appendChild(pop);
    if (pv) { try { pop.showPopover(); } catch (e) { pop.removeAttribute('popover'); } }
    _position(pop, btn);
    return pop;
  }

  // shared checkbox-list behaviour (Employee + Week popups)
  window.colxSearch = function (q) {
    q = (q || '').toLowerCase();
    document.querySelectorAll('#colfPopExt .colx-opt').forEach(function (o) { o.style.display = (!q || o.dataset.v.indexOf(q) >= 0) ? '' : 'none'; });
    _colxUpdAll();
  };
  window.colxToggleAll = function (on) { document.querySelectorAll('#colfPopExt .colx-opt').forEach(function (o) { if (o.style.display !== 'none') o.querySelector('input').checked = on; }); };
  window.colxRowChange = function () { _colxUpdAll(); };
  function _colxUpdAll() {
    var all = document.getElementById('colxAll'); if (!all) return;
    var vis = Array.prototype.filter.call(document.querySelectorAll('#colfPopExt .colx-opt'), function (o) { return o.style.display !== 'none'; });
    var chk = vis.filter(function (o) { return o.querySelector('input').checked; });
    all.checked = vis.length > 0 && chk.length === vis.length;
    all.indeterminate = chk.length > 0 && chk.length < vis.length;
  }

  // ── EMPLOYEE column popup ────────────────────────────────────────────
  function _candidates(dropKey) {
    // Drivers matching all OTHER active filters (Excel behaviour), ignoring the
    // filter we're editing so its own options don't disappear.
    var savedEmp = _empSel, savedWk = null;
    if (dropKey === 'emp') _empSel = null;
    var list = (typeof filteredDrivers === 'function') ? filteredDrivers() : (typeof scopedActive === 'function' ? scopedActive() : []);
    _empSel = savedEmp;
    return list;
  }
  window.empFilterOpen = function (ev) {
    ev.stopPropagation();
    var btn = ev.currentTarget || ev.target;
    var drivers = _candidates('emp').slice().sort(function (a, b) { return (a.cognome || '').localeCompare(b.cognome || ''); });
    var rows = drivers.map(function (dr) {
      var checked = !_empSel || _empSel[dr.id];
      var hay = [dr.cognome, dr.nome, dr.id, dr.transporterId, dr.badge, dr.matricola, dr.phone, dr.telefono].filter(Boolean).join(' ').toLowerCase();
      var sub = [dr.transporterId ? '#' + dr.transporterId : '', dr.filiale].filter(Boolean).join(' · ');
      return "<label class='colf-opt colx-opt' data-v='" + esc(hay) + "'>" +
        "<input type='checkbox' value='" + esc(String(dr.id)) + "'" + (checked ? ' checked' : '') + actAttr('change', 'colxRowChange') + ">" +
        "<span class='colf-code'>" + esc((dr.cognome || '') + ' ' + (dr.nome || '')) + "</span>" +
        (sub ? "<span class='colf-lbl'>" + esc(sub) + "</span>" : '') + "</label>";
    }).join('');
    var s = window._schedColSort || {};
    var sd = (s.key === 'name' || !s.key);
    var inner =
      "<div class='colf-h'>Dipendenti · <b>Tutti</b></div>" +
      "<div class='colx-sortrow'>" +
        "<button class='colx-sort" + (sd && s.dir !== -1 && s.key === 'name' ? ' on' : '') + "'" + actAttr('click', 'schedColSort', ['name', 1]) + ">↑ A–Z</button>" +
        "<button class='colx-sort" + (s.key === 'name' && s.dir === -1 ? ' on' : '') + "'" + actAttr('click', 'schedColSort', ['name', -1]) + ">↓ Z–A</button>" +
      "</div>" +
      "<div class='colf-search'><span>🔍</span><input type='search' placeholder='Nome, cognome, ID, badge, telefono…'" + actAttr('input', 'colxSearch', ['@value']) + " autocomplete='off'></div>" +
      "<label class='colf-all'><input type='checkbox' id='colxAll'" + actAttr('change', 'colxToggleAll', ['@checked']) + "><b>Seleziona tutto</b></label>" +
      "<div class='colf-list' id='colxList'>" + (rows || "<div class='colf-empty'>Nessun dipendente</div>") + "</div>" +
      "<div class='colf-foot'><button class='colf-clear'" + actAttr('click', 'empFilterClear') + ">Cancella filtro</button>" +
      "<button class='colf-apply'" + actAttr('click', 'empFilterApply') + ">Applica</button></div>";
    var pop = _open('emp', inner, btn);
    if (pop) { _colxUpdAll(); var si = pop.querySelector('.colf-search input'); if (si) setTimeout(function () { si.focus(); }, 0); }
  };
  window.empFilterApply = function () {
    var boxes = Array.prototype.slice.call(document.querySelectorAll('#colfPopExt .colx-opt input'));
    var checked = boxes.filter(function (b) { return b.checked; });
    if (checked.length === boxes.length) _empSel = null;
    else { _empSel = {}; checked.forEach(function (b) { _empSel[b.value] = 1; }); }
    _save(LS_EMP, _empSel); _rerender(); _close();
  };
  window.empFilterClear = function () { _empSel = null; _save(LS_EMP, _empSel); _rerender(); _close(); };
  window.schedColSort = function (key, dir) { window._schedColSort = { key: key, dir: dir }; _save(LS_SORT, window._schedColSort); _rerender(); };

  // ── WEEK (SETT.) popup ───────────────────────────────────────────────
  window.weekFilterOpen = function (ev, wkStart) {
    ev.stopPropagation();
    var btn = ev.currentTarget || ev.target;
    wkStart = String(wkStart);
    var vd = _vd(), days = _weekDays(wkStart, vd);
    var saved = _wk[wkStart]; if (saved) delete _wk[wkStart];
    var drivers = (typeof filteredDrivers === 'function') ? filteredDrivers() : [];
    if (saved) _wk[wkStart] = saved;
    var seen = {}, vals = [];
    drivers.forEach(function (dr) { days.forEach(function (d) { var v = cellVal(dr.id, d); if (!(v in seen)) { seen[v] = 1; vals.push(v); } }); });
    vals.sort(function (a, b) { if (a === '') return 1; if (b === '') return -1; return String(a).localeCompare(String(b)); });
    var f = _wk[wkStart];
    var rows = vals.map(function (v) {
      var checked = !f || f.set[v];
      var disp = v === '' ? '(Vuoto)' : v;
      var lab = (v !== '' && typeof codeLabel === 'function') ? (codeLabel(v) || '') : '';
      return "<label class='colf-opt colx-opt' data-v='" + esc((disp + ' ' + lab).toLowerCase()) + "'>" +
        "<input type='checkbox' value=\"" + esc(v) + "\"" + (checked ? ' checked' : '') + actAttr('change', 'colxRowChange') + ">" +
        "<span class='colf-code'>" + esc(disp) + "</span>" + (lab ? "<span class='colf-lbl'>" + esc(lab) + "</span>" : '') + "</label>";
    }).join('');
    var lbl = (days.length ? String(days[0]).padStart(2, '0') + '–' + String(days[days.length - 1]).padStart(2, '0') : '');
    var inner =
      "<div class='colf-h'>Settimana · <b>" + esc(lbl) + "</b></div>" +
      "<div class='colf-search'><span>🔍</span><input type='search' placeholder='Cerca codici…'" + actAttr('input', 'colxSearch', ['@value']) + " autocomplete='off'></div>" +
      "<label class='colf-all'><input type='checkbox' id='colxAll'" + actAttr('change', 'colxToggleAll', ['@checked']) + "><b>Seleziona tutto</b></label>" +
      "<div class='colf-list' id='colxList'>" + (rows || "<div class='colf-empty'>Nessun valore</div>") + "</div>" +
      "<div class='colf-foot'><button class='colf-clear'" + actAttr('click', 'weekFilterClear', [wkStart]) + ">Cancella filtro</button>" +
      "<button class='colf-apply'" + actAttr('click', 'weekFilterApply', [wkStart]) + ">Applica</button></div>";
    var pop = _open('wk:' + wkStart, inner, btn);
    if (pop) { _colxUpdAll(); var si = pop.querySelector('.colf-search input'); if (si) setTimeout(function () { si.focus(); }, 0); }
  };
  window.weekFilterApply = function (wkStart) {
    wkStart = String(wkStart);
    var boxes = Array.prototype.slice.call(document.querySelectorAll('#colfPopExt .colx-opt input'));
    var checked = boxes.filter(function (b) { return b.checked; });
    if (checked.length === boxes.length) delete _wk[wkStart];
    else { var set = {}; checked.forEach(function (b) { set[b.value] = 1; }); _wk[wkStart] = { set: set }; }
    _save(LS_WK, _wk); _rerender(); _close();
  };
  window.weekFilterClear = function (wkStart) { delete _wk[String(wkStart)]; _save(LS_WK, _wk); _rerender(); _close(); };

  // ── SEM (weekly total) popup — sort + metric quick filters ──────────
  window.semFilterOpen = function (ev) {
    ev.stopPropagation();
    var btn = ev.currentTarget || ev.target;
    var s = window._schedColSort || {};
    function sortBtn(key, label) {
      return "<div class='colx-sortline'><span>" + label + "</span>" +
        "<button class='colx-sort" + (s.key === key && s.dir !== -1 ? ' on' : '') + "' title='Crescente'" + actAttr('click', 'schedColSort', [key, 1]) + ">↑</button>" +
        "<button class='colx-sort" + (s.key === key && s.dir === -1 ? ' on' : '') + "' title='Decrescente'" + actAttr('click', 'schedColSort', [key, -1]) + ">↓</button></div>";
    }
    function chk(k, label) { return "<label class='colf-opt'><input type='checkbox'" + (_semF[k] ? ' checked' : '') + actAttr('change', 'semToggle', [k, '@checked']) + "><span class='colf-code'>" + label + "</span></label>"; }
    var inner =
      "<div class='colf-h'>SEM · <b>Ordina / filtra</b></div>" +
      "<div class='colx-grp'>Ordina per</div>" +
      sortBtn('worked', 'Giorni lavorati') + sortBtn('overtime', 'Straordinari') +
      sortBtn('absences', 'Assenze') + sortBtn('conflicts', 'Conflitti') +
      "<div class='colx-grp'>Mostra solo</div>" +
      "<div class='colf-list' style='max-height:none'>" +
        chk('overtime', 'Con straordinari') + chk('above', 'Sopra contratto') + chk('under', 'Sotto contratto') +
        chk('absences', 'Con assenze') + chk('conflicts', 'Con conflitti') +
      "</div>" +
      "<div class='colf-foot'><button class='colf-clear'" + actAttr('click', 'semFilterClear') + ">Azzera</button>" +
      "<button class='colf-apply'" + actAttr('click', '_colfExtClose') + ">Chiudi</button></div>";
    _open('sem', inner, btn);
  };
  window.semToggle = function (k, on) { if (on) _semF[k] = 1; else delete _semF[k]; _save(LS_SEM, _semF); _rerender(); };
  window.semFilterClear = function () { _semF = {}; window._schedColSort = null; _save(LS_SEM, _semF); _save(LS_SORT, null); _rerender(); _close(); };
  window._colfExtClose = _close;
  // Clear every extended filter + sort (called by the global "Cancella filtri").
  window.schedExtClearAll = function () {
    _empSel = null; _wk = {}; _semF = {}; window._schedColSort = null;
    _save(LS_EMP, null); _save(LS_WK, {}); _save(LS_SEM, {}); _save(LS_SORT, null);
  };

  // ── close on outside click / Esc (day ▼ clicks close this too) ──────
  document.addEventListener('mousedown', function (e) {
    if (_extKey != null && !e.target.closest('#colfPopExt') && !e.target.closest('.colx-btn')) _close();
  }, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') _close(); });
})();
