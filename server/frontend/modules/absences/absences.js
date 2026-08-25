/* TurniDSP — Absences module (Personale → Assenze)
 *
 * Full HR page over the existing /api/absences endpoints (list/create/update/
 * status/delete). Dashboard cards, filters, search, table with row actions
 * (edit / approve / reject / delete) and a create/edit modal.
 *
 * Loaded after the shared components; uses global TurniApi, toast, esc, fmt.
 */
(function () {
  'use strict';

  // absence_type is free text in the DB; these are the canonical buckets the
  // dashboard cards summarise. Matching is case-insensitive substring so
  // legacy values ("Ferie", "malattia lunga", "F") still land in a bucket.
  const ABS_TYPES = [
    { key: 'ferie',      label: 'Ferie',       icon: '🏖', match: ['ferie', 'holiday', 'f'],  color: 'var(--ok)' },
    { key: 'malattia',   label: 'Malattia',    icon: '🤒', match: ['malattia', 'sick', 'm'],  color: 'var(--bad)' },
    { key: 'infortunio', label: 'Infortunio',  icon: '🩹', match: ['infortunio', 'injury', 'i'], color: 'var(--warn)' },
    { key: 'permesso',   label: 'Permesso',    icon: '📄', match: ['permesso', 'permission', 'pr', 'ps'], color: 'var(--brand)' },
    { key: 'altro',      label: 'Altro',       icon: '📌', match: [],                          color: 'var(--text-muted)' },
  ];
  const STATUS_META = {
    pending:  { label: 'In attesa', cls: 'b-warn' },
    approved: { label: 'Approvata', cls: 'b-ok' },
    rejected: { label: 'Rifiutata', cls: 'b-bad' },
  };

  let _absAll = [];      // raw list from the API
  let _absEmployees = []; // employee lookup for names + the modal select
  let _absInited = false;
  let _absEditId = null;
  let _absSearchTimer = null;
  let _absView = 'table';                    // 'table' | 'calendar'
  let _absSort = { key: 'start', dir: -1 };  // table sort (export only; DataTable owns UI sort)
  let _absSel = {};                          // selected absence ids (bulk), mirrored from DataTable
  let _absCalMonth = null;                    // calendar cursor 'YYYY-MM'
  let _absDt = null;                          // shared DataTable instance
  let _absModalSnap = '';                     // modal field signature at open (unsaved-changes guard)
  let _absEmpAc = null;                        // employee searchable autocomplete instance
  // Standard annual vacation entitlement (giorni) used to show a "remaining"
  // balance. There is no per-employee entitlement column in the DB, so this is a
  // sensible CCNL default; remaining = entitlement − ferie used this calendar year.
  const DEFAULT_FERIE = 26;
  const _absModalFields = ['absEmp', 'absType', 'absStart', 'absEnd', 'absNote'];
  function _absFormSig() { return _absModalFields.map((id) => { var e = document.getElementById(id); return e ? e.value : ''; }).join('|'); }

  function empObj(id) { return _absEmployees.find((x) => String(x.id) === String(id)) || null; }
  function initials(e) { return (((e && e.last_name) || '')[0] || '').toUpperCase() + (((e && e.first_name) || '')[0] || '').toUpperCase(); }
  // Contract working days ∩ [start,end] — reuses the employee work_days (0=Sun..6).
  function workingDaysIn(e, start, end) {
    if (!e || !e.work_days || !start || !end) return 0;
    var wd = e.work_days, n = 0, d = new Date(start);
    for (; d <= new Date(end); d.setDate(d.getDate() + 1)) {
      var g = d.getDay();
      if (wd.indexOf(g) >= 0 || (g === 0 && wd.indexOf(7) >= 0)) n++;
    }
    return n;
  }
  // Absences of an employee that overlap [start,end] (optionally excluding one id).
  function overlaps(empId, start, end, exceptId) {
    return _absAll.filter((a) => String(a.employee_id) === String(empId) && a.id !== exceptId &&
      String(a.start_date).slice(0, 10) <= end && String(a.end_date).slice(0, 10) >= start);
  }
  function usedDaysThisYear(empId, bucket) {
    var y = new Date().getFullYear(), tot = 0;
    _absAll.forEach((a) => {
      if (String(a.employee_id) !== String(empId)) return;
      if (absTypeBucket(a.absence_type) !== bucket) return;
      if (new Date(a.start_date).getFullYear() !== y) return;
      tot += daysBetween(a.start_date, a.end_date);
    });
    return tot;
  }
  // Scheduled shifts for an employee within a date range (reuses the Scheduler
  // state when the range is in the currently loaded month).
  function scheduledInRange(empId, start, end) {
    if (typeof state === 'undefined' || !state || !state.schedule || typeof YM === 'undefined') return null;
    var n = 0, any = false, d = new Date(start);
    for (; d <= new Date(end); d.setDate(d.getDate() + 1)) {
      var iso = d.toISOString().slice(0, 7);
      if (iso !== YM) continue;
      any = true;
      var c = (state.schedule[empId] || {})[d.getDate()];
      if (c && c.toUpperCase() !== 'OFF' && (typeof codeCls !== 'function' || (codeCls(c) !== 'off' && codeCls(c) !== 'mal'))) n++;
    }
    return any ? n : null;
  }

  function absTypeBucket(t) {
    const v = String(t || '').toLowerCase();
    for (const b of ABS_TYPES) {
      if (b.key === 'altro') continue;
      if (b.match.some((m) => v === m || v.includes(m))) return b.key;
    }
    return 'altro';
  }
  function daysBetween(a, b) {
    if (!a || !b) return 0;
    const d = Math.round((new Date(b) - new Date(a)) / 86400000) + 1;
    return d > 0 ? d : 0;
  }
  function empName(id) {
    const e = _absEmployees.find((x) => String(x.id) === String(id));
    return e ? `${e.last_name || ''} ${e.first_name || ''}`.trim() : ('#' + id);
  }

  // Entry point wired from the sidebar (go('assenze') → bootAbsences).
  async function bootAbsences() {
    const host = document.getElementById('sec-absences');
    if (!host) return;
    if (!_absInited) {
      _absInited = true;
      injectAbsCss();
      host.innerHTML = absShellHtml();
      wireAbsFilters();
      // Warn before navigating away with an unsaved absence in the modal.
      if (window.AppGuard) AppGuard.register('absence-modal', function () {
        var m = document.getElementById('absModal');
        return !!(m && m.classList.contains('on') && _absFormSig() !== _absModalSnap);
      });
    }
    await loadAbsences();
  }

  function injectAbsCss() {
    if (document.getElementById('abs-css')) return;
    const s = document.createElement('style');
    s.id = 'abs-css';
    s.textContent = `
      .abs-toolbar{display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap}
      .abs-spacer{flex:1}
      .abs-viewseg{display:inline-flex;border:1px solid var(--border);border-radius:8px;overflow:hidden}
      .abs-viewseg button{border:0;background:transparent;color:var(--text-muted);padding:7px 12px;cursor:pointer;font:inherit}
      .abs-viewseg button.on{background:var(--brand);color:#fff}
      .abs-bulkbar{display:flex;align-items:center;gap:8px;background:var(--surface-2,rgba(0,0,0,.04));border:1px solid var(--border);border-radius:8px;padding:4px 10px}
      .abs-bulkbar span{font-size:12px;color:var(--text-muted)}
      th.abs-sortable{cursor:pointer;user-select:none;white-space:nowrap}
      th.abs-sortable:hover{color:var(--brand)}
      tr.abs-selrow{background:color-mix(in srgb,var(--brand) 10%,transparent)}
      .abs-emp-sum{display:flex;align-items:center;gap:10px;background:var(--surface-2,rgba(0,0,0,.04));border:1px solid var(--border);border-radius:10px;padding:8px 12px}
      .abs-emp-av{width:38px;height:38px;border-radius:50%;background:var(--brand);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;flex:0 0 auto}
      .abs-emp-meta{flex:1;min-width:0}
      .abs-emp-used{display:flex;gap:10px;color:var(--text-muted)}
      .abs-calc{display:flex;gap:8px;flex-wrap:wrap}
      .abs-calc .badge,.badge.b-info{background:color-mix(in srgb,var(--brand) 15%,transparent);color:var(--brand)}
      .abs-cal-h{display:flex;align-items:center;justify-content:center;gap:14px;margin-bottom:10px}
      .abs-cal{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}
      .abs-cal-dow{text-align:center;font-size:11px;color:var(--text-muted);font-weight:600;padding:2px 0}
      .abs-cal-cell{min-height:78px;border:1px solid var(--border);border-radius:8px;padding:4px;display:flex;flex-direction:column;gap:3px}
      .abs-cal-empty{background:var(--surface-2,rgba(0,0,0,.03));border-style:dashed}
      .abs-cal-num{font-size:11px;color:var(--text-muted);font-weight:600}
      .abs-cal-item{font-size:11px;border-radius:4px;padding:2px 5px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .abs-cal-more{font-size:10px;color:var(--text-muted);text-align:center}
      /* Modal form — wider, cleaner two-column grid */
      .abs-form{display:grid;grid-template-columns:1fr 1fr;gap:14px 16px;margin-top:14px}
      .abs-form .abs-f-full{grid-column:1/-1}
      .abs-form .lbl{display:block;margin-bottom:5px}
      .abs-form .inp,.abs-form textarea.inp{width:100%}
      .abs-form input[type=date].inp{min-height:38px}
      .abs-form-actions{display:flex;align-items:center;gap:8px;margin-top:18px;padding-top:14px;border-top:1px solid var(--border)}
      .abs-emp-remain{margin-left:auto;text-align:right}
      .abs-emp-remain b{font-size:1.05rem}
      .abs-emp-remain.low b{color:var(--bad)}`;
    document.head.appendChild(s);
  }

  function absShellHtml() {
    return `
      <div class="page-head"><div class="page-title">🌴 Assenze</div>
        <button class="btn btn-primary" onclick="openAbsence()">＋ Nuova assenza</button>
      </div>
      <div class="kpi-grid" id="absCards" style="margin-bottom:16px"></div>
      <div class="card card-pad mb-4">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end">
          <div style="flex:1;min-width:180px"><label class="lbl">Cerca</label><input id="absfSearch" class="inp" placeholder="Nome, tipo, note…" autocomplete="off"></div>
          <div><label class="lbl">Dipendente</label><select id="absfEmp" class="sel" style="min-width:140px"></select></div>
          <div><label class="lbl">Tipo</label><select id="absfType" class="sel"><option value="">Tutti</option>${ABS_TYPES.map((t) => `<option value="${t.key}">${t.label}</option>`).join('')}</select></div>
          <div><label class="lbl">Stato</label><select id="absfStatus" class="sel"><option value="">Tutti</option><option value="pending">In attesa</option><option value="approved">Approvata</option><option value="rejected">Rifiutata</option></select></div>
          <div><label class="lbl">Filiale</label><select id="absfBranch" class="sel"><option value="">Tutte</option></select></div>
          <div><label class="lbl">Servizio</label><select id="absfService" class="sel"><option value="">Tutti</option></select></div>
          <div><label class="lbl">Mese</label><input id="absfMonth" type="month" class="inp"></div>
          <div><label class="lbl">&nbsp;</label><button class="btn btn-ghost sm" onclick="absClearFilters()" title="Azzera filtri">↺</button></div>
        </div>
      </div>
      <div class="abs-toolbar">
        <div class="abs-viewseg">
          <button id="absViewTable" class="on" onclick="absSetView('table')">☰ Tabella</button>
          <button id="absViewCal" onclick="absSetView('calendar')">🗓 Calendario</button>
        </div>
        <div id="absBulkBar" class="abs-bulkbar" style="display:none">
          <span id="absSelCount">0 selezionate</span>
          <button class="btn ghost sm" onclick="absBulk('approved')">✔ Approva</button>
          <button class="btn ghost sm" onclick="absBulk('rejected')">✖ Rifiuta</button>
          <button class="btn warn sm" onclick="absBulk('delete')">🗑 Elimina</button>
        </div>
        <span class="abs-spacer"></span>
        <button class="btn ghost sm" onclick="absExport()">⬇ Esporta CSV</button>
      </div>
      <div class="card card-pad" id="absBody"></div>`;
  }

  const ABS_FILTER_IDS = ['absfEmp', 'absfType', 'absfStatus', 'absfBranch', 'absfService', 'absfMonth', 'absfSearch'];
  // Persist the current filter values so they survive switching modules (AppStore).
  function _persistAbsFilters() {
    if (!window.AppStore) return;
    var v = {}; ABS_FILTER_IDS.forEach((id) => { var el = document.getElementById(id); if (el) v[id] = el.value; });
    AppStore.setView('absences', v);
  }
  // Re-apply saved filter values on (re)entry.
  function _restoreAbsFilters() {
    if (!window.AppStore) return;
    var v = AppStore.view('absences');
    ABS_FILTER_IDS.forEach((id) => { var el = document.getElementById(id); if (el && v[id] != null) el.value = v[id]; });
  }
  window.absClearFilters = function () {
    ABS_FILTER_IDS.forEach((id) => { var el = document.getElementById(id); if (el) el.value = ''; });
    _persistAbsFilters(); renderAbsences();
  };
  function wireAbsFilters() {
    ['absfEmp', 'absfType', 'absfStatus', 'absfBranch', 'absfService', 'absfMonth'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => { _persistAbsFilters(); renderAbsences(); });
    });
    const s = document.getElementById('absfSearch');
    if (s) s.addEventListener('input', () => {
      clearTimeout(_absSearchTimer);
      _absSearchTimer = setTimeout(() => { _persistAbsFilters(); renderAbsences(); }, 150);   // debounced (instant)
    });
    _restoreAbsFilters();
  }

  async function loadAbsences() {
    var body = document.getElementById('absBody');
    if (body && window.Skeleton && _absView === 'table') body.innerHTML = '<div style="overflow-x:auto">' + Skeleton.table(8, 8) + '</div>';
    try {
      const [abs, emps] = await Promise.all([
        TurniApi.absences({}),
        _absEmployees.length ? Promise.resolve({ rows: _absEmployees }) : TurniApi.employees({}),
      ]);
      _absAll = Array.isArray(abs) ? abs : (abs.rows || []);
      if (!_absEmployees.length) {
        _absEmployees = Array.isArray(emps) ? emps : (emps.rows || []);
        fillAbsEmpSelects();
      }
      renderAbsences();
    } catch (e) {
      const b = document.getElementById('absBody');
      if (b) b.innerHTML = `<div class="text-muted" style="padding:16px">Errore: ${esc(e.message)}</div>`;
    }
  }

  // Employee ID / branch / service accessors (tolerant of the API field names).
  function empCode(e) { return e && (e.employee_code || e.transporter_id || e.id) || ''; }
  function empBranchCode(e) { return e && (e.branch_code || e.branch) || ''; }
  function empServiceName(e) { return e && (e.service_name || e.service || e.service_type) || ''; }
  function empAcLabel(e) { return ((e.last_name || '') + ' ' + (e.first_name || '')).trim() || ('#' + empCode(e)); }
  function empAcSub(e) {
    return [empCode(e) ? '#' + empCode(e) : '', empBranchCode(e), empServiceName(e)].filter(Boolean).join(' · ');
  }
  // Search matches Name, Surname, Employee ID and Branch (per the UX spec).
  function empAcMatch(e, q) {
    var hay = [e.last_name, e.first_name, empCode(e), e.id, empBranchCode(e)].filter(Boolean).join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }
  function fillAbsEmpSelects() {
    const sorted = _absEmployees.slice().sort((a, b) => (a.last_name || '').localeCompare(b.last_name || ''));
    // Employee filter (kept as a select — filtering, not data entry).
    const opts = sorted.map((e) => `<option value="${e.id}">${esc((e.last_name || '') + ' ' + (e.first_name || ''))}</option>`).join('');
    const filter = document.getElementById('absfEmp');
    if (filter) filter.innerHTML = '<option value="">Tutti</option>' + opts;
    // Branch + Service filters — distinct values from the roster.
    const uniq = (arr) => Array.from(new Set(arr.filter(Boolean))).sort((a, b) => a.localeCompare(b));
    const brSel = document.getElementById('absfBranch');
    if (brSel) brSel.innerHTML = '<option value="">Tutte</option>' + uniq(_absEmployees.map(empBranchCode)).map((b) => `<option value="${esc(b)}">${esc(b)}</option>`).join('');
    const svSel = document.getElementById('absfService');
    if (svSel) svSel.innerHTML = '<option value="">Tutti</option>' + uniq(_absEmployees.map(empServiceName)).map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
    // Modal employee picker — searchable autocomplete.
    initAbsEmpAutocomplete();
    // Branch/Service options now exist → re-apply any persisted filter values.
    _restoreAbsFilters();
  }
  function initAbsEmpAutocomplete() {
    const host = document.getElementById('absEmpAc');
    if (!host || !window.Autocomplete) return;
    if (_absEmpAc) { _absEmpAc.setItems(_absEmployees); return; }
    _absEmpAc = Autocomplete({
      mount: host, items: _absEmployees, max: 40,
      placeholder: 'Cerca per nome, cognome, ID o filiale…',
      getId: (e) => e.id, getLabel: empAcLabel, getSublabel: empAcSub, filterFn: empAcMatch,
      onSelect: (e) => { document.getElementById('absEmp').value = e ? e.id : ''; absRefreshInfo(); },
    });
  }

  function _fv(id) { var el = document.getElementById(id); return el ? el.value : ''; }
  function filteredAbsences() {
    const fEmp = _fv('absfEmp'), fType = _fv('absfType'), fStatus = _fv('absfStatus');
    const fBranch = _fv('absfBranch'), fService = _fv('absfService'), fMonth = _fv('absfMonth');
    const q = _fv('absfSearch').toLowerCase().trim();
    return _absAll.filter((a) => {
      if (fEmp && String(a.employee_id) !== fEmp) return false;
      if (fType && absTypeBucket(a.absence_type) !== fType) return false;
      if (fStatus && (a.status || 'pending') !== fStatus) return false;
      if (fBranch || fService) {
        const e = empObj(a.employee_id);
        if (fBranch && empBranchCode(e) !== fBranch) return false;
        if (fService && empServiceName(e) !== fService) return false;
      }
      // Month filter = the absence overlaps the selected calendar month.
      if (fMonth) {
        const mStart = fMonth + '-01';
        const [my, mm] = fMonth.split('-').map(Number);
        const mEnd = fMonth + '-' + String(new Date(my, mm, 0).getDate()).padStart(2, '0');
        if (String(a.start_date).slice(0, 10) > mEnd || String(a.end_date).slice(0, 10) < mStart) return false;
      }
      if (q) {
        const e = empObj(a.employee_id);
        const hay = (empName(a.employee_id) + ' ' + empCode(e) + ' ' + empBranchCode(e) + ' ' + empServiceName(e) + ' ' + (a.absence_type || '') + ' ' + (a.note || '')).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function renderAbsences() {
    renderAbsCards();
    _syncBulkBar();
    document.getElementById('absViewTable').classList.toggle('on', _absView === 'table');
    document.getElementById('absViewCal').classList.toggle('on', _absView === 'calendar');
    if (_absView === 'calendar') return renderAbsCalendar();
    return renderAbsTable();
  }

  function sortedFiltered() {
    var rows = filteredAbsences().slice();
    var k = _absSort.key, dir = _absSort.dir;
    var val = { name: (a) => empName(a.employee_id).toLowerCase(), type: (a) => absTypeBucket(a.absence_type),
      start: (a) => String(a.start_date), end: (a) => String(a.end_date), days: (a) => daysBetween(a.start_date, a.end_date),
      status: (a) => a.status || 'pending' };
    var f = val[k] || val.start;
    rows.sort((a, b) => { var x = f(a), y = f(b); return (x > y ? 1 : x < y ? -1 : 0) * dir; });
    return rows;
  }
  // Column definitions for the shared DataTable component (sorting + pagination
  // + selection are handled by the component; these only describe the cells).
  const ABS_COLUMNS = [
    { key: 'name', label: 'Dipendente', sortable: true, sortValue: (a) => empName(a.employee_id).toLowerCase(),
      render: (a) => '<b>' + esc(empName(a.employee_id)) + '</b>' },
    { key: 'type', label: 'Tipo', sortable: true, sortValue: (a) => absTypeBucket(a.absence_type),
      render: (a) => { var b = ABS_TYPES.find((t) => t.key === absTypeBucket(a.absence_type)) || ABS_TYPES[4];
        return '<span class="badge" style="background:' + b.color + '22;color:' + b.color + '">' + (b.icon || '') + ' ' + esc(a.absence_type || '—') + '</span>'; } },
    { key: 'start', label: 'Inizio', sortable: true, sortValue: (a) => String(a.start_date), render: (a) => fmt(a.start_date) },
    { key: 'end', label: 'Fine', sortable: true, sortValue: (a) => String(a.end_date), render: (a) => fmt(a.end_date) },
    { key: 'days', label: 'Giorni', sortable: true, sortValue: (a) => daysBetween(a.start_date, a.end_date), render: (a) => daysBetween(a.start_date, a.end_date) },
    { key: 'status', label: 'Stato', sortable: true, sortValue: (a) => a.status || 'pending',
      render: (a) => { var st = STATUS_META[a.status || 'pending'] || STATUS_META.pending; return '<span class="badge ' + st.cls + '">' + st.label + '</span>'; } },
    { key: 'note', label: 'Note', sortable: true, sortValue: (a) => (a.note || '').toLowerCase(),
      render: (a) => '<span class="text-muted" style="display:inline-block;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom">' + esc(a.note || '—') + '</span>' },
  ];
  function ABS_ACTIONS(a) {
    var pending = (a.status || 'pending') === 'pending';
    return (pending ? '<button class="btn ghost sm" title="Approva" onclick="setAbsStatus(' + a.id + ',\'approved\')">✔</button>' +
      '<button class="btn ghost sm" title="Rifiuta" onclick="setAbsStatus(' + a.id + ',\'rejected\')">✖</button>' : '') +
      '<button class="btn ghost sm" title="Modifica" onclick="openAbsence(' + a.id + ')">✏️</button>' +
      '<button class="btn warn sm" title="Elimina" onclick="deleteAbs(' + a.id + ')">🗑</button>';
  }
  function renderAbsTable() {
    const body = document.getElementById('absBody'); if (!body) return;
    const rows = filteredAbsences();
    if (!_absDt) {
      _absDt = DataTable({
        mount: body, scope: 'absences', columns: ABS_COLUMNS, rowId: (a) => a.id,
        pageSize: 25, selectable: true, rowActions: ABS_ACTIONS,
        empty: 'Nessuna assenza trovata.', data: rows,
        onSelect: (ids) => { _absSel = {}; ids.forEach((id) => { _absSel[id] = true; }); _syncBulkBar(); },
      });
    } else {
      _absDt.setData(rows);
    }
  }

  // Month calendar, absences color-coded by type bucket.
  function renderAbsCalendar() {
    const body = document.getElementById('absBody'); if (!body) return;
    if (!_absCalMonth) _absCalMonth = (typeof YM !== 'undefined' && YM) ? YM : new Date().toISOString().slice(0, 7);
    const [y, m] = _absCalMonth.split('-').map(Number);
    const rows = filteredAbsences();
    const first = new Date(y, m - 1, 1), dim = new Date(y, m, 0).getDate(), lead = first.getDay();
    const mName = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'][m - 1];
    // absences covering each day
    const byDay = {};
    rows.forEach((a) => {
      var s = new Date(String(a.start_date).slice(0, 10)), e = new Date(String(a.end_date).slice(0, 10));
      for (var d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
        if (d.getFullYear() === y && d.getMonth() === m - 1) { (byDay[d.getDate()] = byDay[d.getDate()] || []).push(a); }
      }
    });
    let h = `<div class="abs-cal-h"><button class="btn ghost sm" onclick="absCalNav(-1)">‹</button>
      <b>${mName} ${y}</b><button class="btn ghost sm" onclick="absCalNav(1)">›</button></div>
      <div class="abs-cal"><div class="abs-cal-dow">Dom</div><div class="abs-cal-dow">Lun</div><div class="abs-cal-dow">Mar</div><div class="abs-cal-dow">Mer</div><div class="abs-cal-dow">Gio</div><div class="abs-cal-dow">Ven</div><div class="abs-cal-dow">Sab</div>`;
    for (var i = 0; i < lead; i++) h += `<div class="abs-cal-cell abs-cal-empty"></div>`;
    for (var day = 1; day <= dim; day++) {
      var items = byDay[day] || [];
      h += `<div class="abs-cal-cell"><div class="abs-cal-num">${day}</div>` +
        items.slice(0, 4).map((a) => { var b = ABS_TYPES.find((t) => t.key === absTypeBucket(a.absence_type)) || ABS_TYPES[4];
          return `<div class="abs-cal-item" style="background:${b.color}22;color:${b.color};border-left:3px solid ${b.color}" title="${esc(empName(a.employee_id) + ' · ' + a.absence_type)}" onclick="openAbsence(${a.id})">${b.icon || ''} ${esc(empName(a.employee_id).split(' ')[0])}</div>`; }).join('') +
        (items.length > 4 ? `<div class="abs-cal-more">+${items.length - 4}</div>` : '') + `</div>`;
    }
    body.innerHTML = h + `</div>`;
  }

  function renderAbsCards() {
    const el = document.getElementById('absCards');
    if (!el) return;
    const today = new Date().toISOString().slice(0, 10);
    const isApproved = (a) => (a.status || 'pending') === 'approved';
    let absentToday = 0, pending = 0, ferie = 0, malattia = 0, infortunio = 0;
    _absAll.forEach((a) => {
      const b = absTypeBucket(a.absence_type);
      if (isApproved(a) && String(a.start_date).slice(0, 10) <= today && String(a.end_date).slice(0, 10) >= today) absentToday++;
      if ((a.status || 'pending') === 'pending') pending++;
      if (b === 'ferie') ferie++; if (b === 'malattia') malattia++; if (b === 'infortunio') infortunio++;
    });
    const card = (val, label, cls, filter) => `<div class="kpi-card ${cls || ''}" ${filter ? `style="cursor:pointer" onclick="absCardFilter('${filter}')"` : ''}><div class="kpi-val">${val}</div><div class="kpi-label">${label}</div></div>`;
    el.innerHTML =
      card(absentToday, 'Assenti oggi', 'pri') +
      card(pending, 'Da approvare', 'warn', 'status:pending') +
      card(ferie, 'Ferie', 'ok', 'type:ferie') +
      card(malattia, 'Malattia', 'bad', 'type:malattia') +
      card(infortunio, 'Infortuni', 'warn', 'type:infortunio');
  }
  window.absCardFilter = function (f) {
    var p = f.split(':');
    var el = document.getElementById(p[0] === 'status' ? 'absfStatus' : 'absfType');
    if (el) { el.value = p[1]; renderAbsences(); }
  };

  // ── View toggle / selection / bulk / export / calendar nav ──
  // Sorting + row/all selection are owned by the shared DataTable; these shims
  // remain for backward-compatibility and to drive selection from elsewhere.
  window.absSetView = function (v) { _absView = v; renderAbsences(); };
  window.absSelAll = function (on) { if (_absDt) _absDt.selectAll(on); };
  function _syncBulkBar() {
    var n = Object.keys(_absSel).length, bar = document.getElementById('absBulkBar');
    if (bar) { bar.style.display = n ? 'flex' : 'none'; var c = document.getElementById('absSelCount'); if (c) c.textContent = n + (n === 1 ? ' selezionata' : ' selezionate'); }
  }
  window.absBulk = async function (action) {
    var ids = Object.keys(_absSel).map(Number);
    if (!ids.length) return;
    if (action === 'delete' && !confirmAbs('Eliminare ' + ids.length + ' assenze selezionate?')) return;
    try {
      for (var i = 0; i < ids.length; i++) {
        if (action === 'delete') { await TurniApi.deleteAbsence(ids[i]); _absAll = _absAll.filter((x) => x.id !== ids[i]); }
        else { var u = await TurniApi.setAbsenceStatus(ids[i], action); var j = _absAll.findIndex((x) => x.id === ids[i]); if (j >= 0) _absAll[j] = u; }
      }
      _absSel = {}; if (_absDt) _absDt.clearSelection(); renderAbsences();
      // Scheduler/dashboard/reports auto-refresh via the API event bus (wire.js).
      toast(ids.length + ' assenze aggiornate', 'ok');
    } catch (e) { toast('Errore: ' + e.message, 'bad'); }
  };
  window.absExport = function () {
    var rows = sortedFiltered();
    var head = ['Dipendente', 'Tipo', 'Inizio', 'Fine', 'Giorni', 'Stato', 'Note'];
    var lines = [head.join(';')].concat(rows.map((a) => [empName(a.employee_id), a.absence_type, String(a.start_date).slice(0, 10), String(a.end_date).slice(0, 10), daysBetween(a.start_date, a.end_date), (STATUS_META[a.status || 'pending'] || {}).label || '', (a.note || '').replace(/[;\n]/g, ' ')].join(';')));
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = 'assenze.csv'; a.click(); URL.revokeObjectURL(a.href);
  };
  window.absCalNav = function (dir) {
    var [y, m] = _absCalMonth.split('-').map(Number); m += dir; if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
    _absCalMonth = y + '-' + String(m).padStart(2, '0'); renderAbsCalendar();
  };

  // ── Row actions ──────────────────────────────────────────────────
  window.setAbsStatus = async function (id, status) {
    try {
      const updated = await TurniApi.setAbsenceStatus(id, status);
      const i = _absAll.findIndex((a) => a.id === id);
      if (i >= 0) _absAll[i] = updated;
      renderAbsences();
      if (typeof syncSchedulerFromDB === 'function') syncSchedulerFromDB();
      toast(status === 'approved' ? 'Assenza approvata' : 'Assenza rifiutata', 'ok');
    } catch (e) { toast('Errore: ' + e.message, 'bad'); }
  };
  window.deleteAbs = async function (id) {
    const a = _absAll.find((x) => x.id === id);
    if (!confirmAbs(`Eliminare l'assenza di ${empName(a && a.employee_id)}?`)) return;
    try {
      await TurniApi.deleteAbsence(id);
      _absAll = _absAll.filter((x) => x.id !== id);
      renderAbsences();
      if (typeof syncSchedulerFromDB === 'function') syncSchedulerFromDB();
      toast('Assenza eliminata', 'ok');
    } catch (e) { toast('Errore: ' + e.message, 'bad'); }
  };
  // Lightweight confirm — keeps the "no browser alert for success" rule while
  // still guarding destructive actions. (A full modal-confirm component is a
  // later refactor; native confirm is used only for the irreversible delete.)
  function confirmAbs(msg) { return window.confirm(msg); }

  // ── Create / edit modal ──────────────────────────────────────────
  window.openAbsence = function (id) {
    _absEditId = id || null;
    const a = id ? _absAll.find((x) => x.id === id) : null;
    document.getElementById('absModalTitle').textContent = a ? 'Modifica assenza' : 'Nuova assenza';
    document.getElementById('absEmp').value = a ? a.employee_id : '';
    if (_absEmpAc) _absEmpAc.setValue(a ? a.employee_id : '');   // sync the autocomplete text
    document.getElementById('absType').value = a ? a.absence_type : 'Ferie';
    document.getElementById('absStart').value = a ? String(a.start_date).slice(0, 10) : '';
    document.getElementById('absEnd').value = a ? String(a.end_date).slice(0, 10) : '';
    document.getElementById('absNote').value = a ? (a.note || '') : '';
    document.getElementById('absModalMsg').textContent = '';
    document.getElementById('absModal').classList.add('on');
    absRefreshInfo();
    _absModalSnap = _absFormSig();     // baseline for the unsaved-changes guard
  };

  // Live employee summary + working/total day count + overlap check in the modal.
  window.absRefreshInfo = function () {
    const emp = empObj(document.getElementById('absEmp').value);
    const start = document.getElementById('absStart').value;
    const end = document.getElementById('absEnd').value;
    const type = document.getElementById('absType').value.trim();
    const bucket = type ? absTypeBucket(type) : null;
    const sumEl = document.getElementById('absEmpSummary');
    const calcEl = document.getElementById('absCalc');
    if (sumEl) {
      if (!emp) { sumEl.style.display = 'none'; }
      else {
        const bits = [];
        if (empBranchCode(emp)) bits.push('🏢 ' + esc(empBranchCode(emp)));
        if (empServiceName(emp)) bits.push('🛠 ' + esc(empServiceName(emp)));
        if (emp.contract_label || emp.contract_type) bits.push('📃 ' + esc(emp.contract_label || emp.contract_type));
        if (empCode(emp)) bits.push('🆔 ' + esc(empCode(emp)));
        const usedFerie = usedDaysThisYear(emp.id, 'ferie');
        const remain = DEFAULT_FERIE - usedFerie;
        sumEl.style.display = 'block';
        sumEl.innerHTML = `<div class="abs-emp-sum">
          <div class="abs-emp-av">${esc(initials(emp)) || '—'}</div>
          <div class="abs-emp-meta"><b>${esc(empName(emp.id))}</b><div class="text-xs text-muted">${bits.join(' · ') || 'Nessun dettaglio contratto'}</div>
            <div class="text-xs text-muted" title="Malattia registrata quest'anno">🤒 Malattia: ${usedDaysThisYear(emp.id, 'malattia')}gg quest'anno</div></div>
          <div class="abs-emp-remain ${remain <= 3 ? 'low' : ''}" title="Ferie residue stimate (${DEFAULT_FERIE}gg annui − ${usedFerie}gg usati)">
            <b>${remain}gg</b><div class="text-xs text-muted">ferie residue<br>di ${DEFAULT_FERIE} annui</div>
          </div></div>`;
      }
    }
    // Prevent invalid ranges at the picker level: end can't precede start.
    var sEl = document.getElementById('absStart'), eEl = document.getElementById('absEnd');
    if (sEl && eEl) { eEl.min = start || ''; sEl.max = end || ''; }
    if (calcEl) {
      if (!emp || !start || !end || end < start) { calcEl.style.display = 'none'; return; }
      const tot = daysBetween(start, end);
      const wd = emp.work_days ? workingDaysIn(emp, start, end) : null;
      const ov = overlaps(emp.id, start, end, _absEditId).length;
      const sched = scheduledInRange(emp.id, start, end);
      let h = `<div class="abs-calc"><span class="badge b-ok">${tot} gg totali</span>`;
      if (wd != null) h += `<span class="badge b-info">${wd} gg lavorativi</span>`;
      if (sched != null && sched > 0) h += `<span class="badge b-warn">⚠ ${sched} turni pianificati · sostituzione?</span>`;
      if (ov) h += `<span class="badge b-bad">⚠ ${ov} assenza${ov > 1 ? 'e' : ''} sovrapposta${ov > 1 ? 'e' : ''}</span>`;
      calcEl.style.display = 'block';
      calcEl.innerHTML = h + `</div>`;
    }
  };
  window.saveAbsence = async function () {
    const msg = document.getElementById('absModalMsg');
    const payload = {
      employee_id: +document.getElementById('absEmp').value || null,
      absence_type: document.getElementById('absType').value.trim(),
      start_date: document.getElementById('absStart').value,
      end_date: document.getElementById('absEnd').value,
      note: document.getElementById('absNote').value.trim() || null,
    };
    if (!payload.employee_id) { msg.textContent = 'Seleziona un dipendente'; return; }
    if (!payload.absence_type) { msg.textContent = 'Indica il tipo di assenza'; return; }
    if (!payload.start_date || !payload.end_date) { msg.textContent = 'Indica le date di inizio e fine'; return; }
    if (payload.end_date < payload.start_date) { msg.textContent = 'La data di fine precede quella di inizio'; return; }
    const ov = overlaps(payload.employee_id, payload.start_date, payload.end_date, _absEditId);
    if (ov.length && !confirmAbs('Attenzione: questo dipendente ha già ' + ov.length + ' assenza/e in questo periodo. Salvare comunque?')) return;
    try {
      let saved;
      if (_absEditId) { saved = await TurniApi.updateAbsence(_absEditId, payload);
        const i = _absAll.findIndex((x) => x.id === _absEditId); if (i >= 0) _absAll[i] = saved;
      } else { saved = await TurniApi.createAbsence(payload); _absAll.unshift(saved); }
      closeAll();
      renderAbsences();
      // Update the Scheduler + recalc totals immediately (server already
      // regenerated the affected employee's days before responding).
      if (typeof syncSchedulerFromDB === 'function') syncSchedulerFromDB();
      toast(_absEditId ? 'Assenza aggiornata' : 'Assenza creata', 'ok');
    } catch (e) { msg.textContent = e.message || 'Errore salvataggio'; }
  };

  window.bootAbsences = bootAbsences;
})();
