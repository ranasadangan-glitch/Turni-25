/* TurniDSP — Forecast vs Delta footer
 * ---------------------------------------------------------------------------
 * Reusable per-day Forecast / Planned / Delta strip pinned below the KPI
 * footer, column-aligned with the board and horizontally scroll-synced with
 * it. (Vanilla-JS equivalent of the requested ForecastDeltaFooter.tsx — the
 * app has no build step. Same inputs: forecast, assignments, visibleDates,
 * filters, all read from the live scheduler state via the existing utilities
 * forecastOf / scopeServices / getCode / codeCls — no duplicated logic.)
 *
 * Forecast = DB forecast (scoped services). Planned = working assignments only
 * (excludes OFF / Ferie / Malattia / Permesso / ROL / Infortunio / Aspettativa
 * / empty — i.e. codeCls off|abs|mal). Delta = Planned − Forecast.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  var _synced = false;

  // Working assignment = a real shift, not rest/absence/empty.
  function _isWorking(c) {
    if (!c || c.toUpperCase() === 'OFF') return false;
    var cls = codeCls(c);
    return cls !== 'off' && cls !== 'abs' && cls !== 'mal';
  }

  // The summary (first) column fills the whole left area — filter panel width
  // + the 205px employee column — so day columns line up with the grid above
  // and no blank gap remains. Published as a CSS var the rows consume.
  function _setColumns() {
    var visN = (typeof gridDays !== 'undefined' && gridDays.length) ? gridDays.length : 0;
    var cellW = (typeof planMode !== 'undefined' && planMode === 'day') ? 'minmax(140px,1fr)' : '50px';
    var fp = document.getElementById('schedFilters');
    var fw = (fp && fp.offsetParent !== null && !fp.classList.contains('collapsed')) ? (fp.offsetWidth || 232) : 0;
    document.documentElement.style.setProperty('--grid-cols-footer',
      (fw + 205) + 'px repeat(' + visN + ',' + cellW + ') 38px');
    var sc = document.getElementById('fcdScroll'); if (sc) sc.style.marginLeft = '';   // no offset hack
  }
  function _setupSync() {
    if (_synced) return;
    var bo = document.getElementById('boardOuter'), sc = document.getElementById('fcdScroll');
    if (!bo || !sc) return;
    var lock = false;
    bo.addEventListener('scroll', function () { if (lock) return; lock = true; sc.scrollLeft = bo.scrollLeft; lock = false; }, { passive: true });
    sc.addEventListener('scroll', function () { if (lock) return; lock = true; bo.scrollLeft = sc.scrollLeft; lock = false; }, { passive: true });
    _synced = true;
  }

  // Shared per-day Forecast / Planned / Delta / Coverage series (single source
  // of truth — reused by this footer AND the standalone Forecast page).
  //   opts.service : optional service name → limit forecast + planned to it.
  //   opts.drivers : optional driver set   → defaults to scopedActive().
  window.fcSeries = function (days, opts) {
    opts = opts || {};
    var active = opts.drivers || (typeof scopedActive === 'function' ? scopedActive() : []);
    var svs = (typeof scopeServices === 'function' ? scopeServices() : []).filter(function (s) { return !s.minOf; });
    var perSvc = !!opts.service;
    if (perSvc) svs = svs.filter(function (s) { return (s.name || s.label || s.key) === opts.service; });
    return (days || []).map(function (d) {
      var f = 0; svs.forEach(function (s) { f += forecastOf(s, d); });
      // Per-service Planned = assigned shift-codes that count for that service
      // (harmonyOf), which is robust to the service-name vs code divergence.
      // Aggregate Planned = drivers with any working code.
      var p = 0;
      if (perSvc && typeof harmonyOf === 'function') { svs.forEach(function (s) { p += harmonyOf(s, d, active); }); }
      else { active.forEach(function (dr) { if (_isWorking(getCode(dr.id, d))) p++; }); }
      return { day: d, forecast: f, planned: p, delta: p - f, coverage: f > 0 ? Math.round(p / f * 100) : (p ? 100 : 0) };
    });
  };

  // Selected forecast service for editing (footer dropdown). Editing forecast
  // requires a single service; "Tutti" → aggregate, read-only.
  function _svcList() { return (typeof scopeServices === 'function' ? scopeServices() : []).filter(function (s) { return !s.minOf; }); }
  function _svcLabel() { var s = document.getElementById('fcdSvc'); return s ? s.value : ''; }
  function _svcKey() { var v = _svcLabel(); if (!v) return null; var s = _svcList().find(function (x) { return (x.label || x.key) === v; }); return s ? s.key : null; }

  window.renderForecastDeltaFooter = function () {
    var inner = document.getElementById('fcdInner'); if (!inner) return;
    if (typeof state === 'undefined' || !state) { inner.innerHTML = ''; return; }
    var visDays = (typeof gridDays !== 'undefined' && gridDays.length) ? gridDays : [];
    if (!visDays.length) { inner.innerHTML = ''; return; }

    // Populate the service selector once (preserve selection).
    var sel = document.getElementById('fcdSvc');
    if (sel && sel.dataset.k !== String(_svcList().length)) {
      var cur = sel.value;
      sel.innerHTML = "<option value=''>Tutti i servizi</option>" + _svcList().map(function (s) { var l = s.label || s.key; return '<option' + (l === cur ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join('');
      sel.dataset.k = String(_svcList().length);
    }
    var svcLabel = _svcLabel(), svcKey = _svcKey(), editable = !!svcKey;
    var series = window.fcSeries(visDays, svcLabel ? { service: svcLabel } : {});

    // Sunday-start weeks (same grouping as the board's week band).
    var wkBand = "<div class='fcd-lbl'>Settimana</div>";
    if (typeof sunWeek === 'function') {
      for (var i = 0; i < visDays.length;) {
        var wk = sunWeek(YM, visDays[i]), span = 0, wkFore = 0;
        while (i + span < visDays.length && sunWeek(YM, visDays[i + span]).start === wk.start) { wkFore += series[i + span].forecast; span++; }
        wkBand += "<div class='fcd-wk' style='grid-column:span " + span + "'>WK " + wk.label + " · " + wkFore + '</div>';
        i += span;
      }
    } else { visDays.forEach(function () { wkBand += "<div class='fcd-wk'></div>"; }); }
    wkBand += "<div class='fcd-tot'></div>";

    var dateRow = '', fRow = '', pRow = '', dRow = '', cRow = '', fTot = 0, pTot = 0;
    series.forEach(function (s, idx) {
      var f = s.forecast, p = s.planned, dl = s.delta; fTot += f; pTot += p;
      var cov = f > 0 ? Math.round(p / f * 100) : (p ? 100 : 0);
      dateRow += "<div class='fcd-cell'>" + String(s.day).padStart(2, '0') + '</div>';
      fRow += editable
        ? "<div class='fcd-cell'><input type='number' min='0' step='1' class='fcd-inp' value='" + f + "' onchange='fcdSetForecast(" + s.day + ",this.value)' onkeydown='fcdKey(event," + idx + ")' onpaste='fcdPaste(event," + s.day + ")'></div>"
        : "<div class='fcd-cell'>" + f + '</div>';
      pRow += "<div class='fcd-cell'>" + p + '</div>';
      dRow += "<div class='fcd-cell " + (dl < 0 ? 'd-neg' : dl > 0 ? 'd-pos' : 'd-zero') + "'>" + (dl > 0 ? '+' + dl : dl) + '</div>';
      cRow += "<div class='fcd-cell'>" + cov + '%</div>';
    });
    var dTot = pTot - fTot, covTot = fTot > 0 ? Math.round(pTot / fTot * 100) : (pTot ? 100 : 0);
    inner.innerHTML =
      "<div class='fcd-row fcd-wkrow'>" + wkBand + '</div>' +
      "<div class='fcd-row fcd-dates'><div class='fcd-lbl'>Giorno</div>" + dateRow + "<div class='fcd-tot'>TOT</div></div>" +
      "<div class='fcd-row fcd-fore'><div class='fcd-lbl'>Forecast" + (editable ? " ✎" : '') + "</div>" + fRow + "<div class='fcd-tot'>" + fTot + '</div></div>' +
      "<div class='fcd-row fcd-plan'><div class='fcd-lbl'>Pianificati</div>" + pRow + "<div class='fcd-tot'>" + pTot + '</div></div>' +
      "<div class='fcd-row fcd-delta'><div class='fcd-lbl'>Delta</div>" + dRow +
        "<div class='fcd-tot " + (dTot < 0 ? 'd-neg' : dTot > 0 ? 'd-pos' : 'd-zero') + "'>" + (dTot > 0 ? '+' + dTot : dTot) + '</div></div>' +
      "<div class='fcd-row fcd-cov'><div class='fcd-lbl'>Copertura</div>" + cRow + "<div class='fcd-tot'>" + covTot + '%</div></div>';
    _setColumns();
    _setupSync();
  };

  // Auto-save one forecast cell (reuses setFc → PostgreSQL + audit log). Integers
  // only, no negatives. Footer KPIs + rows refresh instantly.
  window.fcdSetForecast = function (day, val) {
    var key = _svcKey(); if (!key || typeof setFc !== 'function') return;
    setFc(key, day, Math.max(0, parseInt(val, 10) || 0));
    if (typeof refreshBottomBar === 'function') refreshBottomBar();
    renderForecastDeltaFooter();
  };
  // Spreadsheet-style paste: a row of values fills consecutive days (bulk edit).
  window.fcdPaste = function (ev, startDay) {
    var key = _svcKey(); if (!key || typeof setFc !== 'function') return;
    var txt = ((ev.clipboardData || window.clipboardData) || {}).getData ? (ev.clipboardData || window.clipboardData).getData('text') : '';
    var vals = String(txt || '').split(/[\s,;]+/).filter(function (x) { return x !== ''; });
    if (vals.length <= 1) return;                 // single value → let native paste run
    ev.preventDefault();
    var days = (typeof gridDays !== 'undefined') ? gridDays : [], idx = days.indexOf(startDay);
    vals.forEach(function (v, i) { var d = days[idx + i]; if (d != null) setFc(key, d, Math.max(0, parseInt(v, 10) || 0)); });
    if (typeof refreshBottomBar === 'function') refreshBottomBar();
    renderForecastDeltaFooter();
  };
  // Enter → next day cell (fast sequential entry, Excel-like).
  window.fcdKey = function (ev, idx) {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    var inps = document.querySelectorAll('.fcd-fore .fcd-inp'), nx = inps[idx + 1];
    if (nx) { nx.focus(); nx.select(); } else ev.target.blur();
  };
})();
