/* TurniDSP — Operations Control Center · right sidebar
 * ---------------------------------------------------------------------------
 * Collapsible right drawer with the operational alert panels the spec asks for:
 *   Critical Alerts · Missing Coverage · Expiring Contracts ·
 *   Expiring Medical Certificates · Missing Documents · Coverage by Branch.
 * Everything except documents is computed from the live scheduler state; the
 * documents list is fetched once (cached) and refreshed when the drawer opens.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  var _docs = null;          // cached documentsAll() result
  var _docsLoading = false;

  function _ensureDrawer() {
    if (document.getElementById('opsDrawer')) return;
    var d = document.createElement('div');
    d.id = 'opsDrawer';
    d.className = 'ops-drawer';
    d.innerHTML =
      '<div class="ops-head"><b>🎛 Centro operativo</b>' +
      '<button class="ops-x" ' + actAttr('click','toggleOpsCenter') + ' title="Chiudi">✕</button></div>' +
      '<div class="ops-body" id="opsBody"></div>';
    document.body.appendChild(d);
  }

  window.toggleOpsCenter = function () {
    _ensureDrawer();
    var el = document.getElementById('opsDrawer');
    var open = el.classList.toggle('open');
    var btn = document.getElementById('opsToggleBtn');
    if (btn) btn.classList.toggle('active', open);
    if (open) {
      renderOpsCenter();
      if (!_docs && !_docsLoading && typeof TurniApi !== 'undefined' && TurniApi.documentsAll) {
        _docsLoading = true;
        TurniApi.documentsAll().then(function (rows) { _docs = rows || []; _docsLoading = false; renderOpsCenter(); })
          .catch(function () { _docs = []; _docsLoading = false; renderOpsCenter(); });
      }
    }
  };

  function daysTo(dateStr) {
    if (!dateStr) return null;
    return Math.round((new Date(String(dateStr).slice(0, 10) + 'T00:00:00') - new Date()) / 86400000);
  }

  window.renderOpsCenter = function () {
    _ensureDrawer();
    var body = document.getElementById('opsBody'); if (!body) return;
    if (typeof state === 'undefined' || !state) { body.innerHTML = '<p class="text-muted" style="padding:12px">Nessun dato.</p>'; return; }
    var active = (typeof scopedActive === 'function') ? scopedActive() : [];
    var refDay = (typeof gridRefDay !== 'undefined') ? gridRefDay : 1;
    var visDays = (typeof gridDays !== 'undefined' && gridDays.length) ? gridDays : [refDay];
    var h = '';

    // 1) Critical alerts — rest violations + understaffed on the reference day.
    var viol = active.filter(function (d) { return typeof driverHasViolation === 'function' && driverHasViolation(d); });
    var alerts = [];
    viol.forEach(function (d) { alerts.push({ sev: 'bad', txt: esc(d.cognome + ' ' + d.nome) + ' — 7+ giorni consecutivi senza riposo' }); });
    try {
      var svs0 = (typeof scopeServices === 'function' ? scopeServices() : []).filter(function (s) { return !s.minOf; });
      var fc = 0, pl = 0;
      svs0.forEach(function (s) { fc += forecastOf(s, refDay); pl += harmonyOf(s, refDay, active); });
      if (fc > pl) alerts.push({ sev: 'warn', txt: 'Copertura del giorno sotto forecast: ' + pl + '/' + fc + ' (' + (fc - pl) + ' mancanti)' });
    } catch (e) {}
    h += _section('⚠️ Alert critici', alerts.length,
      alerts.length ? alerts.map(function (a) { return _row(a.sev, a.txt); }).join('') : _empty('Nessun alert critico.'));

    // 2) Missing coverage — services short over the visible period.
    var miss = [];
    try {
      (typeof scopeServices === 'function' ? scopeServices() : []).filter(function (s) { return !s.minOf; }).forEach(function (s) {
        var short = 0; visDays.forEach(function (d) { short += Math.max(0, forecastOf(s, d) - harmonyOf(s, d, active)); });
        if (short > 0) miss.push({ name: s.label || s.name || s.key, short: short });
      });
      miss.sort(function (a, b) { return b.short - a.short; });
    } catch (e) {}
    h += _section('📉 Copertura mancante', miss.length,
      miss.length ? miss.map(function (m) { return _kv(esc(m.name), '−' + m.short, 'bad'); }).join('') : _empty('Tutti i servizi coperti.'));

    // 3) Expiring contracts (≤ 60 days).
    var expC = active.map(function (d) { return { d: d, days: daysTo(d.expiry) }; })
      .filter(function (x) { return x.days != null && x.days >= 0 && x.days <= 60; })
      .sort(function (a, b) { return a.days - b.days; });
    h += _section('📄 Contratti in scadenza', expC.length,
      expC.length ? expC.map(function (x) {
        return _kv(esc(x.d.cognome + ' ' + x.d.nome), x.days + ' gg', x.days <= 15 ? 'bad' : 'warn');
      }).join('') : _empty('Nessun contratto in scadenza (60 gg).'));

    // 4) Expiring medical certificates (from documents).
    var meds = [];
    if (_docs) {
      _docs.forEach(function (dc) {
        if (!dc.expiry_date || !/medic|sanit|cert/i.test(dc.doc_type || '')) return;
        var dd = daysTo(dc.expiry_date); if (dd == null || dd > 60) return;
        var emp = active.find(function (a) { return String(a.id) === String(dc.employee_id); });
        meds.push({ name: emp ? emp.cognome + ' ' + emp.nome : ('#' + dc.employee_id), days: dd });
      });
      meds.sort(function (a, b) { return a.days - b.days; });
    }
    h += _section('🩺 Certificati medici', _docs ? meds.length : '…',
      !_docs ? _empty('Caricamento…') : (meds.length ? meds.map(function (m) { return _kv(esc(m.name), m.days + ' gg', m.days <= 15 ? 'bad' : 'warn'); }).join('') : _empty('Nessun certificato in scadenza.')));

    // 5) Missing documents — active employees with no document on file.
    var missDocs = [];
    if (_docs) {
      var withDoc = {}; _docs.forEach(function (dc) { withDoc[String(dc.employee_id)] = 1; });
      missDocs = active.filter(function (a) { return !withDoc[String(a.id)]; });
    }
    h += _section('📁 Documenti mancanti', _docs ? missDocs.length : '…',
      !_docs ? _empty('Caricamento…') : (missDocs.length ? missDocs.slice(0, 30).map(function (a) { return _row('warn', esc(a.cognome + ' ' + a.nome)); }).join('') + (missDocs.length > 30 ? _empty('…e altri ' + (missDocs.length - 30)) : '') : _empty('Tutti i dipendenti hanno documenti.')));

    // 6) Coverage by branch.
    var byBranch = {};
    active.forEach(function (d) {
      var b = d.filiale || '—';
      if (!byBranch[b]) byBranch[b] = { total: 0, sched: 0 };
      byBranch[b].total++;
      var c = getCode(d.id, refDay); if (c && c.toUpperCase() !== 'OFF' && codeCls(c) !== 'mal' && codeCls(c) !== 'abs') byBranch[b].sched++;
    });
    var branches = Object.keys(byBranch).sort();
    h += _section('🏢 Copertura per filiale', branches.length,
      branches.length ? branches.map(function (b) {
        var o = byBranch[b], pct = o.total ? Math.round(o.sched / o.total * 100) : 0;
        var cls = pct >= 80 ? 'ok' : pct >= 50 ? 'warn' : 'bad';
        return "<div class='ops-branch'><div class='ops-branch-top'><span>" + esc(b) + "</span><b>" + o.sched + '/' + o.total + "</b></div>" +
          "<div class='ops-bar'><i class='" + cls + "' style='width:" + Math.min(100, pct) + "%'></i></div></div>";
      }).join('') : _empty('Nessuna filiale.'));

    body.innerHTML = h;
  };

  function _section(title, count, inner) {
    return "<div class='ops-sec'><div class='ops-sec-h'>" + title +
      (count !== '' && count != null ? "<span class='ops-badge'>" + count + '</span>' : '') + '</div>' + inner + '</div>';
  }
  function _row(sev, txt) { return "<div class='ops-item " + sev + "'>" + txt + '</div>'; }
  function _kv(k, v, sev) { return "<div class='ops-kv'><span>" + k + "</span><b class='" + (sev || '') + "'>" + v + '</b></div>'; }
  function _empty(txt) { return "<div class='ops-empty'>" + txt + '</div>'; }

  // Keep the drawer live: refresh when the board re-renders, if it's open.
  var _orig = window.renderGrid;
  if (typeof _orig === 'function') {
    window.renderGrid = function () {
      var rv = _orig.apply(this, arguments);
      var el = document.getElementById('opsDrawer');
      if (el && el.classList.contains('open')) { try { renderOpsCenter(); } catch (e) {} }
      return rv;
    };
  }
})();
