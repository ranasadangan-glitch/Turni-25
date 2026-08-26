/* TurniDSP — Scheduler Workspace enhancements
 * ---------------------------------------------------------------------------
 * Turns the planning board into a faster planning workspace without redesigning
 * it. Three things live here:
 *   1) Compact one-click assignment popover (replaces the oversized inline
 *      datalist editor that opened on single-click).            [spec §5]
 *   2) Paint / quick-assign mode — pick a brush code, click cells.[spec §6]
 *   3) Forecast & coverage drawer that opens inside the Scheduler.[spec §3]
 * Everything reuses the existing shift vocabulary (groupedCodes / getCLS /
 * commitCell / forecastOf / harmonyOf) so nothing new is added to the model.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  // ── Single source of truth (spec §14) ─────────────────────────────
  // The scheduler no longer keeps its own driver records — the Employees
  // module (one employees table) is authoritative. Adding/editing a DAS from
  // the scheduler routes to the Employees form; the board reads employees via
  // /api/scheduler/month. After an employee is saved/removed, the scheduler
  // refetches so changes appear without a manual page refresh.
  window.openDriver = function (id) {
    if (id != null && typeof editEmployee === 'function') { editEmployee(id); return; }
    if (typeof openNewEmployee === 'function') { openNewEmployee(); return; }
  };

  // ── Scheduler zoom (spec §8) ───────────────────────────────────────
  // CSS `zoom` on #boardInner scales cells, fonts, row height and column
  // width together while keeping the sticky headers/columns aligned. The
  // level persists and survives re-renders (set on the element, not its
  // innerHTML). 80 / 90 / 100 / 110 %.
  var ZOOMS = [0.8, 0.9, 1, 1.1];
  function _zoom() { var z = parseFloat(localStorage.getItem('turniDSP_zoom')); return ZOOMS.indexOf(z) >= 0 ? z : 1; }
  function _applyZoom(z) {
    var bi = document.getElementById('boardInner'); if (bi) bi.style.zoom = z;
    var lbl = document.getElementById('zoomLbl'); if (lbl) lbl.textContent = Math.round(z * 100) + '%';
    try { localStorage.setItem('turniDSP_zoom', z); } catch (e) {}
    // Re-window the virtualized rows for the new zoom (no-op when not virtualizing).
    if (typeof window._schedRewindow === 'function') window._schedRewindow();
  }
  window.setZoom = function (z) { z = parseFloat(z) || 1; _applyZoom(z); };
  window.stepZoom = function (dir) {
    var i = ZOOMS.indexOf(_zoom()); if (i < 0) i = 2;
    i = Math.max(0, Math.min(ZOOMS.length - 1, i + dir));
    _applyZoom(ZOOMS[i]);
  };
  window._reapplyZoom = function () { var z = _zoom(); _applyZoom(z); };
  // Apply the saved zoom once the shell is ready (boardInner is static markup,
  // so the inline zoom then persists across innerHTML re-renders).
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', window._reapplyZoom);
  else setTimeout(window._reapplyZoom, 0);

  // ── Operations Control Center — live KPI strip ─────────────────────
  // Computed from the in-memory state for the reference day; recalculated on
  // every board render/mutation (called from refreshBottomBar).
  window.renderOpsKPI = function () {
    var el = document.getElementById('opsKpi'); if (!el) return;
    if (typeof state === 'undefined' || !state) { el.innerHTML = ''; return; }
    var active = (typeof scopedActive === 'function') ? scopedActive() : [];
    var refDay = (typeof gridRefDay !== 'undefined') ? gridRefDay : 1;
    var scheduled = 0, onLeave = 0, off = 0;
    active.forEach(function (dr) {
      var c = getCode(dr.id, refDay); if (!c) return;
      var cls = codeCls(c);
      if (c.toUpperCase() === 'OFF') off++;
      else if (cls === 'mal' || cls === 'abs') onLeave++;
      else scheduled++;
    });
    var forecast = 0;
    try { (scopeServices() || []).filter(function (s) { return !s.minOf; }).forEach(function (s) { forecast += forecastOf(s, refDay); }); } catch (e) {}
    var available = Math.max(0, active.length - scheduled - onLeave);
    var missing = Math.max(0, forecast - scheduled);
    var coverage = forecast > 0 ? Math.round(scheduled / forecast * 100) : (scheduled ? 100 : 0);
    // Expiring contracts within 30 days (operational alert metric).
    var expSoon = 0, today = new Date();
    active.forEach(function (dr) {
      if (!dr.expiry) return;
      var days = Math.round((new Date(dr.expiry + 'T00:00:00') - today) / 86400000);
      if (days >= 0 && days <= 30) expSoon++;
    });
    function card(v, label, cls, title) {
      return "<div class='opsk " + (cls || '') + "'" + (title ? " title='" + esc(title) + "'" : "") +
        "><div class='opsk-v'>" + v + "</div><div class='opsk-l'>" + label + "</div></div>";
    }
    var covCls = coverage >= 100 ? 'ok' : coverage >= 80 ? 'warn' : 'bad';
    el.innerHTML =
      card(forecast || '—', 'Forecast', '') +
      card(scheduled, 'Pianificati', 'ok') +
      card(available, 'Disponibili', '') +
      card(missing, 'Mancanti', missing > 0 ? 'bad' : 'ok') +
      card(coverage + '%', 'Copertura', covCls) +
      card(onLeave, 'In assenza', onLeave > 0 ? 'warn' : '') +
      card(expSoon, 'Contratti in scad.', expSoon > 0 ? 'warn' : '') +
      card('n/d', 'Costo lavoro', 'muted', 'Nessun modello ore/costi configurato');
  };

  // ── Paint / quick-assign mode ──────────────────────────────────────
  var _brush = null;

  window.setBrush = function (code) {
    _brush = code;
    _updateBrushChip();
    if (code !== null) toast('🖌 Pennello: ' + (code || 'Vuoto') + ' — clicca le celle · ESC per uscire');
  };
  window.clearBrush = function () { _brush = null; _updateBrushChip(); };

  function _updateBrushChip() {
    var el = document.getElementById('brushChip');
    if (!el) return;
    if (_brush !== null) {
      el.style.display = 'inline-flex';
      el.querySelector('.bc-code').textContent = _brush === '' ? 'Vuoto' : _brush;
    } else {
      el.style.display = 'none';
    }
    // Board gets a "painting" class so the cursor signals the mode.
    var bo = document.getElementById('boardOuter');
    if (bo) bo.classList.toggle('is-painting', _brush !== null);
  }

  // Single-click dispatcher used by every board cell. In paint mode it stamps
  // the brush code; otherwise it opens the compact popover.
  window.cellClick = function (ev, id, d) {
    // Shift+click extends a rectangular selection from the anchor (spreadsheet
    // style). Works in any mode; it neither paints nor opens the popover (#3).
    if (ev && ev.shiftKey) { if (ev.preventDefault) ev.preventDefault(); _selectRangeTo(id, d); return; }
    // A plain click sets the selection anchor and drops any prior range.
    _setAnchor(id, d);
    if (_brush !== null) {
      if (typeof pushUndo === 'function') pushUndo(JSON.parse(JSON.stringify(state.schedule)));
      commitCell(id, d, _brush);
      _paintCellDom(id, d);
      return;
    }
    cellPop(ev, id, d);
  };

  // Bulk-entry optimization (#3): the global footer recompute (refreshBottomBar
  // — all drivers × services × days, plus the forecast/ops footers) is the
  // paint-path bottleneck. Coalesce it to ONE run per animation frame so a burst
  // of stamps pays it once instead of per cell, and the cell chip repaints
  // without waiting behind it. Always trailing, so the footer stays correct.
  var _barPending = false;
  var _raf = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
  function _bottomBarSoon() {
    if (_barPending) return;
    _barPending = true;
    _raf(function () {
      _barPending = false;
      if (typeof refreshBottomBar === 'function') { try { refreshBottomBar(); } catch (e) {} }
      if (typeof refreshCovStrip === 'function') { try { refreshCovStrip(); } catch (e) {} }   // keep the header coverage strip (#1) in sync under bulk paint
    });
  }

  // Repaint just one cell's chip so paint mode stays snappy (no full re-render).
  function _paintCellDom(id, d) {
    var td = document.getElementById('c_' + id + '_' + d);
    if (!td) { if (typeof renderGrid === 'function') renderGrid(); return; }
    var code = getCode(id, d), cls = codeCls(code), cst = getCLS(cls);
    td.innerHTML = code
      ? '<div class="shift-card" draggable="true" ondragstart="boardDragStart(event,' + id + ',' + d + ')" ondragend="boardDragEnd()" style="background:' + cst.bg + ';color:' + cst.fg + ';border-color:' + cst.br + '" title="' + esc(codeLabel(code)) + '">' + esc(code) + '</div>'
      : '';
    // Live recalculation (spec §15/§19): the SEM total for this row and the
    // footer KPIs must update on every single-cell change without a re-render.
    if (typeof updateRowTotal === 'function') { try { updateRowTotal(id); } catch (e) {} }
    _bottomBarSoon();   // coalesced global footer recompute (bulk-entry #3)
    if (typeof markCellWarn === 'function') { try { markCellWarn(id, d); } catch (e) {} }   // keep inline rule warnings live under paint
    if (typeof markCellEdit === 'function') { try { markCellEdit(id, d); } catch (e) {} }   // keep per-cell edit/unsaved marker live under paint (#5)
  }

  // ── Range select + bulk fill / clear / repeat-week (#3) ────────────
  // Rectangular selection over the grid (drivers × visible days). All bulk
  // actions go through the existing commitCell + _paintCellDom write path, so
  // contract/absence coercions and the coalesced footer recompute still apply —
  // no new model, no DB/engine change.
  var _selAnchor = null;   // {id,d} last plain-clicked cell (rectangle corner)
  var _selCells = [];      // current rectangular selection [{id,d}, …]

  function _gridOrder() {
    var ids = (typeof gridDrivers !== 'undefined' ? gridDrivers : []).map(function (x) { return x.id; });
    var days = (typeof gridDays !== 'undefined' ? gridDays : []).slice();
    return { ids: ids, days: days };
  }
  function _setAnchor(id, d) { _selAnchor = { id: id, d: d }; _clearRange(); }
  function _clearRange() {
    _selCells.forEach(function (c) {
      var td = document.getElementById('c_' + c.id + '_' + c.d);
      if (td) td.classList.remove('sel-range');
    });
    _selCells = [];
    _updateRangeChip();
  }
  function _selectRangeTo(id, d) {
    var g = _gridOrder();
    if (!_selAnchor) _selAnchor = { id: id, d: d };
    var r0 = g.ids.indexOf(_selAnchor.id), r1 = g.ids.indexOf(id);
    var c0 = g.days.indexOf(_selAnchor.d), c1 = g.days.indexOf(d);
    if (r0 < 0 || r1 < 0 || c0 < 0 || c1 < 0) { _selAnchor = { id: id, d: d }; return; }
    if (r0 > r1) { var t = r0; r0 = r1; r1 = t; }
    if (c0 > c1) { var u = c0; c0 = c1; c1 = u; }
    _clearRange();
    for (var r = r0; r <= r1; r++) for (var c = c0; c <= c1; c++) {
      var cid = g.ids[r], cd = g.days[c];
      _selCells.push({ id: cid, d: cd });
      var td = document.getElementById('c_' + cid + '_' + cd);
      if (td) td.classList.add('sel-range');
    }
    _updateRangeChip();
  }
  // Selection cells that are still valid on the current render (guards against a
  // stale selection after a week/filter change re-rendered the board).
  function _liveSel() {
    var g = _gridOrder();
    return _selCells.filter(function (c) {
      return g.ids.indexOf(c.id) >= 0 && g.days.indexOf(c.d) >= 0 && document.getElementById('c_' + c.id + '_' + c.d);
    });
  }
  function _updateRangeChip() {
    var rt = document.getElementById('rangeTools');
    if (!rt) return;
    if (_selCells.length > 1) {
      rt.style.display = 'inline-flex';
      var c = rt.querySelector('.rt-count'); if (c) c.textContent = _selCells.length + ' celle';
    } else rt.style.display = 'none';
  }

  window.schedFillRange = function () {
    var sel = _liveSel();
    if (sel.length < 1) { toast('Seleziona un intervallo (Shift+clic su due celle)'); return; }
    if (_brush === null) { toast('Scegli prima un pennello (clic destro su un codice)'); return; }
    if (typeof pushUndo === 'function') pushUndo(JSON.parse(JSON.stringify(state.schedule)));
    sel.forEach(function (c) { commitCell(c.id, c.d, _brush); _paintCellDom(c.id, c.d); });
    toast('Riempite ' + sel.length + ' celle con ' + (_brush || 'Vuoto'));
  };
  window.schedClearRange = function () {
    var sel = _liveSel();
    if (sel.length < 1) { toast('Seleziona un intervallo (Shift+clic su due celle)'); return; }
    if (typeof pushUndo === 'function') pushUndo(JSON.parse(JSON.stringify(state.schedule)));
    sel.forEach(function (c) { commitCell(c.id, c.d, ''); _paintCellDom(c.id, c.d); });
    toast('Svuotate ' + sel.length + ' celle');
  };
  window.schedClearSelection = function () { _clearRange(); _selAnchor = null; };

  // Repeat previous week: copy each visible driver's previous-week codes onto the
  // current week, matched by weekday. Week view only. Reuses commitCell so all
  // contract/absence coercions still apply — no engine/DB change.
  window.schedRepeatPrevWeek = function () {
    if (typeof planMode !== 'undefined' && planMode !== 'week') { toast('Disponibile solo in vista Settimana'); return; }
    var weeks = (typeof monthWeeks === 'function') ? monthWeeks() : [];
    if (!(weekIdx > 0) || !weeks[weekIdx] || !weeks[weekIdx - 1]) { toast('Nessuna settimana precedente da copiare'); return; }
    var cur = weeks[weekIdx].days, prev = weeks[weekIdx - 1].days;
    var byDow = {};
    prev.forEach(function (pd) { byDow[dow(YM, pd)] = pd; });
    var drivers = (typeof gridDrivers !== 'undefined' && gridDrivers.length) ? gridDrivers : scopedActive();
    if (typeof pushUndo === 'function') pushUndo(JSON.parse(JSON.stringify(state.schedule)));
    drivers.forEach(function (dr) {
      cur.forEach(function (cd) {
        var pd = byDow[dow(YM, cd)];
        if (pd == null) return;
        commitCell(dr.id, cd, getCode(dr.id, pd) || '');
        _paintCellDom(dr.id, cd);
      });
    });
    toast('Settimana precedente copiata su ' + drivers.length + ' DAS');
  };

  // ── Compact assignment popover ─────────────────────────────────────
  window.cellPop = function (ev, id, d) {
    closeCellPop();
    var dr = state.drivers.find(function (x) { return x.id === id; });
    if (!dr) return;
    var cur = getCode(id, d);
    var pop = document.createElement('div');
    pop.className = 'cellpop';
    pop.id = 'cellPop';
    var h = '<div class="cellpop-head"><b>' + esc(dr.cognome) + ' ' + esc(dr.nome) + '</b><span>' + dowName(YM, d) + ' ' + fmtDM(YM, d) + '</span></div>';
    h += '<div class="cellpop-grid">';
    groupedCodes().forEach(function (g) {
      var st = getCLS(g.cls);
      g.codes.forEach(function (c) {
        h += '<button class="cellpop-code' + (c === cur ? ' sel' : '') + '"' +
          ' style="background:' + st.bg + ';color:' + st.fg + ';border-color:' + st.br + '"' +
          ' title="' + esc(codeLabel(c)) + ' — click destro: usa come pennello"' +
          ' onclick="cellPopPick(' + id + ',' + d + ',\'' + c + '\')"' +
          ' oncontextmenu="cellPopBrush(event,\'' + c + '\')">' + esc(c) + '</button>';
      });
    });
    h += '</div>';
    h += '<div class="cellpop-foot">' +
      '<button class="cp-clear" onclick="cellPopPick(' + id + ',' + d + ',\'\')">✕ Vuoto</button>' +
      '<button onclick="closeCellPop();spOpenPanel(' + id + ',' + d + ')">Dettagli…</button>' +
      (cur ? '<button onclick="cellPopBrush(event,\'' + cur + '\')">🖌 Pennello</button>' : '') +
      '</div>';
    pop.innerHTML = h;
    document.body.appendChild(pop);
    // Position near the click, clamped to the viewport.
    var pw = pop.offsetWidth, ph = pop.offsetHeight;
    var x = (ev && ev.clientX) || 200, y = (ev && ev.clientY) || 200;
    pop.style.left = Math.max(6, Math.min(x, window.innerWidth - pw - 8)) + 'px';
    pop.style.top = Math.max(6, Math.min(y + 4, window.innerHeight - ph - 8)) + 'px';
  };

  window.cellPopPick = function (id, d, code) {
    if (typeof pushUndo === 'function') pushUndo(JSON.parse(JSON.stringify(state.schedule)));
    commitCell(id, d, code);
    closeCellPop();
    _paintCellDom(id, d);
    if (typeof refreshBottomBar === 'function') { try { refreshBottomBar(); } catch (e) {} }
    if (document.getElementById('fcDrawer') && document.getElementById('fcDrawer').classList.contains('open')) renderForecastPanel();
  };

  // Right-click a code (in cell or popover) → make it the paint brush.
  window.cellPopBrush = function (ev, code) {
    if (ev) ev.preventDefault();
    closeCellPop();
    setBrush(code);
    return false;
  };

  window.closeCellPop = function () {
    var p = document.getElementById('cellPop');
    if (p) p.remove();
  };

  // Dismiss the popover on outside click / scroll.
  document.addEventListener('mousedown', function (e) {
    var p = document.getElementById('cellPop');
    if (p && !p.contains(e.target) && !(e.target.closest && e.target.closest('.shift-cell'))) closeCellPop();
  }, true);

  // ESC exits paint mode and closes the popover.
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (document.getElementById('cellPop')) { closeCellPop(); return; }
      if (_selCells.length) { _clearRange(); _selAnchor = null; return; }
      if (_brush !== null) { clearBrush(); toast('Pennello disattivato'); }
    }
  });

  // ── Forecast & coverage drawer (opens inside the Scheduler) ────────
  function _ensureDrawer() {
    if (document.getElementById('fcDrawer')) return;
    var d = document.createElement('div');
    d.id = 'fcDrawer';
    d.className = 'fc-drawer';
    d.innerHTML =
      '<div class="fc-head"><b>📊 Forecast &amp; Copertura</b><button class="fc-x" onclick="toggleForecastPanel()" title="Chiudi">✕</button></div>' +
      '<div class="fc-body" id="fcBody"></div>';
    document.body.appendChild(d);
  }

  window.toggleForecastPanel = function () {
    _ensureDrawer();
    var el = document.getElementById('fcDrawer');
    var open = el.classList.toggle('open');
    var btn = document.getElementById('fcToggleBtn');
    if (btn) btn.classList.toggle('active', open);
    if (open) renderForecastPanel();
  };

  function _range() {
    // Weekly = the days currently visible on the board; Monthly = whole month.
    var week = (typeof gridDays !== 'undefined' && gridDays.length) ? gridDays.slice() : [];
    var month = [];
    for (var i = 1; i <= daysInMonth(YM); i++) month.push(i);
    return { week: week, month: month };
  }

  window.renderForecastPanel = function () {
    _ensureDrawer();
    var body = document.getElementById('fcBody');
    if (!body) return;
    if (!state) { body.innerHTML = '<p class="text-muted">Nessun dato.</p>'; return; }
    var r = _range();
    var days = r.week.length ? r.week : r.month;
    var drivers = scopedActive();
    var svs = (typeof scopeServices === 'function' ? scopeServices() : services()).filter(function (s) { return !s.minOf; });

    var needed = 0, assigned = 0;
    var rows = svs.map(function (s) {
      var n = 0, a = 0, over = 0;
      days.forEach(function (d) {
        var f = forecastOf(s, d), harm = harmonyOf(s, d, drivers);
        n += f; a += Math.min(f, harm); if (harm > f) over += (harm - f);
      });
      needed += n; assigned += a;
      return { name: s.name || s.key, n: n, a: a, over: over, cov: n ? Math.round(a / n * 100) : 100, miss: Math.max(0, n - a) };
    });
    var cov = needed ? Math.round(assigned / needed * 100) : 100;
    var missTotal = Math.max(0, needed - assigned);
    var under = rows.filter(function (x) { return x.miss > 0; });
    var overs = rows.filter(function (x) { return x.over > 0; });

    // Demand totals across the whole month vs the visible week.
    var weekDemand = 0, monthDemand = 0;
    r.week.forEach(function (d) { svs.forEach(function (s) { weekDemand += forecastOf(s, d); }); });
    r.month.forEach(function (d) { svs.forEach(function (s) { monthDemand += forecastOf(s, d); }); });
    var dayDemand = r.week.length ? Math.round(weekDemand / r.week.length) : Math.round(monthDemand / r.month.length);

    function covCls(p) { return p >= 100 ? 'ok' : p >= 80 ? 'warn' : 'bad'; }

    var h = '';
    h += '<div class="fc-scope text-xs text-muted">' + esc(YM) + (r.week.length ? ' · settimana visibile (' + r.week.length + ' gg)' : ' · mese') + '</div>';
    h += '<div class="fc-tiles">' +
      '<div class="fc-tile"><div class="fc-v">' + needed + '</div><div class="fc-l">Necessari</div></div>' +
      '<div class="fc-tile"><div class="fc-v">' + assigned + '</div><div class="fc-l">Assegnati</div></div>' +
      '<div class="fc-tile ' + covCls(cov) + '"><div class="fc-v">' + cov + '%</div><div class="fc-l">Copertura</div></div>' +
      '<div class="fc-tile ' + (missTotal ? 'bad' : 'ok') + '"><div class="fc-v">' + missTotal + '</div><div class="fc-l">Mancanti</div></div>' +
      '</div>';

    h += '<div class="fc-demand">' +
      '<div><span>' + dayDemand + '</span>Domanda / giorno</div>' +
      '<div><span>' + weekDemand + '</span>Domanda settimana</div>' +
      '<div><span>' + monthDemand + '</span>Domanda mese</div>' +
      '</div>';

    h += '<div class="fc-sec-t">Copertura per servizio</div>';
    if (!rows.length) h += '<p class="text-muted text-sm">Nessun servizio con forecast.</p>';
    rows.forEach(function (x) {
      h += '<div class="fc-row">' +
        '<div class="fc-row-top"><span class="fc-name">' + esc(x.name) + '</span><span class="badge b-' + covCls(x.cov) + '">' + x.cov + '%</span></div>' +
        '<div class="fc-bar"><i class="' + covCls(x.cov) + '" style="width:' + Math.min(100, x.cov) + '%"></i></div>' +
        '<div class="fc-row-sub text-xs text-muted">' + x.a + '/' + x.n + ' assegnati' + (x.miss ? ' · <b style="color:var(--bad)">' + x.miss + ' mancanti</b>' : '') + (x.over ? ' · +' + x.over + ' extra' : '') + '</div>' +
        '</div>';
    });

    if (under.length) {
      h += '<div class="fc-sec-t">Servizi sotto organico</div>';
      h += '<div class="fc-chips">' + under.map(function (x) { return '<span class="fc-chip bad">' + esc(x.name) + ' −' + x.miss + '</span>'; }).join('') + '</div>';
    }
    if (overs.length) {
      h += '<div class="fc-sec-t">Servizi sovra organico</div>';
      h += '<div class="fc-chips">' + overs.map(function (x) { return '<span class="fc-chip warn">' + esc(x.name) + ' +' + x.over + '</span>'; }).join('') + '</div>';
    }

    h += '<div class="fc-actions">' +
      '<button class="btn ghost sm" onclick="toggleAssistant()">🤖 Suggerimenti</button>' +
      (typeof openGenerator === 'function' ? '<button class="btn btn-primary sm adminonly" onclick="openGenerator()">⚙ Genera</button>' : '') +
      '</div>';

    body.innerHTML = h;
    // Keep admin-only controls hidden for non-admins even when injected late.
    if (typeof applyAdminVisibility === 'function') { try { applyAdminVisibility(); } catch (e) {} }
  };

  // ── Left employee-filter panel ─────────────────────────────────────
  function _distinct(arr) { return Array.from(new Set(arr.filter(function (v) { return v != null && v !== ''; }))).sort(); }
  function _fillSel(id, values, allLabel) {
    var el = document.getElementById(id); if (!el) return 0;
    var cur = el.value;
    el.innerHTML = "<option value=''>" + allLabel + "</option>" +
      values.map(function (v) { return '<option' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('');
    return values.length;
  }
  function _toggleOpt(selId, lblId, show) {
    var s = document.getElementById(selId), l = document.getElementById(lblId);
    if (s) s.style.display = show ? '' : 'none';
    if (l) l.style.display = show ? '' : 'none';
  }

  // Fill Contract / Team / Manager from the live roster; hide Team/Manager
  // when the roster carries no such data (keeps the panel free of dead filters).
  window.populateSchedFilters = function () {
    var drv = (typeof scopedActive === 'function' ? scopedActive() : (typeof activeDrivers === 'function' ? activeDrivers() : []));
    _fillSel('fContract', _distinct(drv.map(function (d) { return d.contratto; })), 'Tutti i contratti');
    var teams = _distinct(drv.map(function (d) { return d.team; }));
    _fillSel('fTeam', teams, 'Tutti i team'); _toggleOpt('fTeam', 'lblTeam', teams.length > 0);
    var mgrs = _distinct(drv.map(function (d) { return d.manager || d.osm; }));
    _fillSel('fManager', mgrs, 'Tutti i manager'); _toggleOpt('fManager', 'lblManager', mgrs.length > 0);
    updateFilterBadge();
  };

  function updateFilterBadge() {
    var ids = ['q', 'fFiliale', 'fService', 'fStato', 'fContract', 'fTeam', 'fManager'];
    var n = ids.reduce(function (a, id) { var el = document.getElementById(id); return a + ((el && el.value) ? 1 : 0); }, 0);
    var b = document.getElementById('filtCount'); if (b) { b.textContent = n; b.style.display = n ? '' : 'none'; }
    var r = document.getElementById('sfResult');
    if (r && typeof filteredDrivers === 'function') { try { r.textContent = filteredDrivers().length + ' dipendenti'; } catch (e) {} }
  }

  window.onFilterChange = function () {
    if (typeof renderGrid === 'function') renderGrid();
    updateFilterBadge();
  };
  window.resetSchedFilters = function () {
    ['q', 'fFiliale', 'fService', 'fStato', 'fContract', 'fTeam', 'fManager'].forEach(function (id) { var el = document.getElementById(id); if (el && !el.disabled) el.value = ''; });
    onFilterChange();
  };
  window.toggleSchedFilters = function () {
    var p = document.getElementById('schedFilters'); if (!p) return;
    var collapsed = p.classList.toggle('collapsed');
    var btn = document.getElementById('filtToggleBtn'); if (btn) btn.classList.toggle('active', !collapsed);
    // Re-align the Forecast footer's summary column after the panel resizes.
    if (typeof renderForecastDeltaFooter === 'function') setTimeout(renderForecastDeltaFooter, 200);
  };
  // Panel starts open → reflect that on the toolbar button.
  (function () { var btn = document.getElementById('filtToggleBtn'); if (btn) btn.classList.add('active'); })();

  // Refresh the drawer whenever the board re-renders, if it's open.
  var _origRender = window.renderGrid;
  if (typeof _origRender === 'function') {
    window.renderGrid = function () {
      var rv = _origRender.apply(this, arguments);
      var el = document.getElementById('fcDrawer');
      if (el && el.classList.contains('open')) { try { renderForecastPanel(); } catch (e) {} }
      if (typeof window._reapplyZoom === 'function') { try { window._reapplyZoom(); } catch (e) {} }
      return rv;
    };
  }
})();
