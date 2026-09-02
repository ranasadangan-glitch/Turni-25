/* TurniDSP — Operations Control Center · bottom panel
 * ---------------------------------------------------------------------------
 * Slide-up panel shown when an employee (or one of their cells) is selected.
 * Four sections per spec:
 *   Employee Details · Shift Details · Quick Actions · Activity Timeline.
 * Details/shift/actions are built instantly from the in-memory scheduler state;
 * the timeline (absences + recent schedule) is fetched from the profile API.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  var _curId = null, _curDay = null;

  function _ensure() {
    if (document.getElementById('opsBottom')) return;
    var d = document.createElement('div');
    d.id = 'opsBottom';
    d.className = 'ops-bottom';
    d.innerHTML =
      '<div class="opsb-head"><b id="opsbTitle">Dettaglio dipendente</b>' +
      '<button class="opsb-x" data-act-click="call" data-call="closeOpsBottom" title="Chiudi">✕</button></div>' +
      '<div class="opsb-grid">' +
      '<div class="opsb-col" id="opsbEmp"></div>' +
      '<div class="opsb-col" id="opsbShift"></div>' +
      '<div class="opsb-col" id="opsbActions"></div>' +
      '<div class="opsb-col opsb-timeline" id="opsbTimeline"></div>' +
      '</div>';
    document.body.appendChild(d);
  }

  window.closeOpsBottom = function () {
    var el = document.getElementById('opsBottom'); if (el) el.classList.remove('open');
    _curId = null; _curDay = null;
  };

  // Open for an employee; optional day highlights that cell's shift.
  window.openOpsBottom = function (id, day) {
    _ensure();
    _curId = id; _curDay = day != null ? day : ((typeof gridRefDay !== 'undefined') ? gridRefDay : 1);
    document.getElementById('opsBottom').classList.add('open');
    renderOpsBottom();
    // Async: activity timeline from the profile (absences + recent schedule).
    var tl = document.getElementById('opsbTimeline');
    tl.innerHTML = _h('📅 Attività') + "<div class='opsb-empty'>Caricamento…</div>";
    if (typeof TurniApi !== 'undefined' && TurniApi.employeeProfile) {
      TurniApi.employeeProfile(id).then(function (p) { if (_curId === id) _renderTimeline(p); })
        .catch(function () { if (_curId === id) tl.innerHTML = _h('📅 Attività') + "<div class='opsb-empty'>Non disponibile.</div>"; });
    }
  };

  window.renderOpsBottom = function () {
    if (_curId == null) return;
    _ensure();
    var dr = state.drivers.find(function (x) { return String(x.id) === String(_curId); });
    if (!dr) { closeOpsBottom(); return; }
    document.getElementById('opsbTitle').textContent = dr.cognome + ' ' + dr.nome + ' · #' + dr.id;

    // Employee details.
    var wd = (dr.workDays || []).map(function (n) { return ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'][n]; }).join(' ');
    document.getElementById('opsbEmp').innerHTML = _h('👤 Dipendente') +
      _kv('Filiale', esc(dr.filiale || '—')) +
      _kv('Servizio', esc(dr.service || '—')) +
      _kv('Contratto', esc(dr.contratto || '—') + ' · ' + esc(dr.ctrType || 'indet.')) +
      _kv('Giorni', esc(wd || '—')) +
      _kv('Scadenza', dr.expiry ? esc(dr.expiry) : '—') +
      _kv('Stato', "<span class='badge " + (dr.status === 'active' ? 'b-ok' : 'b-bad') + "'>" + esc(dr.status || '—') + '</span>') +
      (dr.transporterId ? _kv('Transporter', esc(dr.transporterId)) : '');

    // Shift details for the selected/reference day + month summary.
    var day = _curDay, code = getCode(dr.id, day);
    var days = (typeof gridDays !== 'undefined' && gridDays.length) ? gridDays : [];
    var worked = (typeof workedDays === 'function') ? workedDays(dr, days) : 0;
    var absN = 0, offN = 0;
    days.forEach(function (d) { var c = getCode(dr.id, d); if (!c) return; if (c.toUpperCase() === 'OFF') offN++; else if (codeCls(c) === 'mal' || codeCls(c) === 'abs') absN++; });
    var dLabel = (typeof dowName === 'function') ? (dowName(YM, day) + ' ' + fmtDM(YM, day)) : ('g' + day);
    document.getElementById('opsbShift').innerHTML = _h('🗓 Turno') +
      "<div class='opsb-day'>" + esc(dLabel) + ": <b>" + (code ? esc(codeLabel(code)) + " (" + esc(code) + ")" : 'nessun turno') + "</b></div>" +
      _kv('Giorni lavorati', worked) +
      _kv('Assenze (periodo)', absN) +
      _kv('Riposi OFF', offN);

    // Quick actions.
    document.getElementById('opsbActions').innerHTML = _h('⚡ Azioni rapide') +
      "<div class='opsb-btns'>" +
      "<button class='btn ghost sm' data-act-click='call' data-call='editEmployee' data-args='[" + dr.id + "]'>✏️ Modifica profilo</button>" +
      "<button class='btn ghost sm' data-act-click='call' data-call='openProfile' data-args='[" + dr.id + "]'>👤 Profilo completo</button>" +
      "<button class='btn ghost sm' data-act-click='call' data-call='go' data-args='[&quot;assenze&quot;]'>🌴 Gestisci assenze</button>" +
      "<button class='btn ghost sm' data-act-click='call' data-call='go' data-args='[&quot;documenti&quot;]'>📁 Documenti</button>" +
      '</div>';
  };

  function _renderTimeline(p) {
    var tl = document.getElementById('opsbTimeline');
    var items = [];
    (p.absences || []).forEach(function (a) {
      items.push({ date: a.start_date, txt: '🌴 ' + esc(a.absence_type) + ' → ' + String(a.end_date).slice(0, 10) + " <span class='badge " + (a.status === 'approved' ? 'b-ok' : a.status === 'rejected' ? 'b-bad' : 'b-warn') + "'>" + esc(a.status) + '</span>' });
    });
    (p.recent_schedules || []).slice(0, 6).forEach(function (s) {
      items.push({ date: s.work_date, txt: '🗓 ' + String(s.work_date).slice(0, 10) + ': ' + esc(s.shift_code || '—') });
    });
    (p.documents || []).forEach(function (dc) {
      items.push({ date: dc.expiry_date || dc.created_at, txt: '📄 ' + esc(dc.doc_type || 'documento') + (dc.expiry_date ? ' (scad. ' + String(dc.expiry_date).slice(0, 10) + ')' : '') });
    });
    items.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    tl.innerHTML = _h('📅 Attività') +
      (items.length ? items.slice(0, 8).map(function (i) { return "<div class='opsb-tl'>" + i.txt + '</div>'; }).join('')
        : "<div class='opsb-empty'>Nessuna attività recente.</div>");
  }

  function _h(t) { return "<div class='opsb-h'>" + t + '</div>'; }
  function _kv(k, v) { return "<div class='opsb-kv'><span>" + k + "</span><b>" + v + '</b></div>'; }

  // Keep it live while open.
  var _orig = window.renderGrid;
  if (typeof _orig === 'function') {
    window.renderGrid = function () {
      var rv = _orig.apply(this, arguments);
      var el = document.getElementById('opsBottom');
      if (el && el.classList.contains('open') && _curId != null) { try { renderOpsBottom(); } catch (e) {} }
      return rv;
    };
  }
})();
