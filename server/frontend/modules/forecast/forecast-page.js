/* TurniDSP — Forecast · a VIEW of the single planning engine
 * ---------------------------------------------------------------------------
 * Forecast is NOT a separate data model: it reads and writes the SAME planning
 * records as Pianificazione (the Scheduler). Forecast values come from
 * state.forecast (backed by schedule_forecasts) via forecastOf(); edits go
 * through the scheduler's own setFc() — so every change is instantly shared
 * with the board, footer, dashboard, KPIs, reports and exports. Scheduled /
 * Available / Coverage / Delta are computed from the same scheduler data
 * (employees + schedule_entries via harmonyOf/getCode). One table, one API,
 * one calculation engine — this file only re-visualizes it (Daily/Weekly/Monthly).
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  var _built = false;
  var DOW_IT = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
  var WEEK_ORDER = [0, 1, 2, 3, 4, 5, 6];               // Sun…Sat (week starts Sunday)
  var _tab = 'weekly';
  var _wkIdx = 0;
  var _dayCursor = null;
  var _edited = {};                                     // "svcKey|day" -> true (highlight)
  function _canEdit() { return (typeof isAdmin === 'function') ? isAdmin() : false; }

  // ── helpers ─────────────────────────────────────────────────────────
  function _di() { return (typeof daysInMonth === 'function') ? daysInMonth(YM) : 31; }
  function _pad(d) { return String(d).padStart(2, '0'); }
  function _val(id) { var e = document.getElementById(id); return e ? (e.value || '') : ''; }
  function _dow0(d) { return new Date(YM + '-' + _pad(d) + 'T00:00:00').getDay(); }
  function _year() { return +YM.split('-')[0]; }
  function _month() { return +YM.split('-')[1]; }
  function _covCls(p) { return p >= 100 ? 'ok' : p >= 95 ? 'warn' : 'bad'; }
  function _dCls(d) { return d > 0 ? 'ok' : d < 0 ? 'bad' : 'zero'; }
  function _cov(s, f) { return f > 0 ? Math.round(s / f * 100) : (s ? 100 : 0); }

  function _sunWeeks() {
    var out = [], map = {};
    for (var d = 1; d <= _di(); d++) {
      var g = _dow0(d), key = d - g;
      if (!(key in map)) { map[key] = { days: [], slots: [null, null, null, null, null, null, null] }; out.push(map[key]); }
      map[key].days.push(d); map[key].slots[g] = d;
    }
    out.forEach(function (w) { w.label = (typeof sunWeek === 'function') ? sunWeek(YM, w.days[0]).label : 0; });
    return out;
  }
  function _week() { var w = _sunWeeks(); if (_wkIdx >= w.length) _wkIdx = w.length - 1; if (_wkIdx < 0) _wkIdx = 0; return w[_wkIdx] || { days: [], slots: [], label: 0 }; }

  // Real services in scope, filtered by station + (optional) service filter.
  function _services() {
    var st = _val('fpStation'), svf = _val('fpService');
    return (typeof scopeServices === 'function' ? scopeServices() : []).filter(function (s) {
      if (s.minOf) return false;
      if (st && s.filiali && s.filiali.length && s.filiali.indexOf(st) < 0) return false;
      if (svf && (s.label || s.key) !== svf) return false;
      return true;
    });
  }
  function _allServices() { return (typeof scopeServices === 'function' ? scopeServices() : []).filter(function (s) { return !s.minOf; }); }
  function _drivers() { var st = _val('fpStation'); return (typeof scopedActive === 'function' ? scopedActive() : []).filter(function (d) { return !st || d.filiale === st; }); }
  function _absences(day, drv) { var n = 0; drv.forEach(function (d) { var c = getCode(d.id, day); if (c && codeCls(c) === 'mal') n++; }); return n; }

  // SINGLE ENGINE: forecast from the scheduler store, planned via harmonyOf.
  function _metric(svc, day, drv) {
    var f = (typeof forecastOf === 'function') ? forecastOf(svc, day) : 0;
    var s = (typeof harmonyOf === 'function') ? harmonyOf(svc, day, drv) : 0;
    return { day: day, f: f, sched: s, avail: drv.length - _absences(day, drv), cov: _cov(s, f), delta: s - f };
  }

  // ── shell ───────────────────────────────────────────────────────────
  window.bootForecastPage = function () {
    var sec = document.getElementById('sec-forecast'); if (!sec) return;
    if (!_built) {
      sec.innerHTML =
        "<div class='page-head'><div class='page-title'>📊 Forecast · Dashboard</div>" +
        "<div class='fc2-tools'><button class='btn ghost sm' onclick='fpExportCsv()'>⬇ Esporta Excel</button>" +
        "<button class='btn ghost sm' onclick='window.print()'>🖨 PDF / Stampa</button></div></div>" +
        "<div class='fc3-tabs'>" +
        "<button data-t='daily' onclick=\"fpTab('daily')\">Giornaliero</button>" +
        "<button data-t='weekly' class='on' onclick=\"fpTab('weekly')\">Settimanale</button>" +
        "<button data-t='monthly' onclick=\"fpTab('monthly')\">Mensile</button></div>" +
        "<div class='fc2-filters'>" +
        "<label class='fp-fl'>Filiale<select id='fpStation' class='sel' onchange='fpStationChange(this.value)'></select></label>" +
        "<label class='fp-fl'>Servizio<select id='fpService' class='sel' onchange='refreshForecastPage()'><option value=''>Tutti</option></select></label>" +
        "<label class='fp-fl'>Mese<select id='fpMonth' class='sel' onchange='fpMonthYear()'></select></label>" +
        "<label class='fp-fl'>Anno<select id='fpYear' class='sel' onchange='fpMonthYear()'></select></label>" +
        "<label class='fp-fl' id='fpWeekWrap'>Settimana<select id='fpWeek' class='sel' onchange='fpSelWeek(this.value)'></select></label>" +
        "<label class='fp-fl' id='fpDayWrap' style='display:none'>Giorno<select id='fpDay' class='sel' onchange='fpSelDay(this.value)'></select></label>" +
        "</div>" +
        "<div class='ops-kpi' id='fpKpi' style='border:none;padding:0;margin-bottom:12px'></div>" +
        "<div id='fpView'></div>" +
        "<div class='card card-pad' style='margin-top:14px'><div class='fp-h' id='fpChartT'>Forecast vs Pianificati</div><div id='fpChart'></div></div>";
      _built = true;
    }
    var mSel = document.getElementById('fpMonth');
    if (mSel) mSel.innerHTML = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'].map(function (n, i) { return "<option value='" + (i + 1) + "'" + (i + 1 === _month() ? ' selected' : '') + '>' + n + '</option>'; }).join('');
    var ySel = document.getElementById('fpYear');
    if (ySel) { var o = '', y = _year(); for (var yy = y - 2; yy <= y + 2; yy++) o += "<option" + (yy === y ? ' selected' : '') + '>' + yy + '</option>'; ySel.innerHTML = o; }
    // Station = the scheduler's branch (single source): drives loadMonth.
    var stSel = document.getElementById('fpStation');
    if (stSel && typeof filiali === 'function') {
      var cur = _val('fpStation') || (typeof schedBranch === 'function' ? schedBranch() : '') || (document.getElementById('branchSel') || {}).value || filiali()[0] || '';
      stSel.innerHTML = filiali().map(function (f) { return "<option" + (f === cur ? ' selected' : '') + '>' + esc(f) + '</option>'; }).join('');
    }
    var svSel = document.getElementById('fpService');
    if (svSel) { var cv = _val('fpService'); svSel.innerHTML = "<option value=''>Tutti</option>" + _allServices().map(function (s) { var l = s.label || s.key; return '<option' + (l === cv ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join(''); }
    fpReload();
  };

  window.fpTab = function (t) {
    _tab = t;
    document.querySelectorAll('.fc3-tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.t === t); });
    document.getElementById('fpWeekWrap').style.display = (t === 'monthly') ? 'none' : '';
    document.getElementById('fpDayWrap').style.display = (t === 'daily') ? '' : 'none';
    fpReload();
  };
  // Changing station = changing the scheduler's loaded branch (one source).
  window.fpStationChange = function (st) {
    _edited = {};
    var bs = document.getElementById('branchSel'); if (bs) bs.value = st;
    if (typeof loadMonthFromDB === 'function') loadMonthFromDB(YM, st).then(function () { if (typeof refreshAll === 'function') { try { refreshAll(); } catch (e) {} } fpReload(); });
    else fpReload();
  };
  window.fpMonthYear = function () {
    YM = _val('fpYear') + '-' + _pad(_val('fpMonth')); _edited = {}; _wkIdx = 0;
    if (typeof loadMonthFromDB === 'function') loadMonthFromDB(YM, _val('fpStation')).then(function () { if (typeof refreshAll === 'function') { try { refreshAll(); } catch (e) {} } fpReload(); });
    else fpReload();
  };
  window.fpSelWeek = function (i) { _wkIdx = parseInt(i, 10) || 0; fpReload(); };
  window.fpSelDay = function (d) { _dayCursor = parseInt(d, 10) || null; _render(); };

  window.fpReload = function () {
    if (typeof state === 'undefined' || !state || typeof scopeServices !== 'function') return;
    var wSel = document.getElementById('fpWeek');
    if (wSel) wSel.innerHTML = _sunWeeks().map(function (w, i) { return "<option value='" + i + "'" + (i === _wkIdx ? ' selected' : '') + '>WK' + w.label + ' · ' + _pad(w.days[0]) + '–' + _pad(w.days[w.days.length - 1]) + '</option>'; }).join('');
    if (_tab === 'daily') {
      var wk = _week(); if (_dayCursor == null || wk.days.indexOf(_dayCursor) < 0) _dayCursor = wk.days[0];
      var dSel = document.getElementById('fpDay');
      if (dSel) dSel.innerHTML = wk.days.map(function (d) { return "<option value='" + d + "'" + (d === _dayCursor ? ' selected' : '') + '>' + DOW_IT[_dow0(d)] + ' ' + _pad(d) + '</option>'; }).join('');
    }
    _render();
  };
  window.refreshForecastPage = window.fpReload;

  function _render() {
    if (_tab === 'monthly') return _renderMonthly();
    if (_tab === 'daily') return _renderDaily();
    return _renderWeekly();
  }
  function _card(v, l, cls) { return "<div class='opsk " + (cls || '') + "'><div class='opsk-v'>" + v + "</div><div class='opsk-l'>" + l + "</div></div>"; }

  // Editable forecast cell → writes the shared store via setFc().
  function _fcCell(s, day, value) {
    var ed = _edited[s.key + '|' + day] ? ' edited' : '';
    if (!_canEdit()) return "<div class='fc3-c fc3-fc" + ed + "'>" + value + "</div>";
    return "<div class='fc3-c fc3-fc" + ed + "'><input class='fc3-fin' type='number' min='0' inputmode='numeric' value='" + value +
      "' onkeydown='fpFcKey(event)' onchange='fpFcSet(\"" + s.key + "\"," + day + ",this.value)'></div>";
  }
  window.fpFcKey = function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); ev.target.blur(); } };
  window.fpFcSet = function (svcKey, day, v) {
    if (typeof setFc !== 'function') return;
    setFc(svcKey, day, Math.max(0, parseInt(v, 10) || 0));   // SAME write path as the board footer → state.forecast + schedule_forecasts
    _edited[svcKey + '|' + day] = true;
    _render();
  };

  // ── Weekly (rows = Service, Sun–Sat) ────────────────────────────────
  function _renderWeekly() {
    var wk = _week(), services = _services(), drv = _drivers();
    var cols = "160px repeat(7,minmax(40px,1fr)) repeat(4,minmax(52px,1fr))";
    var h = "<div class='fc2-gridwrap'><div class='fc3-grid'>";
    h += "<div class='fc3-row fc3-head' style='grid-template-columns:" + cols + "'><div class='fc3-lbl'>Servizio</div>";
    WEEK_ORDER.forEach(function (g) { var d = wk.slots[g]; h += "<div class='fc3-h" + (g === 0 || g === 6 ? ' wend' : '') + "'>" + DOW_IT[g] + (d ? "<br><small>" + _pad(d) + "</small>" : "<br><small>—</small>") + "</div>"; });
    h += "<div class='fc3-h'>Piani.</div><div class='fc3-h'>Disp.</div><div class='fc3-h'>Cop.</div><div class='fc3-h'>Δ</div></div>";
    var tF = 0, tS = 0, tA = 0, covs = [];
    services.forEach(function (s) {
      var rf = 0, rs = 0, ra = 0, n = 0;
      var row = "<div class='fc3-row' style='grid-template-columns:" + cols + "'><div class='fc3-lbl' title='" + esc(s.key) + "'>" + esc(s.label || s.key) + "</div>";
      WEEK_ORDER.forEach(function (g) {
        var d = wk.slots[g];
        if (d == null) { row += "<div class='fc3-c fc3-dis'>—</div>"; return; }
        var m = _metric(s, d, drv); rf += m.f; rs += m.sched; ra += m.avail; n++;
        row += _fcCell(s, d, m.f);
      });
      var cov = _cov(rs, rf), avg = n ? Math.round(ra / n) : 0;
      tF += rf; tS += rs; tA += avg; covs.push(cov);
      row += "<div class='fc3-c'>" + rs + "</div><div class='fc3-c'>" + avg + "</div><div class='fc3-c fc3-badge " + _covCls(cov) + "'>" + cov + "%</div><div class='fc3-c " + _dCls(rs - rf) + "'>" + (rs - rf > 0 ? '+' : '') + (rs - rf) + "</div></div>";
      h += row;
    });
    var tCov = _cov(tS, tF), avgCov = covs.length ? Math.round(covs.reduce(function (a, b) { return a + b; }, 0) / covs.length) : 0;
    h += "<div class='fc3-row fc3-tot' style='grid-template-columns:" + cols + "'><div class='fc3-lbl'>Totale</div><div class='fc3-c' style='grid-column:span 7'>F " + tF + " · media cop. " + avgCov + "%</div><div class='fc3-c'>" + tS + "</div><div class='fc3-c'>" + tA + "</div><div class='fc3-c fc3-badge " + _covCls(tCov) + "'>" + tCov + "%</div><div class='fc3-c " + _dCls(tS - tF) + "'>" + (tS - tF > 0 ? '+' : '') + (tS - tF) + "</div></div></div></div>";
    document.getElementById('fpView').innerHTML = h;
    _renderKpi(tF, tS, tA, tCov);
    var series = WEEK_ORDER.map(function (g) { var d = wk.slots[g]; if (d == null) return { l: DOW_IT[g], f: 0, s: 0 }; var f = 0, sc = 0; services.forEach(function (s) { var m = _metric(s, d, drv); f += m.f; sc += m.sched; }); return { l: DOW_IT[g], f: f, s: sc }; });
    _chart('Forecast vs Pianificati · settimana', series);
  }

  // ── Monthly (rows = week) ───────────────────────────────────────────
  function _renderMonthly() {
    var weeks = _sunWeeks(), services = _services(), drv = _drivers();
    var cols = "120px repeat(5,minmax(64px,1fr))";
    var h = "<div class='fc2-gridwrap'><div class='fc3-grid'><div class='fc3-row fc3-head' style='grid-template-columns:" + cols + "'><div class='fc3-lbl'>Settimana</div><div class='fc3-h'>Forecast</div><div class='fc3-h'>Piani.</div><div class='fc3-h'>Disp.</div><div class='fc3-h'>Cop.</div><div class='fc3-h'>Δ</div></div>";
    var tF = 0, tS = 0, tA = 0, series = [];
    weeks.forEach(function (w) {
      var wf = 0, ws = 0, wa = 0, n = 0;
      w.days.forEach(function (d) { wa += drv.length - _absences(d, drv); n++; services.forEach(function (s) { var m = _metric(s, d, drv); wf += m.f; ws += m.sched; }); });
      var avg = n ? Math.round(wa / n) : 0, cov = _cov(ws, wf); tF += wf; tS += ws; tA += avg;
      series.push({ l: 'WK' + w.label, f: wf, s: ws });
      h += "<div class='fc3-row' style='grid-template-columns:" + cols + "'><div class='fc3-lbl'>WK" + w.label + " <small>" + _pad(w.days[0]) + '–' + _pad(w.days[w.days.length - 1]) + "</small></div><div class='fc3-c'>" + wf + "</div><div class='fc3-c'>" + ws + "</div><div class='fc3-c'>" + avg + "</div><div class='fc3-c fc3-badge " + _covCls(cov) + "'>" + cov + "%</div><div class='fc3-c " + _dCls(ws - wf) + "'>" + (ws - wf > 0 ? '+' : '') + (ws - wf) + "</div></div>";
    });
    var tCov = _cov(tS, tF);
    h += "<div class='fc3-row fc3-tot' style='grid-template-columns:" + cols + "'><div class='fc3-lbl'>Totale mese</div><div class='fc3-c'>" + tF + "</div><div class='fc3-c'>" + tS + "</div><div class='fc3-c'>" + Math.round(tA / (weeks.length || 1)) + "</div><div class='fc3-c fc3-badge " + _covCls(tCov) + "'>" + tCov + "%</div><div class='fc3-c " + _dCls(tS - tF) + "'>" + (tS - tF > 0 ? '+' : '') + (tS - tF) + "</div></div></div></div>";
    document.getElementById('fpView').innerHTML = h;
    _renderKpi(tF, tS, Math.round(tA / (weeks.length || 1)), tCov);
    _chart('Trend mensile · Forecast vs Pianificati', series);
  }

  // ── Daily (rows = Service; forecast editable) ───────────────────────
  function _renderDaily() {
    var wk = _week(), d = _dayCursor || wk.days[0], services = _services(), drv = _drivers();
    var cols = "1fr repeat(5,minmax(58px,1fr))";
    var h = "<div class='fc2-gridwrap'><div class='fc3-grid'><div class='fc3-row fc3-head' style='grid-template-columns:" + cols + "'><div class='fc3-lbl'>Servizio</div><div class='fc3-h'>Forecast</div><div class='fc3-h'>Piani.</div><div class='fc3-h'>Disp.</div><div class='fc3-h'>Cop.</div><div class='fc3-h'>Δ</div></div>";
    var tF = 0, tS = 0, tA = 0;
    services.forEach(function (s) {
      var m = _metric(s, d, drv); tF += m.f; tS += m.sched; tA += m.avail;
      h += "<div class='fc3-row' style='grid-template-columns:" + cols + "'><div class='fc3-lbl'>" + esc(s.label || s.key) + "</div>" +
        _fcCell(s, d, m.f) + "<div class='fc3-c'>" + m.sched + "</div><div class='fc3-c'>" + m.avail + "</div><div class='fc3-c fc3-badge " + _covCls(m.cov) + "'>" + m.cov + "%</div><div class='fc3-c " + _dCls(m.delta) + "'>" + (m.delta > 0 ? '+' : '') + m.delta + "</div></div>";
    });
    var tCov = _cov(tS, tF);
    h += "<div class='fc3-row fc3-tot' style='grid-template-columns:" + cols + "'><div class='fc3-lbl'>Totale</div><div class='fc3-c'>" + tF + "</div><div class='fc3-c'>" + tS + "</div><div class='fc3-c'>" + tA + "</div><div class='fc3-c fc3-badge " + _covCls(tCov) + "'>" + tCov + "%</div><div class='fc3-c " + _dCls(tS - tF) + "'>" + (tS - tF > 0 ? '+' : '') + (tS - tF) + "</div></div></div></div>";
    document.getElementById('fpView').innerHTML = h;
    _renderKpi(tF, tS, tA, tCov);
    var series = services.map(function (s) { var m = _metric(s, d, drv); return { l: (s.label || s.key).slice(0, 6), f: m.f, s: m.sched }; });
    _chart('Forecast vs Pianificati · ' + DOW_IT[_dow0(d)] + ' ' + _pad(d), series);
  }

  function _renderKpi(f, s, avail, cov) {
    document.getElementById('fpKpi').innerHTML =
      _card(f, 'Forecast', 'warn') + _card(s, 'Pianificati', 'ok') + _card(avail, 'Disponibili', '') +
      _card(cov + '%', 'Copertura', _covCls(cov)) + _card((s - f > 0 ? '+' : '') + (s - f), 'Delta', _dCls(s - f));
  }

  function _chart(title, series) {
    document.getElementById('fpChartT').textContent = title;
    var el = document.getElementById('fpChart'); if (!el) return;
    var max = 1; series.forEach(function (x) { max = Math.max(max, x.f, x.s); });
    var n = series.length, W = Math.max(n * 46 + 30, 320), H = 170, pad = 22, bw = 12;
    var svg = "<svg viewBox='0 0 " + W + ' ' + H + "' width='100%' height='" + H + "' preserveAspectRatio='none' style='min-width:" + W + "px'>";
    series.forEach(function (x, i) {
      var cx = 20 + i * ((W - 40) / n), base = H - pad;
      function bar(v, off, color) { var bh = (v / max) * (H - pad * 2); svg += "<rect x='" + (cx + off).toFixed(1) + "' y='" + (base - bh).toFixed(1) + "' width='" + bw + "' height='" + bh.toFixed(1) + "' fill='" + color + "' rx='1'></rect>"; }
      bar(x.f, 0, 'var(--warn)'); bar(x.s, bw + 2, 'var(--brand)');
      svg += "<text x='" + (cx + bw).toFixed(1) + "' y='" + (H - 6) + "' font-size='9' fill='var(--text-muted)' text-anchor='middle'>" + esc(x.l) + "</text>";
    });
    svg += "<line x1='0' y1='" + (H - pad) + "' x2='" + W + "' y2='" + (H - pad) + "' stroke='var(--border)'></line></svg>";
    el.innerHTML = "<div style='overflow-x:auto'>" + svg + "</div><div class='fp-legend'><span><i style='background:var(--warn)'></i>Forecast</span><span><i style='background:var(--brand)'></i>Pianificati</span></div>";
  }

  window.fpExportCsv = function () {
    var tbl = document.querySelector('#fpView .fc3-grid'); if (!tbl) return;
    var rows = [];
    tbl.querySelectorAll('.fc3-row').forEach(function (r) {
      var cells = []; r.querySelectorAll('.fc3-lbl,.fc3-h,.fc3-c').forEach(function (c) { var inp = c.querySelector('input'); cells.push((inp ? inp.value : c.textContent).replace(/\s+/g, ' ').trim()); });
      rows.push(cells.join(';'));
    });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }));
    a.download = 'forecast_' + _tab + '_' + YM + '.csv'; a.click(); URL.revokeObjectURL(a.href);
  };
})();
