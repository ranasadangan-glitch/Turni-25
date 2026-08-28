/* TurniDSP — Config screen (Workspace → Config) and Forecast editor.
 *
 * The merged app.html shipped a NEW config shell — a `.seg` of tab buttons
 * calling setCfgTab(...) that render into a single `#cfgBody` — but the
 * matching JS was never ported: setCfgTab() was undefined and the old
 * renderCfg() in scheduler.js still targeted elements (filList, svcsTbl,
 * cfgContrTbl, …) that no longer exist, so opening Config threw and every
 * tab button was dead.
 *
 * This file supplies the missing half: it overrides the global renderCfg()
 * with a version that renders the active tab into #cfgBody, and implements
 * add/edit/delete for Filiali, Codici (Legenda), Servizi, Contratti, plus a
 * Forecast editor. All config edits write to scheduler_config (the source of
 * truth) via TurniApi.schedulerImportConfig; the backend re-derives
 * shift_codes/contract_types from there on each import.
 *
 * Loaded AFTER scheduler.js so its globals (CFG, filiali, contracts,
 * services, saveConfig, state, YM, daysInMonth, esc, toast, TurniApi) exist.
 */
(function () {
  'use strict';

  // Which code/contract/service row is being edited (null = the add form).
  const cfgEdit = { codes: null, contracts: null, services: null };
  let fcService = ''; // currently selected service key in the Forecast tab
  let fcMonth = '';   // YYYY-MM being edited — may differ from the planner's YM
  let fcBranch = '';  // filiale being edited — admin can assign forecast per branch
  let fcMap = null;   // {service_key:{day:qty}} for fcMonth/fcBranch; null = needs load
  let fcLoading = false;

  // The filiale whose forecast is currently being edited (defaults to the
  // planner's branch). Admin can switch it to assign forecast to any filiale.
  function fcCurBranch() { return fcBranch || cfgBranch(); }

  // Forecast data for an arbitrary month + branch. Reuse the planner's live
  // state only when it matches BOTH the planner's month and branch; otherwise
  // read from the DB on demand.
  async function fcLoadMonth(month, branch) {
    if (month === YM && branch === cfgBranch() && state && state.forecast) {
      return JSON.parse(JSON.stringify(state.forecast));
    }
    const list = await TurniApi.schedulerForecasts(month, branch);
    const map = {};
    (list || []).forEach((r) => {
      if (!map[r.service_key]) map[r.service_key] = {};
      map[r.service_key][r.day_of_month] = r.qty;
    });
    return map;
  }

  function cfgBranch() {
    return (typeof teamFiliale !== 'undefined' && teamFiliale) || (filiali()[0] || 'DLO1');
  }

  // Persist config to localStorage + scheduler_config (DB). Unlike saveConfig()
  // this always pushes to the DB with an explicit branch, so it works for an
  // admin who has no teamFiliale selected.
  function cfgPersist(msg) {
    try { localStorage.setItem('turniDSP_config', JSON.stringify(state.config)); } catch (e) {}
    if (typeof dirty === 'function') { try { dirty(); } catch (e) {} }
    if (typeof TurniApi !== 'undefined' && TurniApi.isLoggedIn && TurniApi.isLoggedIn()) {
      TurniApi.schedulerImportConfig(cfgBranch(), state.config)
        .then(() => { if (msg) toast(msg); })
        .catch((e) => toast('Salvato in locale (DB: ' + e.message + ')', 'warn'));
    } else if (msg) { toast(msg); }
    if (typeof renderLeg === 'function') { try { renderLeg(); } catch (e) {} }
  }

  function groupOptions(sel) {
    return (CFG().groups || []).map((g) =>
      "<option value='" + esc(g.cls) + "'" + (g.cls === sel ? ' selected' : '') + '>' + esc(g.name) + '</option>'
    ).join('');
  }
  function groupNameOf(cls) {
    const g = (CFG().groups || []).find((x) => x.cls === cls);
    return g ? g.name : cls;
  }

  // Jump straight from a Workspace sidebar item to a specific Config tab
  // (Forecast / Legenda / Filiale). Ensures the scheduler section + Config
  // view are active first, then opens the requested tab and highlights it.
  window.cfgJump = function (tab) {
    // Only switch top-level section if we aren't already on the Workspace —
    // calling navigate('scheduler') when already here re-renders the overview
    // and fights the board scroll below.
    var onSched = document.getElementById('sec-scheduler') &&
      document.getElementById('sec-scheduler').classList.contains('active');
    if (!onSched && typeof navigate === 'function') navigate('scheduler');
    if (typeof schedSetView === 'function') schedSetView('cfg');
    window.setCfgTab(tab);
    document.querySelectorAll('#sched-subnav .nav-item[data-cfg]').forEach(function (b) {
      b.classList.toggle('active', b.dataset.cfg === tab);
    });
    // Bring the Config board to the top of the scroll surface (it sits below
    // the always-on overview strip). Deferred so it runs after any layout the
    // section switch / tab render triggered.
    var board = document.getElementById('schedulerBoard');
    if (board) setTimeout(function () { board.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60);
  };

  // ── Tab switching ────────────────────────────────────────────────
  // Config now lives inside the Settings section (#cfgTabs + #cfgBody), with
  // an "Account" tab that shows the user-management cards (#settingsAccount)
  // and the rest driven by scheduler_config.
  const CFG_TAB_TITLES = {
    general: 'Impostazioni', account: 'Utenti', filiali: 'Filiali', codes: 'Legenda', services: 'Servizi',
    contracts: 'Contratti', forecast: 'Forecast (dati)', rules: 'Contratti · Regole turni', io: 'Importa / Esporta',
  };
  window.setCfgTab = function (t) {
    if (typeof cfgTab !== 'undefined') { try { cfgTab = t; } catch (e) {} }
    document.querySelectorAll('#cfgTabs button').forEach((b) => {
      const oc = b.getAttribute('data-args') || b.getAttribute('onclick') || '';
      b.classList.toggle('on', oc.indexOf('"' + t + '"') >= 0 || oc.indexOf("'" + t + "'") >= 0);
    });
    const st = document.getElementById('cfgSectionTitle');
    if (st) st.textContent = CFG_TAB_TITLES[t] || t;
    const account = document.getElementById('settingsAccount');
    const body = document.getElementById('cfgBody');
    if (t === 'account') {
      if (account) account.style.display = '';
      if (body) body.style.display = 'none';
      if (typeof loadUsers === 'function') { try { loadUsers(); } catch (e) {} }
      return;
    }
    if (account) account.style.display = 'none';
    if (body) body.style.display = '';
    renderCfgTab(t);
  };

  // Override the old global renderCfg so any legacy caller (scheduler
  // refreshAll / setView('cfg')) is a safe no-op unless a config tab is
  // actually visible in Settings.
  window.renderCfg = function () {
    const body = document.getElementById('cfgBody');
    if (!body || body.style.display === 'none') return;
    renderCfgTab((typeof cfgTab !== 'undefined' && cfgTab) || 'filiali');
  };

  function renderCfgTab(t) {
    const body = document.getElementById('cfgBody');
    if (!body) return;
    if (t === 'general') return renderSettingsHub(body);
    if (t === 'filiali') return renderFiliali(body);
    if (t === 'codes') return renderCodes(body);
    if (t === 'services') return renderServices(body);
    if (t === 'contracts') return renderContracts(body);
    if (t === 'forecast') return renderForecastEditor(body);
    if (t === 'rules') return renderRules(body);
    if (t === 'io') return renderImportExport(body);
    if (t === 'counters' || t === 'users') {
      body.innerHTML = "<p class='note' style='color:var(--muted)'>Sezione «" + esc(t) +
        "» non ancora disponibile in questa vista.</p>";
      return;
    }
    renderFiliali(body);
  }

  // ── Settings hub (Impostazioni landing) ─────────────────────────
  // A clean card overview linking to each configuration area — reuses the
  // existing routes (go('<key>')), no new pages, no new persistence.
  function renderSettingsHub(body) {
    var cards = [
      { ic: '👥', t: 'Utenti', d: 'Gestione utenti e accessi', go: 'utenti' },
      { ic: '🔐', t: 'Ruoli & Permessi', d: 'Ruoli e autorizzazioni', go: 'ruoli' },
      { ic: '🏢', t: 'Filiali', d: 'Sedi operative DSP', go: 'sedi' },
      { ic: '🔖', t: 'Servizi', d: 'Catalogo servizi e mezzi', go: 'servizi' },
      { ic: '🎨', t: 'Codici', d: 'Legenda codici turno', go: 'legenda' },
      { ic: '📄', t: 'Contratti', d: 'Tipi di contratto', go: 'contratti-cfg' },
      { ic: '⚙️', t: 'Regole turni', d: 'Auto-pianificazione', go: 'regole' },
      { ic: '📊', t: 'Forecast (dati)', d: 'Dati forecast mensili', go: 'forecast-cfg' },
      { ic: '⬇', t: 'Importa / Esporta', d: 'Import/export Excel', go: 'esportazioni' }
    ];
    body.innerHTML =
      "<div class='set-hub-h'>Configurazione della piattaforma. Seleziona un'area da gestire.</div>" +
      "<div class='set-hub'>" + cards.map(function (c) {
        return "<button class='set-card'" + actAttr('click', 'go', [c.go]) + "><span class='set-ic'>" + c.ic + "</span>" +
          "<span class='set-nm'>" + esc(c.t) + "</span><span class='set-d'>" + esc(c.d) + "</span></button>";
      }).join('') + "</div>";
  }

  // ── Shared config-management chrome (reused by Branches/Services/Codes) ──
  // Search + status filter + sortable columns + table/card view + stat chips.
  // State per tab; handlers just mutate it and re-render the current tab.
  var _mgr = {};
  function _ms(k) { if (!_mgr[k]) _mgr[k] = { q: '', view: 'table', sort: -1, dir: 1, filter: {} }; return _mgr[k]; }
  window.cfgMgrSearch = function (k, v) { _ms(k).q = v; renderCfgTab(cfgTab); var el = document.getElementById('mgrSearch_' + k); if (el) { el.focus(); var x = el.value; el.value = ''; el.value = x; } };
  window.cfgMgrView = function (k, v) { _ms(k).view = v; renderCfgTab(cfgTab); };
  window.cfgMgrSort = function (k, i) { var s = _ms(k); if (s.sort === i) s.dir = -s.dir; else { s.sort = i; s.dir = 1; } renderCfgTab(cfgTab); };
  window.cfgMgrFilter = function (k, fid, v) { _ms(k).filter[fid] = v; renderCfgTab(cfgTab); };

  function _statusChip(st) { var on = st !== 'inactive'; return "<span class='mgr-status " + (on ? 'on' : 'off') + "'>" + (on ? 'Attivo' : 'Inattivo') + "</span>"; }
  function _toolbar(k, stats, filters, addLabel, addFn, addArgs) {
    var s = _ms(k);
    var h = "<div class='mgr-stats'>" + stats.map(function (x) { return "<div class='mgr-stat " + (x.cls || '') + "'><b>" + x.v + "</b><span>" + esc(x.l) + "</span></div>"; }).join('') + "</div>";
    h += "<div class='mgr-toolbar'><div class='mgr-search'><span>🔍</span><input id='mgrSearch_" + k + "' value=\"" + esc(s.q) + "\" placeholder='Cerca…'" + actAttr('input', 'cfgMgrSearch', [k, '@value']) + "></div>";
    (filters || []).forEach(function (f) {
      h += "<select class='sel mgr-fsel'" + actAttr('change', 'cfgMgrFilter', [k, f.id, '@value']) + "><option value=''>" + esc(f.label) + "</option>" +
        f.opts.map(function (o) { return "<option value='" + esc(o.v) + "'" + (s.filter[f.id] === o.v ? ' selected' : '') + '>' + esc(o.l) + '</option>'; }).join('') + "</select>";
    });
    h += "<span class='mgr-spacer'></span><div class='mgr-views'>" +
      "<button class='" + (s.view === 'table' ? 'on' : '') + "'" + actAttr('click', 'cfgMgrView', [k, 'table']) + " title='Tabella'>☰</button>" +
      "<button class='" + (s.view === 'card' ? 'on' : '') + "'" + actAttr('click', 'cfgMgrView', [k, 'card']) + " title='Card'>▦</button></div>";
    if (addFn) h += "<button class='btn btn-primary sm'" + actAttr('click', addFn, addArgs) + ">+ " + esc(addLabel) + "</button>";
    h += "</div>";
    return h;
  }
  function _applyList(k, items, searchOf, filters) {
    var s = _ms(k), q = (s.q || '').toLowerCase();
    var out = items.map(function (it, idx) { return { it: it, idx: idx }; });
    if (q) out = out.filter(function (x) { return (searchOf(x.it) || '').toLowerCase().indexOf(q) >= 0; });
    (filters || []).forEach(function (f) { var v = s.filter[f.id]; if (v) out = out.filter(function (x) { return f.test(x.it, v); }); });
    return out;
  }
  function _view(k, list, columns, cardOf, actions) {
    var s = _ms(k);
    if (s.sort >= 0 && columns[s.sort] && columns[s.sort].sortVal) {
      var sv = columns[s.sort].sortVal;
      list.sort(function (a, b) { var x = sv(a.it), y = sv(b.it); return (x > y ? 1 : x < y ? -1 : 0) * s.dir; });
    }
    if (s.view === 'card') {
      if (!list.length) return "<div class='mgr-empty'>Nessun risultato.</div>";
      return "<div class='mgr-cards'>" + list.map(function (x) { return "<div class='mgr-card'>" + cardOf(x.it) + "<div class='mgr-card-act'>" + actions(x.it, x.idx) + "</div></div>"; }).join('') + "</div>";
    }
    var h = "<div class='mgr-tblwrap'><table class='mgr-tbl'><thead><tr>";
    columns.forEach(function (c, i) { h += "<th" + (c.sortVal ? " class='sortable'" + actAttr('click', 'cfgMgrSort', [k, i]) : '') + '>' + esc(c.label) + (s.sort === i ? (s.dir > 0 ? ' ▲' : ' ▼') : '') + '</th>'; });
    h += "<th></th></tr></thead><tbody>";
    if (!list.length) h += "<tr><td colspan='" + (columns.length + 1) + "' class='mgr-empty'>Nessun risultato.</td></tr>";
    list.forEach(function (x) { h += '<tr>'; columns.forEach(function (c) { h += '<td>' + c.val(x.it) + '</td>'; }); h += "<td class='mgr-act'>" + actions(x.it, x.idx) + '</td></tr>'; });
    return h + '</tbody></table></div>';
  }

  // ── Branches (Filiali) ───────────────────────────────────────────
  // filiali() stays the array of CODES (no consumer breaks); rich fields live in
  // the existing config.filDetails[code] = {name,station,manager,status,notes}.
  function _fdet(code) { var fd = CFG().filDetails || (CFG().filDetails = {}); return fd[code] || (fd[code] = {}); }
  function _empCount(code) { return (state.drivers || []).filter(function (d) { return d.filiale === code; }).length; }
  function renderFiliali(body) {
    var items = filiali().map(function (code) { var d = _fdet(code); return { code: code, name: d.name || '', station: d.station || '', manager: d.manager || '', status: d.status || 'active', notes: d.notes || '', emp: _empCount(code) }; });
    var active = items.filter(function (x) { return x.status !== 'inactive'; }).length;
    var totEmp = items.reduce(function (a, x) { return a + x.emp; }, 0);
    var stats = [{ v: items.length, l: 'Filiali' }, { v: active, l: 'Attive', cls: 'ok' }, { v: items.length - active, l: 'Inattive', cls: 'muted' }, { v: totEmp, l: 'Dipendenti' }];
    var filters = [{ id: 'status', label: 'Stato', opts: [{ v: 'active', l: 'Attive' }, { v: 'inactive', l: 'Inattive' }], test: function (it, v) { return (it.status || 'active') === v; } }];
    var searchOf = function (it) { return [it.code, it.name, it.station, it.manager, it.notes].join(' '); };
    var columns = [
      { label: 'Codice', val: function (it) { return "<b>" + esc(it.code) + "</b>"; }, sortVal: function (it) { return it.code; } },
      { label: 'Nome', val: function (it) { return esc(it.name || '—'); }, sortVal: function (it) { return (it.name || '').toLowerCase(); } },
      { label: 'Station', val: function (it) { return esc(it.station || '—'); }, sortVal: function (it) { return it.station; } },
      { label: 'Responsabile', val: function (it) { return esc(it.manager || '—'); }, sortVal: function (it) { return it.manager; } },
      { label: 'Dipendenti', val: function (it) { return "<span class='mgr-badge'>" + it.emp + "</span>"; }, sortVal: function (it) { return it.emp; } },
      { label: 'Stato', val: function (it) { return _statusChip(it.status); }, sortVal: function (it) { return it.status; } }
    ];
    var actions = function (it) {
      return "<button class='btn ghost sm' " + actAttr('click','cfgEditFil',[it.code]) + " title='Modifica'>✏️</button> " +
        "<button class='btn ghost sm' " + actAttr('click','cfgToggleFil',[it.code]) + " title='Attiva/Disattiva'>" + (it.status === 'inactive' ? '▶' : '⏸') + "</button> " +
        "<button class='btn warn sm' " + actAttr('click','cfgDelFil',[it.code]) + " title='Elimina'>🗑</button>";
    };
    var card = function (it) {
      return "<div class='mgr-card-h'><b>" + esc(it.code) + "</b>" + _statusChip(it.status) + "</div>" +
        "<div class='mgr-card-nm'>" + esc(it.name || '—') + "</div>" +
        "<div class='mgr-card-meta'><span>🏢 " + esc(it.station || '—') + "</span><span>👤 " + esc(it.manager || '—') + "</span><span>👥 " + it.emp + "</span></div>" +
        (it.notes ? "<div class='mgr-card-note'>" + esc(it.notes) + "</div>" : '');
    };
    var list = _applyList('filiali', items, searchOf, filters);
    body.innerHTML = _filForm() + _toolbar('filiali', stats, filters, 'Filiale', 'cfgEditFil', ['']) +
      _view('filiali', list, columns, card, actions);
  }
  function _filForm() {
    var editing = cfgEdit.filiali;   // code string, '' = add, null = closed
    if (editing == null) return '';
    var isNew = editing === '';
    var d = isNew ? {} : _fdet(editing);
    var stations = Array.from(new Set(filiali().map(function (c) { return _fdet(c).station; }).filter(Boolean)));
    return "<div class='card card-pad mgr-form'><div class='section-title text-sm mb-2'>" + (isNew ? '➕ Nuova filiale' : '✏️ Modifica ' + esc(editing)) + "</div>" +
      "<div class='mgr-grid'>" +
      "<div><label class='lbl'>Codice *</label><input id='filCode' class='inp' value=\"" + esc(editing) + "\"" + (isNew ? " placeholder='es. DLO2'" : ' readonly') + "></div>" +
      "<div><label class='lbl'>Nome</label><input id='filName' class='inp' value=\"" + esc(d.name || '') + "\"></div>" +
      "<div><label class='lbl'>Station</label><input id='filStation' class='inp' list='filStationsL' value=\"" + esc(d.station || '') + "\"><datalist id='filStationsL'>" + stations.map(function (s) { return "<option>" + esc(s) + "</option>"; }).join('') + "</datalist></div>" +
      "<div><label class='lbl'>Responsabile</label><input id='filManager' class='inp' value=\"" + esc(d.manager || '') + "\"></div>" +
      "<div><label class='lbl'>Stato</label><select id='filStatus' class='sel'><option value='active'" + ((d.status || 'active') !== 'inactive' ? ' selected' : '') + ">Attivo</option><option value='inactive'" + (d.status === 'inactive' ? ' selected' : '') + ">Inattivo</option></select></div>" +
      "<div style='grid-column:1/-1'><label class='lbl'>Note</label><input id='filNotes' class='inp' value=\"" + esc(d.notes || '') + "\"></div>" +
      "</div><div style='margin-top:10px'><button class='btn btn-primary'" + actAttr('click','cfgSaveFil') + ">💾 Salva</button> <button class='btn btn-ghost'" + actAttr('click','cfgCancelEdit',['filiali']) + ">Annulla</button></div></div>";
  }
  window.cfgEditFil = function (code) { cfgEdit.filiali = code; renderCfgTab(cfgTab); };
  window.cfgSaveFil = function () {
    var code = (document.getElementById('filCode').value || '').trim().toUpperCase();
    if (!code) { toast('Il codice è obbligatorio'); return; }
    var isNew = cfgEdit.filiali === '';
    if (isNew && filiali().includes(code)) { toast('Filiale già presente', 'warn'); return; }
    if (isNew) CFG().filiali = filiali().concat([code]);
    var d = _fdet(code);
    d.name = (document.getElementById('filName').value || '').trim();
    d.station = (document.getElementById('filStation').value || '').trim();
    d.manager = (document.getElementById('filManager').value || '').trim();
    d.status = document.getElementById('filStatus').value || 'active';
    d.notes = (document.getElementById('filNotes').value || '').trim();
    cfgEdit.filiali = null;
    if (typeof logAction === 'function') logAction('Filiale salvata: ' + code);
    cfgPersist('Filiale ' + code + ' salvata');
    if (typeof refreshFilSelects === 'function') refreshFilSelects();
    renderCfgTab(cfgTab);
  };
  window.cfgToggleFil = function (code) { var d = _fdet(code); d.status = (d.status === 'inactive') ? 'active' : 'inactive'; cfgPersist('Stato filiale aggiornato'); renderCfgTab(cfgTab); };
  window.cfgDelFil = function (code) {
    var used = _empCount(code);
    if (!confirm(used ? 'La filiale ' + code + ' ha ' + used + ' dipendenti. Eliminarla comunque?' : 'Eliminare la filiale ' + code + '?')) return;
    var i = filiali().indexOf(code); if (i >= 0) filiali().splice(i, 1);
    if (CFG().filDetails) delete CFG().filDetails[code];
    cfgPersist('Filiale eliminata');
    if (typeof refreshFilSelects === 'function') refreshFilSelects();
    renderCfgTab(cfgTab);
  };
  window.cfgAddFiliale = function () {
    const el = document.getElementById('cfgFilNew');
    const v = (el.value || '').trim().toUpperCase();
    if (!v) { toast('Inserisci il nome'); return; }
    if (filiali().includes(v)) { toast('Filiale già presente', 'warn'); return; }
    CFG().filiali = filiali().concat([v]);
    if (typeof logAction === 'function') logAction('Filiale aggiunta: ' + v);
    cfgPersist('Filiale ' + v + ' aggiunta');
    if (typeof refreshFilSelects === 'function') refreshFilSelects();
    renderFiliali(document.getElementById('cfgBody'));
  };
  window.cfgDelFiliale = function (i) {
    const f = filiali()[i];
    const used = (state.drivers || []).filter((d) => d.filiale === f).length;
    if (!confirm(used ? 'La filiale ' + f + ' ha ' + used + ' DAS. Eliminarla comunque?' : 'Eliminare la filiale ' + f + '?')) return;
    filiali().splice(i, 1);
    cfgPersist('Filiale eliminata');
    if (typeof refreshFilSelects === 'function') refreshFilSelects();
    renderFiliali(document.getElementById('cfgBody'));
  };

  // ── Shift Codes (Legenda) ────────────────────────────────────────
  // Keeps {code,label,cls} (cls drives the Scheduler colour/grouping — untouched);
  // adds optional HR fields {category,paid,countsAsWork,requiresApproval,status}.
  var CAT_L = { work: 'Lavoro', leave: 'Permesso', vacation: 'Ferie', sick: 'Malattia', training: 'Formazione', other: 'Altro' };
  function _defCat(code, cls) {
    var c = (code || '').toUpperCase();
    if (c === 'F' || c === 'EXF') return 'vacation';
    if (c === 'M' || c === 'I' || c === 'AI') return 'sick';
    if (c === 'CORSO' || c === 'AFF') return 'training';
    if (cls === 'mal') return 'leave';
    if (cls === 'off' || cls === 'abs') return 'other';
    return 'work';
  }
  function _codeMeta(c) {
    var cat = c.category || _defCat(c.code, c.cls);
    return {
      category: cat,
      paid: c.paid != null ? !!c.paid : (cat !== 'other'),
      countsAsWork: c.countsAsWork != null ? !!c.countsAsWork : (cat === 'work'),
      requiresApproval: c.requiresApproval != null ? !!c.requiresApproval : (cat === 'leave' || cat === 'vacation'),
      status: c.status || 'active'
    };
  }
  function _yn(v) { return v ? "<span class='mgr-yes'>Sì</span>" : "<span class='mgr-no'>No</span>"; }
  function renderCodes(body) {
    var codes = CFG().codes || [];
    var byCat = {}; codes.forEach(function (c) { var m = _codeMeta(c); byCat[m.category] = (byCat[m.category] || 0) + 1; });
    var active = codes.filter(function (c) { return _codeMeta(c).status !== 'inactive'; }).length;
    var stats = [{ v: codes.length, l: 'Codici' }, { v: active, l: 'Attivi', cls: 'ok' }, { v: byCat.work || 0, l: 'Lavoro' }, { v: (byCat.vacation || 0) + (byCat.sick || 0) + (byCat.leave || 0), l: 'Assenze' }];
    var filters = [
      { id: 'category', label: 'Categoria', opts: Object.keys(CAT_L).map(function (k) { return { v: k, l: CAT_L[k] }; }), test: function (c, v) { return _codeMeta(c).category === v; } },
      { id: 'status', label: 'Stato', opts: [{ v: 'active', l: 'Attivi' }, { v: 'inactive', l: 'Inattivi' }], test: function (c, v) { return _codeMeta(c).status === v; } }
    ];
    var searchOf = function (c) { return [c.code, c.label, CAT_L[_codeMeta(c).category]].join(' '); };
    var chip = function (c) { return "<span class='chip' style='background:var(--" + esc(c.cls) + "-bg);color:var(--" + esc(c.cls) + ")'>" + esc(c.code) + "</span>"; };
    var columns = [
      { label: 'Codice', val: chip, sortVal: function (c) { return c.code; } },
      { label: 'Descrizione', val: function (c) { return esc(c.label); }, sortVal: function (c) { return (c.label || '').toLowerCase(); } },
      { label: 'Categoria', val: function (c) { return "<span class='mgr-tag'>" + CAT_L[_codeMeta(c).category] + "</span>"; }, sortVal: function (c) { return _codeMeta(c).category; } },
      { label: 'Retribuito', val: function (c) { return _yn(_codeMeta(c).paid); } },
      { label: 'Ore', val: function (c) { return _yn(_codeMeta(c).countsAsWork); } },
      { label: 'Approv.', val: function (c) { return _yn(_codeMeta(c).requiresApproval); } },
      { label: 'Stato', val: function (c) { return _statusChip(_codeMeta(c).status); }, sortVal: function (c) { return _codeMeta(c).status; } }
    ];
    var actions = function (c, i) {
      return "<button class='btn ghost sm'" + actAttr('click','cfgEditCode',[i]) + ">✏️</button> " +
        "<button class='btn ghost sm'" + actAttr('click','cfgToggleCode',[i]) + " title='Attiva/Disattiva'>" + (_codeMeta(c).status === 'inactive' ? '▶' : '⏸') + "</button> " +
        "<button class='btn warn sm'" + actAttr('click','cfgDelCode',[i]) + ">🗑</button>";
    };
    var card = function (c) {
      var m = _codeMeta(c);
      return "<div class='mgr-card-h'>" + chip(c) + _statusChip(m.status) + "</div>" +
        "<div class='mgr-card-nm'>" + esc(c.label) + "</div>" +
        "<div class='mgr-card-meta'><span class='mgr-tag'>" + CAT_L[m.category] + "</span></div>" +
        "<div class='mgr-card-flags'>" + (m.paid ? "<span>💶 Retribuito</span>" : "") + (m.countsAsWork ? "<span>⏱ Ore</span>" : "") + (m.requiresApproval ? "<span>✔ Approvazione</span>" : "") + "</div>";
    };
    var list = _applyList('codes', codes, searchOf, filters);
    body.innerHTML = _codeForm() + _toolbar('codes', stats, filters, 'Codice', 'cfgEditCode', [-1]) +
      _view('codes', list, columns, card, actions);
  }
  function _codeForm() {
    var editing = cfgEdit.codes;
    if (editing == null) return '';
    var isNew = editing === -1;
    var cur = isNew ? {} : (CFG().codes[editing] || {});
    var m = _codeMeta(cur);
    function chk(id, on, lbl) { return "<label class='mgr-chk'><input type='checkbox' id='" + id + "'" + (on ? ' checked' : '') + "> " + lbl + "</label>"; }
    return "<div class='card card-pad mgr-form'><div class='section-title text-sm mb-2'>" + (isNew ? '➕ Nuovo codice' : '✏️ Modifica ' + esc(cur.code)) + "</div>" +
      "<div class='mgr-grid'>" +
      "<div><label class='lbl'>Short code *</label><input id='cfgCodeCode' class='inp' value=\"" + esc(cur.code || '') + "\"" + (isNew ? '' : ' readonly') + "></div>" +
      "<div><label class='lbl'>Nome</label><input id='cfgCodeLabel' class='inp' value=\"" + esc(cur.label || '') + "\"></div>" +
      "<div><label class='lbl'>Colore / Gruppo</label><select id='cfgCodeCls' class='sel'>" + groupOptions(cur.cls || 'abs') + "</select></div>" +
      "<div><label class='lbl'>Categoria</label><select id='cfgCodeCat' class='sel'>" + Object.keys(CAT_L).map(function (k) { return "<option value='" + k + "'" + (m.category === k ? ' selected' : '') + '>' + CAT_L[k] + '</option>'; }).join('') + "</select></div>" +
      "<div><label class='lbl'>Stato</label><select id='cfgCodeStatus' class='sel'><option value='active'" + (m.status !== 'inactive' ? ' selected' : '') + ">Attivo</option><option value='inactive'" + (m.status === 'inactive' ? ' selected' : '') + ">Inattivo</option></select></div>" +
      "<div class='mgr-checks' style='grid-column:1/-1'>" + chk('cfgCodePaid', m.paid, 'Retribuito') + chk('cfgCodeWork', m.countsAsWork, 'Conta come ore lavorate') + chk('cfgCodeAppr', m.requiresApproval, 'Richiede approvazione') + "</div>" +
      "</div><div style='margin-top:10px'><button class='btn btn-primary'" + actAttr('click','cfgSaveCode') + ">💾 Salva</button> <button class='btn btn-ghost'" + actAttr('click','cfgCancelEdit',['codes']) + ">Annulla</button></div></div>";
  }
  window.cfgToggleCode = function (i) { var c = CFG().codes[i]; var m = _codeMeta(c); c.status = (m.status === 'inactive') ? 'active' : 'inactive'; cfgPersist('Stato codice aggiornato'); renderCfgTab(cfgTab); };
  window.cfgEditCode = function (i) { cfgEdit.codes = i; renderCfgTab(cfgTab); };
  window.cfgCancelEdit = function (which) { cfgEdit[which] = null; renderCfgTab(cfgTab); };
  window.cfgSaveCode = function () {
    const code = (document.getElementById('cfgCodeCode').value || '').trim();
    const label = (document.getElementById('cfgCodeLabel').value || '').trim();
    const cls = document.getElementById('cfgCodeCls').value;
    if (!code) { toast('Il codice è obbligatorio'); return; }
    const extra = {
      category: document.getElementById('cfgCodeCat').value,
      status: document.getElementById('cfgCodeStatus').value || 'active',
      paid: document.getElementById('cfgCodePaid').checked,
      countsAsWork: document.getElementById('cfgCodeWork').checked,
      requiresApproval: document.getElementById('cfgCodeAppr').checked
    };
    const codes = CFG().codes;
    const isNew = cfgEdit.codes === -1 || cfgEdit.codes == null;
    if (!isNew) {
      codes[cfgEdit.codes] = Object.assign({}, codes[cfgEdit.codes], { label: label || code, cls }, extra);
    } else {
      if (codes.some((c) => c.code.toLowerCase() === code.toLowerCase())) { toast('Codice già esistente', 'warn'); return; }
      codes.push(Object.assign({ code, label: label || code, cls }, extra));
    }
    cfgEdit.codes = null;
    cfgPersist('Codice salvato');
    renderCfgTab(cfgTab);
  };
  window.cfgDelCode = function (i) {
    const c = CFG().codes[i];
    if (!confirm('Eliminare il codice ' + c.code + '?')) return;
    CFG().codes.splice(i, 1);
    if (cfgEdit.codes === i) cfgEdit.codes = null;
    cfgPersist('Codice eliminato');
    renderCfgTab(cfgTab);
  };

  // ── Contratti ────────────────────────────────────────────────────
  function dayPickerHtml(sel) {
    sel = sel || [];
    return "<div class='chipsel' id='cfgCtrDays'>" + (typeof WEEKDAYS !== 'undefined' ? WEEKDAYS : [])
      .map((w) => "<button type='button' data-d='" + w.n + "' class='" + (sel.includes(w.n) ? 'on' : '') +
        "' " + actAttr('click','_toggleOn') + ">" + esc(w.l) + "</button>").join('') + "</div>";
  }
  // Contracts are defined by WORKING DAYS and HR rules, not hours:
  //   type       — Full time / Part time / Verticale
  //   workDays   — working days per week
  //   restDays   — consecutive rest days
  //   defDays    — allowed working days of the week (the day picker)
  const CTR_TYPES = [['full', 'Full time'], ['part', 'Part time'], ['vertical', 'Verticale']];
  const ctrTypeLabel = (t) => (CTR_TYPES.find((x) => x[0] === t) || [, 'Full time'])[1];
  const ctrWork = (c) => (c.workDays != null ? c.workDays : (c.defDays ? c.defDays.length : 0));
  const ctrRest = (c) => (c.restDays != null ? c.restDays : Math.max(0, 7 - ctrWork(c)));

  // Unified "Contratti" section sub-nav (spec §1): one menu entry that groups
  // contract types + work patterns + working days + settings (Tipi & Giorni),
  // the shift/contract rules (Regole turni) and the expiry monitor (Scadenze).
  function _contractsSubnav(active) {
    const b = (k, label, fn, args) => "<button class='" + (active === k ? 'on' : '') + "'" + actAttr('click', fn, args) + ">" + label + "</button>";
    return "<div class='seg' id='contractsSubnav' style='margin-bottom:14px'>" +
      b('types', 'Tipi &amp; Giorni', 'setCfgTab', ['contracts']) +
      b('rules', 'Regole turni', 'setCfgTab', ['rules']) +
      b('expiry', 'Scadenze', 'showSchedView', ['contr', 'Scadenze contratti']) +
      "</div>";
  }

  function renderContracts(body) {
    const list = contracts() || [];
    const cur = cfgEdit.contracts != null ? list[cfgEdit.contracts] : null;
    const rows = list.map((c, i) =>
      "<tr><td><b>" + esc(c.code) + "</b></td><td>" + esc(c.label) + "</td>" +
      "<td>" + esc(ctrTypeLabel(c.type)) + "</td>" +
      "<td style='text-align:center'>" + ctrWork(c) + "</td>" +
      "<td style='text-align:center'>" + ctrRest(c) + "</td>" +
      "<td style='font-size:.78rem'>" + (c.defDays || []).map((n) => ((typeof WEEKDAYS !== 'undefined' && WEEKDAYS.find((w) => w.n === n)) || {}).l || '').join(' ') + "</td>" +
      "<td style='text-align:right;white-space:nowrap'>" +
      "<button class='btn ghost sm'" + actAttr('click','cfgEditContract',[i]) + ">✏️</button> " +
      "<button class='btn warn sm'" + actAttr('click','cfgDelContract',[i]) + ">🗑</button></td></tr>"
    ).join('') || "<tr><td colspan='7' style='color:var(--muted)'>Nessun contratto.</td></tr>";
    body.innerHTML =
      _contractsSubnav('types') +
      "<div class='card card-pad' style='margin-bottom:14px'>" +
      "<div class='section-title text-sm mb-2'>" + (cur ? '✏️ Modifica contratto' : '➕ Nuovo contratto') + "</div>" +
      "<div style='display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end'>" +
      "<div><label class='lbl'>Codice</label><input id='cfgCtrCode' class='inp' style='max-width:120px' value=\"" + (cur ? esc(cur.code) : '') + "\"" + (cur ? ' readonly' : '') + "></div>" +
      "<div><label class='lbl'>Descrizione</label><input id='cfgCtrLabel' class='inp' style='min-width:180px' value=\"" + (cur ? esc(cur.label) : '') + "\"></div>" +
      "<div><label class='lbl'>Tipo</label><select id='cfgCtrType' class='sel'>" +
        CTR_TYPES.map(([v, l]) => "<option value='" + v + "'" + ((cur && cur.type === v) ? ' selected' : '') + ">" + l + "</option>").join('') + "</select></div>" +
      "<div><label class='lbl'>Giorni/sett.</label><input id='cfgCtrWork' class='inp' type='number' min='0' max='7' style='max-width:90px' value='" + (cur ? ctrWork(cur) : 5) + "'></div>" +
      "<div><label class='lbl'>Riposo consec.</label><input id='cfgCtrRest' class='inp' type='number' min='0' max='7' style='max-width:90px' value='" + (cur ? ctrRest(cur) : 2) + "'></div>" +
      "<div><label class='lbl'>Giorni consentiti</label>" + dayPickerHtml(cur ? cur.defDays : [1, 2, 3, 4, 5]) + "</div>" +
      "<button class='btn btn-primary'" + actAttr('click','cfgSaveContract') + ">💾 Salva</button>" +
      (cur ? "<button class='btn btn-ghost'" + actAttr('click','cfgCancelEdit',['contracts']) + ">Annulla</button>" : '') +
      "</div></div>" +
      "<table style='width:100%;border-collapse:collapse;font-size:.85rem'>" +
      "<thead><tr><th style='text-align:left'>Codice</th><th style='text-align:left'>Descrizione</th><th style='text-align:left'>Tipo</th><th>Giorni/sett.</th><th>Riposo</th><th style='text-align:left'>Giorni consentiti</th><th></th></tr></thead><tbody>" + rows + "</tbody></table>";
  }
  window.cfgEditContract = function (i) { cfgEdit.contracts = i; renderContracts(document.getElementById('cfgBody')); };
  function readDayPicker() {
    return [...document.querySelectorAll('#cfgCtrDays button.on')].map((b) => +b.dataset.d);
  }
  window.cfgSaveContract = function () {
    const code = (document.getElementById('cfgCtrCode').value || '').trim();
    const label = (document.getElementById('cfgCtrLabel').value || '').trim();
    const type = document.getElementById('cfgCtrType').value;
    const defDays = readDayPicker();
    const workDays = +document.getElementById('cfgCtrWork').value || defDays.length;
    const restDays = +document.getElementById('cfgCtrRest').value || Math.max(0, 7 - workDays);
    if (!code) { toast('Il codice è obbligatorio'); return; }
    const rec = { code, label: label || code, type, workDays, restDays, defDays };
    const list = contracts();
    if (cfgEdit.contracts != null) {
      rec.code = list[cfgEdit.contracts].code;
      list[cfgEdit.contracts] = rec;
    } else {
      if (list.some((c) => c.code.toLowerCase() === code.toLowerCase())) { toast('Contratto già esistente', 'warn'); return; }
      list.push(rec);
    }
    cfgEdit.contracts = null;
    cfgPersist('Contratto salvato');
    renderContracts(document.getElementById('cfgBody'));
  };
  window.cfgDelContract = function (i) {
    if (!confirm('Eliminare il contratto ' + contracts()[i].code + '?')) return;
    contracts().splice(i, 1);
    if (cfgEdit.contracts === i) cfgEdit.contracts = null;
    cfgPersist('Contratto eliminato');
    renderContracts(document.getElementById('cfgBody'));
  };

  // ── Servizi ──────────────────────────────────────────────────────
  // ── Services (Servizi) ───────────────────────────────────────────
  // Keeps {key,label,count,filiali}; adds optional {color,icon,defaultHours,
  // vehicleType,training,status}. Assigned-to-branches uses the existing .filiali.
  var VEHICLES = ['Furgone', 'Cargo Bike', 'Auto', 'Van XL', 'Nessuno'];
  function _svcMeta(s) { return { color: s.color || '', icon: s.icon || '📦', defaultHours: s.defaultHours != null ? s.defaultHours : '', vehicleType: s.vehicleType || '', training: s.training || '', status: s.status || 'active' }; }
  function renderServices(body) {
    var list0 = services() || [];
    var active = list0.filter(function (s) { return _svcMeta(s).status !== 'inactive'; }).length;
    var withVeh = list0.filter(function (s) { return _svcMeta(s).vehicleType; }).length;
    var stats = [{ v: list0.length, l: 'Servizi' }, { v: active, l: 'Attivi', cls: 'ok' }, { v: withVeh, l: 'Con mezzo' }, { v: filiali().length, l: 'Filiali' }];
    var filters = [
      { id: 'filiale', label: 'Filiale', opts: filiali().map(function (f) { return { v: f, l: f }; }), test: function (s, v) { return !s.filiali || !s.filiali.length || s.filiali.indexOf(v) >= 0; } },
      { id: 'status', label: 'Stato', opts: [{ v: 'active', l: 'Attivi' }, { v: 'inactive', l: 'Inattivi' }], test: function (s, v) { return _svcMeta(s).status === v; } }
    ];
    var searchOf = function (s) { return [s.key, s.label, (s.count || []).join(' ')].join(' '); };
    var name = function (s) { return "<span class='mgr-svc'><span class='mgr-ico'>" + esc(_svcMeta(s).icon) + "</span><span><b>" + esc(s.label) + "</b><br><small>" + esc(s.key) + "</small></span></span>"; };
    var columns = [
      { label: 'Servizio', val: name, sortVal: function (s) { return (s.label || '').toLowerCase(); } },
      { label: 'Codici', val: function (s) { return "<span class='mgr-codes'>" + (s.count || []).map(esc).join(', ') + "</span>"; } },
      { label: 'Filiali', val: function (s) { return (s.filiali && s.filiali.length) ? s.filiali.map(esc).join(', ') : "<i class='text-muted'>tutte</i>"; } },
      { label: 'Ore', val: function (s) { var h = _svcMeta(s).defaultHours; return h !== '' ? esc(h) + 'h' : '—'; }, sortVal: function (s) { return +_svcMeta(s).defaultHours || 0; } },
      { label: 'Mezzo', val: function (s) { return esc(_svcMeta(s).vehicleType || '—'); }, sortVal: function (s) { return _svcMeta(s).vehicleType; } },
      { label: 'Stato', val: function (s) { return _statusChip(_svcMeta(s).status); }, sortVal: function (s) { return _svcMeta(s).status; } }
    ];
    var actions = function (s, i) {
      return "<button class='btn ghost sm'" + actAttr('click','cfgEditService',[i]) + ">✏️</button> " +
        "<button class='btn ghost sm'" + actAttr('click','cfgToggleService',[i]) + " title='Attiva/Disattiva'>" + (_svcMeta(s).status === 'inactive' ? '▶' : '⏸') + "</button> " +
        "<button class='btn warn sm'" + actAttr('click','cfgDelService',[i]) + ">🗑</button>";
    };
    var card = function (s) {
      var m = _svcMeta(s);
      return "<div class='mgr-card-h'>" + name(s) + _statusChip(m.status) + "</div>" +
        "<div class='mgr-card-meta'><span>🏢 " + ((s.filiali && s.filiali.length) ? esc(s.filiali.join(', ')) : 'tutte') + "</span>" + (m.vehicleType ? "<span>🚐 " + esc(m.vehicleType) + "</span>" : '') + (m.defaultHours !== '' ? "<span>⏱ " + esc(m.defaultHours) + "h</span>" : '') + "</div>" +
        (m.training ? "<div class='mgr-card-note'>🎓 " + esc(m.training) + "</div>" : '') +
        "<div class='mgr-card-note mgr-codes'>" + (s.count || []).map(esc).join(', ') + "</div>";
    };
    var list = _applyList('services', list0, searchOf, filters);
    body.innerHTML = _svcForm() + _toolbar('services', stats, filters, 'Servizio', 'cfgEditService', [-1]) +
      _view('services', list, columns, card, actions);
  }
  function _svcForm() {
    var editing = cfgEdit.services;
    if (editing == null) return '';
    var isNew = editing === -1;
    var cur = isNew ? {} : (services()[editing] || {});
    var m = _svcMeta(cur);
    return "<div class='card card-pad mgr-form'><div class='section-title text-sm mb-2'>" + (isNew ? '➕ Nuovo servizio' : '✏️ Modifica ' + esc(cur.label || cur.key)) + "</div>" +
      "<div class='mgr-grid'>" +
      "<div><label class='lbl'>Key *</label><input id='cfgSvcKey' class='inp' value=\"" + esc(cur.key || '') + "\"" + (isNew ? '' : ' readonly') + "></div>" +
      "<div><label class='lbl'>Nome</label><input id='cfgSvcLabel' class='inp' value=\"" + esc(cur.label || '') + "\"></div>" +
      "<div><label class='lbl'>Icona</label><input id='cfgSvcIcon' class='inp' maxlength='3' value=\"" + esc(m.icon) + "\"></div>" +
      "<div><label class='lbl'>Ore predefinite</label><input id='cfgSvcHours' class='inp' type='number' min='0' step='0.5' value=\"" + esc(m.defaultHours) + "\"></div>" +
      "<div><label class='lbl'>Tipo mezzo</label><input id='cfgSvcVeh' class='inp' list='cfgVehL' value=\"" + esc(m.vehicleType) + "\"><datalist id='cfgVehL'>" + VEHICLES.map(function (v) { return "<option>" + esc(v) + "</option>"; }).join('') + "</datalist></div>" +
      "<div><label class='lbl'>Formazione richiesta</label><input id='cfgSvcTrain' class='inp' value=\"" + esc(m.training) + "\"></div>" +
      "<div><label class='lbl'>Stato</label><select id='cfgSvcStatus' class='sel'><option value='active'" + (m.status !== 'inactive' ? ' selected' : '') + ">Attivo</option><option value='inactive'" + (m.status === 'inactive' ? ' selected' : '') + ">Inattivo</option></select></div>" +
      "<div><label class='lbl'>Codici conteggiati</label><select id='cfgSvcCount' class='sel w-full' multiple size='5'>" + multiOpts(allCodeList(), cur.count || []) + "</select></div>" +
      "<div><label class='lbl'>Filiali <small class='text-muted'>(vuoto = tutte)</small></label><select id='cfgSvcFil' class='sel w-full' multiple size='5'>" + multiOpts(filiali(), cur.filiali || []) + "</select></div>" +
      "</div><div style='margin-top:10px'><button class='btn btn-primary'" + actAttr('click','cfgSaveService') + ">💾 Salva</button> <button class='btn btn-ghost'" + actAttr('click','cfgCancelEdit',['services']) + ">Annulla</button></div></div>";
  }
  window.cfgToggleService = function (i) { var s = services()[i]; s.status = (_svcMeta(s).status === 'inactive') ? 'active' : 'inactive'; cfgPersist('Stato servizio aggiornato'); renderCfgTab(cfgTab); };
  function splitList(v) { return (v || '').split(',').map((s) => s.trim()).filter(Boolean); }
  // Every configured shift code, for the "codici conteggiati" picker
  function allCodeList() { return (CFG().codes || []).map((c) => c.code); }
  function multiOpts(values, selected) {
    const sel = (selected || []).map(String);
    return (values || []).map((v) =>
      "<option value=\"" + esc(String(v)) + "\"" + (sel.includes(String(v)) ? ' selected' : '') + '>' + esc(String(v)) + '</option>'
    ).join('');
  }
  function readMulti(id) {
    const el = document.getElementById(id);
    if (!el) return [];
    return [...el.selectedOptions].map((o) => o.value).filter(Boolean);
  }
  window.cfgEditService = function (i) { cfgEdit.services = i; renderCfgTab(cfgTab); };
  function _svg(id) { var e = document.getElementById(id); return e ? (e.value || '').trim() : ''; }
  window.cfgSaveService = function () {
    const key = _svg('cfgSvcKey');
    const label = _svg('cfgSvcLabel');
    const count = readMulti('cfgSvcCount');
    const filiali_ = readMulti('cfgSvcFil');
    if (!key) { toast('La key è obbligatoria'); return; }
    const extra = {
      icon: _svg('cfgSvcIcon') || '📦', defaultHours: _svg('cfgSvcHours'),
      vehicleType: _svg('cfgSvcVeh'), training: _svg('cfgSvcTrain'),
      status: document.getElementById('cfgSvcStatus').value || 'active'
    };
    const list = services();
    const isNew = cfgEdit.services === -1 || cfgEdit.services == null;
    if (!isNew) {
      const prev = list[cfgEdit.services];
      list[cfgEdit.services] = Object.assign({}, prev, { label: label || prev.label, count, filiali: filiali_ }, extra);
    } else {
      if (list.some((s) => s.key.toLowerCase() === key.toLowerCase())) { toast('Servizio già esistente', 'warn'); return; }
      list.push(Object.assign({ key, label: label || key, count, filiali: filiali_ }, extra));
    }
    cfgEdit.services = null;
    cfgPersist('Servizio salvato');
    renderCfgTab(cfgTab);
  };
  window.cfgDelService = function (i) {
    if (!confirm('Eliminare il servizio ' + services()[i].label + '?')) return;
    services().splice(i, 1);
    if (cfgEdit.services === i) cfgEdit.services = null;
    cfgPersist('Servizio eliminato');
    renderCfgTab(cfgTab);
  };

  // ── Forecast editor ──────────────────────────────────────────────
  // Laid out in weeks that run Sunday → Saturday (matching the source
  // spreadsheet's WEEK blocks), with the weekday name and the date shown on
  // separate lines rather than one flat 1..31 strip.
  const DOW_IT = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

  // Split the month into Sunday-start groups: [{days:[{d,dow}], week}]
  function sundayWeeks(ym) {
    const [y, m] = ym.split('-').map(Number);
    const total = daysInMonth(ym);
    const groups = [];
    let cur = [];
    for (let d = 1; d <= total; d++) {
      const dow = new Date(y, m - 1, d).getDay();   // 0 = Sunday
      if (dow === 0 && cur.length) { groups.push(cur); cur = []; }
      cur.push({ d, dow });
    }
    if (cur.length) groups.push(cur);
    return groups.map((g) => {
      // Label with the ISO week of the group's LAST day: for a Sun→Sat block
      // that's the Saturday, which resolves to the same week number the
      // spreadsheet uses (e.g. 1–4 Jul 2026 → W27, 5–11 Jul → W28).
      let week = '';
      try { if (typeof isoWeek === 'function') week = isoWeek(ym, g[g.length - 1].d); } catch (e) {}
      return { days: g, week };
    });
  }

  function renderForecastEditor(body) {
    const svcs = services() || [];
    if (!svcs.length) { body.innerHTML = "<p class='note' style='color:var(--muted)'>Nessun servizio configurato.</p>"; return; }
    if (!fcService || !svcs.some((s) => s.key === fcService)) fcService = svcs[0].key;
    if (!fcMonth) fcMonth = YM;

    // Data for the month being edited. For the month the scheduler already has
    // loaded we reuse its live state; any other month is fetched on demand.
    if (fcMap === null) {
      if (!fcLoading) {
        fcLoading = true;
        body.innerHTML = "<div class='card card-pad'><p class='note' style='color:var(--muted)'>Caricamento forecast " + esc(fcMonth) + "…</p></div>";
        fcLoadMonth(fcMonth, fcCurBranch())
          .then((m) => { fcMap = m; fcLoading = false; renderForecastEditor(document.getElementById('cfgBody')); })
          .catch((e) => { fcMap = {}; fcLoading = false; toast('Forecast non caricato: ' + e.message, 'bad'); renderForecastEditor(document.getElementById('cfgBody')); });
      }
      return;
    }
    const fc = fcMap[fcService] || {};
    const mm = String(fcMonth.split('-')[1]);

    const blocks = sundayWeeks(fcMonth).map((g) => {
      const cells = g.days.map(({ d, dow }) => {
        const we = (dow === 0 || dow === 6);
        return "<div style='text-align:center;min-width:54px'>" +
          "<div class='text-xs' style='font-weight:700;color:" + (we ? 'var(--bad)' : 'var(--muted)') + "'>" + DOW_IT[dow] + "</div>" +
          "<div class='text-xs' style='color:var(--muted);margin-bottom:3px'>" + String(d).padStart(2, '0') + '/' + mm + "</div>" +
          "<input class='inp fc-cell' data-day='" + d + "' type='number' min='0' " +
          "style='width:54px;padding:4px;text-align:center" + (we ? ';background:var(--warn-bg)' : '') + "' " +
          "value='" + (fc[d] != null ? fc[d] : '') + "'></div>";
      }).join('');
      return "<div style='margin-bottom:16px'>" +
        "<div class='text-xs' style='font-weight:700;color:var(--muted);letter-spacing:.04em;margin-bottom:6px'>SETTIMANA " + esc(String(g.week)) + "</div>" +
        "<div style='display:flex;flex-wrap:wrap;gap:6px'>" + cells + "</div></div>";
    }).join('');

    const opts = svcs.map((s) => "<option value='" + esc(s.key) + "'" + (s.key === fcService ? ' selected' : '') + '>' + esc(s.label) + '</option>').join('');
    const curBranch = fcCurBranch();
    const branchOpts = (filiali() || []).map((f) => "<option value='" + esc(f) + "'" + (f === curBranch ? ' selected' : '') + '>' + esc(f) + '</option>').join('');
    const isOther = fcMonth !== YM;
    body.innerHTML =
      "<div class='card card-pad'>" +
      "<div class='section-head'><span class='section-title'>📈 Forecast — " + esc(fcMonth) + " · " + esc(curBranch) + "</span>" +
      "<span class='text-xs text-muted'>Settimane da domenica a sabato</span></div>" +
      "<div style='display:flex;gap:8px;align-items:flex-end;margin:10px 0 16px;flex-wrap:wrap'>" +
      "<div><label class='lbl'>Filiale</label><select id='cfgFcBranch' class='sel'" + actAttr('change','cfgFcBranchPick',['@value']) + ">" + branchOpts + "</select></div>" +
      "<div><label class='lbl'>Mese</label><input id='cfgFcMonth' class='inp' type='month' value='" + esc(fcMonth) + "'" + actAttr('change','cfgFcMonthPick',['@value']) + " style='width:150px'></div>" +
      "<div><label class='lbl'>Servizio</label><select id='cfgFcSvc' class='sel'" + actAttr('change','cfgFcPick',['@value']) + ">" + opts + "</select></div>" +
      "<button class='btn btn-primary'" + actAttr('click','cfgSaveForecast') + ">💾 Salva forecast</button>" +
      "<div style='flex:1'></div>" +
      "<button class='btn btn-ghost sm'" + actAttr('click','cfgExportForecast') + ">⬇ Esporta Excel</button>" +
      "<label class='btn btn-ghost sm' style='cursor:pointer;margin:0'>⬆ Importa Excel" +
      "<input type='file' accept='.xlsx,.xls' style='display:none'" + actAttr('change','cfgImportForecast',['@event']) + "></label>" +
      "</div>" +
      (isOther ? "<p class='text-xs' style='color:var(--warn);margin-bottom:10px'>⚠️ Stai modificando un mese diverso da quello aperto nel planner (" + esc(YM) + ").</p>" : '') +
      blocks +
      "<p class='text-xs text-muted'>Numero di corse previste per giorno. Vuoto = nessuna previsione. Sabato e domenica evidenziati.</p></div>";
  }
  window.cfgFcMonthPick = function (m) {
    if (!/^\d{4}-\d{2}$/.test(m || '')) return;
    fcMonth = m; fcMap = null;              // force a reload for the new month
    renderForecastEditor(document.getElementById('cfgBody'));
  };
  window.cfgFcBranchPick = function (b) {
    fcBranch = b || ''; fcMap = null;       // force a reload for the new branch
    renderForecastEditor(document.getElementById('cfgBody'));
  };

  // Is the editor pointed at the planner's own month + branch? Only then do
  // forecast edits feed the live scheduler state / local cache.
  function fcIsPlanner(m) { return m === YM && fcCurBranch() === cfgBranch(); }

  // ── Forecast Excel round-trip (on the month + branch being edited) ──
  window.cfgExportForecast = function () {
    const m = fcMonth || YM;
    window.open(TurniApi.xlsxExportUrl('scheduler-forecast', { month: m, branch: fcCurBranch() }), '_blank');
  };
  window.cfgImportForecast = function (ev) {
    const f = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    const m = fcMonth || YM;
    const br = fcCurBranch();
    toast('Importazione in corso…');
    TurniApi.xlsxImportWith('scheduler-forecast', f, { month: m, branch: br })
      .then(async (r) => {
        toast('Importate ' + (r.saved || 0) + ' celle' + (r.skipped ? ' (' + r.skipped + ' righe saltate)' : ''));
        // Re-read from the DB so the grid shows what was actually stored
        // rather than the pre-import view.
        try {
          const map = await fcLoadMonthFromDb(m, br);
          fcMap = map;
          if (fcIsPlanner(m)) {
            state.forecast = JSON.parse(JSON.stringify(map));
            try { localStorage.setItem(lsKey(YM), JSON.stringify(state)); } catch (e) {}
          }
        } catch (e) { /* keep current view */ }
        renderForecastEditor(document.getElementById('cfgBody'));
        if (fcIsPlanner(m) && typeof renderCov === 'function') { try { renderCov(); } catch (e) {} }
      })
      .catch((e) => toast('Import fallito: ' + e.message, 'bad'));
  };
  // Always hits the DB (fcLoadMonth short-circuits to local state for YM)
  async function fcLoadMonthFromDb(month, branch) {
    const list = await TurniApi.schedulerForecasts(month, branch);
    const map = {};
    (list || []).forEach((r) => {
      if (!map[r.service_key]) map[r.service_key] = {};
      map[r.service_key][r.day_of_month] = r.qty;
    });
    return map;
  }

  // ── Rule Engine tab (governs the automatic generator) ────────────
  let _rules = [];
  const RULE_ACTIONS = { skip: 'Escludi', require: 'Richiedi', score: 'Punteggio' };
  async function renderRules(body) {
    body.innerHTML = "<div class='skel' style='height:200px;border-radius:10px'></div>";
    try { _rules = await TurniApi.schedulerRules(); }
    catch (e) { body.innerHTML = "<div class='text-muted' style='padding:16px'>Errore: " + esc(e.message) + "</div>"; return; }
    const rows = _rules.map((r) =>
      "<tr>" +
      "<td style='text-align:center'><input type='checkbox' " + (r.enabled ? 'checked' : '') + actAttr('change','cfgToggleRule',[r.id,'@checked']) + "></td>" +
      "<td><b>" + esc(r.name) + "</b>" + (r.builtin ? '' : " <span class='badge b-pri' style='font-size:.6rem'>custom</span>") + "<br><span class='text-xs text-muted'>" + esc(r.description || '') + "</span></td>" +
      "<td><span class='badge " + (r.action === 'skip' ? 'b-bad' : r.action === 'require' ? 'b-warn' : 'b-ok') + "'>" + (RULE_ACTIONS[r.action] || r.action) + "</span></td>" +
      "<td style='text-align:center'><input type='number' value='" + r.priority + "' style='width:60px;padding:4px' class='inp'" + actAttr('change','cfgSetRulePriority',[r.id,'@value']) + "></td>" +
      "<td style='font-size:.72rem;color:var(--muted)'>" + esc(JSON.stringify(r.params || {})) + "</td>" +
      "<td style='text-align:right'>" + (r.builtin ? '' : "<button class='btn warn sm'" + actAttr('click','cfgDeleteRule',[r.id]) + ">🗑</button>") + "</td>" +
      "</tr>").join('');
    body.innerHTML =
      _contractsSubnav('rules') +
      "<div class='card card-pad mb-4'>" +
      "<div class='section-head'><span class='section-title'>⚙ Regole di generazione automatica</span></div>" +
      "<p class='text-xs text-muted' style='margin-bottom:10px'>Il generatore valuta ogni candidato secondo queste regole (in ordine di priorità). Nessun calcolo su ore: solo giorni contrattuali, qualifiche, disponibilità ed equità.</p>" +
      "<table class='tbl'><thead><tr><th>Attiva</th><th>Regola</th><th>Tipo</th><th>Priorità</th><th>Parametri</th><th></th></tr></thead><tbody>" + rows + "</tbody></table></div>" +
      "<div class='card card-pad' style='max-width:640px'>" +
      "<div class='section-title text-sm mb-2'>➕ Nuova regola</div>" +
      "<div style='display:grid;grid-template-columns:1fr 1fr;gap:8px'>" +
      "<div><label class='lbl'>Codice (evaluator)</label><select id='ruCode' class='sel w-full'>" +
        ['contract_day','unavailable','already_assigned','qualified','branch_match','consecutive','workload_balance','weekend_fairness','preferred_code'].map((c) => "<option>" + c + "</option>").join('') + "</select></div>" +
      "<div><label class='lbl'>Nome</label><input id='ruName' class='inp'></div>" +
      "<div><label class='lbl'>Tipo</label><select id='ruAction' class='sel w-full'><option value='skip'>Escludi</option><option value='require'>Richiedi</option><option value='score'>Punteggio</option></select></div>" +
      "<div><label class='lbl'>Priorità</label><input id='ruPriority' class='inp' type='number' value='100'></div>" +
      "<div style='grid-column:1/-1'><label class='lbl'>Parametri (JSON)</label><input id='ruParams' class='inp' value='{}'></div>" +
      "</div><div style='margin-top:10px'><button class='btn btn-primary'" + actAttr('click','cfgCreateRule') + ">Crea regola</button></div></div>";
  }
  window.cfgToggleRule = async function (id, enabled) {
    try { await TurniApi.updateSchedulerRule(id, { enabled }); if (typeof invalidateGenRules === 'function') invalidateGenRules(); toast('Regola aggiornata', 'ok'); }
    catch (e) { toast('Errore: ' + e.message, 'bad'); }
  };
  window.cfgSetRulePriority = async function (id, priority) {
    try { await TurniApi.updateSchedulerRule(id, { priority: +priority }); if (typeof invalidateGenRules === 'function') invalidateGenRules(); }
    catch (e) { toast('Errore: ' + e.message, 'bad'); }
  };
  window.cfgCreateRule = async function () {
    const code = document.getElementById('ruCode').value;
    const name = document.getElementById('ruName').value.trim() || code;
    const action = document.getElementById('ruAction').value;
    const priority = +document.getElementById('ruPriority').value || 100;
    let params = {};
    try { params = JSON.parse(document.getElementById('ruParams').value || '{}'); } catch (e) { toast('Parametri JSON non validi', 'bad'); return; }
    try { await TurniApi.createSchedulerRule({ code, name, action, priority, params, enabled: true }); if (typeof invalidateGenRules === 'function') invalidateGenRules(); toast('Regola creata', 'ok'); renderRules(document.getElementById('cfgBody')); }
    catch (e) { toast('Errore: ' + e.message, 'bad'); }
  };
  window.cfgDeleteRule = async function (id) {
    if (!confirm('Eliminare questa regola?')) return;
    try { await TurniApi.deleteSchedulerRule(id); if (typeof invalidateGenRules === 'function') invalidateGenRules(); toast('Regola eliminata', 'ok'); renderRules(document.getElementById('cfgBody')); }
    catch (e) { toast('Errore: ' + e.message, 'bad'); }
  };

  // ── Import / Export tab (Forecast + Dipendenti) ──────────────────
  function renderImportExport(body) {
    body.innerHTML =
      "<div class='card card-pad mb-4' style='max-width:760px'>" +
      "<div class='section-head'><span class='section-title'>👥 Dipendenti</span></div>" +
      "<p class='text-xs text-muted' style='margin-bottom:10px'>Esporta l'anagrafica completa, oppure importa da un file Excel. Usa il modello per conoscere le colonne attese.</p>" +
      "<div style='display:flex;gap:8px;flex-wrap:wrap'>" +
      "<button class='btn btn-ghost sm'" + actAttr('click','cfgExportEmployees') + ">⬇ Esporta Excel</button>" +
      "<label class='btn btn-ghost sm' style='cursor:pointer;margin:0'>⬆ Importa Excel" +
      "<input type='file' accept='.xlsx,.xls' style='display:none'" + actAttr('change','cfgImportEmployees',['@event']) + "></label>" +
      "<button class='btn btn-ghost sm'" + actAttr('click','cfgTemplate',['employees']) + ">📄 Modello</button>" +
      "</div></div>" +

      "<div class='card card-pad' style='max-width:760px'>" +
      "<div class='section-head'><span class='section-title'>📈 Forecast — " + esc(YM) + " · " + esc(cfgBranch()) + "</span></div>" +
      "<p class='text-xs text-muted' style='margin-bottom:10px'>Griglia mensile: una riga per servizio, una colonna per giorno. Esporta, modifica in Excel e reimporta.</p>" +
      "<div style='display:flex;gap:8px;flex-wrap:wrap'>" +
      "<button class='btn btn-ghost sm'" + actAttr('click','cfgExportForecast') + ">⬇ Esporta Excel</button>" +
      "<label class='btn btn-ghost sm' style='cursor:pointer;margin:0'>⬆ Importa Excel" +
      "<input type='file' accept='.xlsx,.xls' style='display:none'" + actAttr('change','cfgImportForecast',['@event']) + "></label>" +
      "</div></div>";
  }
  window.cfgExportEmployees = function () {
    window.open(TurniApi.xlsxExportUrl('employees', {}), '_blank');
  };
  window.cfgTemplate = function (type) {
    window.open(TurniApi.xlsxTemplateUrl(type), '_blank');
  };
  window.cfgImportEmployees = function (ev) {
    const f = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    toast('Importazione in corso…');
    TurniApi.xlsxImport('employees', f)
      .then((r) => {
        toast('Importati ' + (r.added || 0) + ' dipendenti' + (r.skipped ? ' (' + r.skipped + ' saltati)' : ''));
        if (typeof bootPeople === 'function') { try { bootPeople(); } catch (e) {} }
      })
      .catch((e) => toast('Import fallito: ' + e.message, 'bad'));
  };
  window.cfgFcPick = function (key) { fcService = key; renderForecastEditor(document.getElementById('cfgBody')); };
  window.cfgSaveForecast = function () {
    const m = fcMonth || YM;
    const cells = [...document.querySelectorAll('#cfgBody .fc-cell')];
    const map = {};
    const items = [];
    cells.forEach((el) => {
      const day = +el.dataset.day;
      const v = el.value.trim();
      if (v !== '') { const q = +v || 0; map[day] = q; items.push({ service_key: fcService, day, qty: q }); }
    });
    const br = fcCurBranch();
    fcMap = fcMap || {};
    fcMap[fcService] = map;
    // Only the planner's own month + branch feeds the live scheduler state.
    if (fcIsPlanner(m)) {
      state.forecast = state.forecast || {};
      state.forecast[fcService] = map;
      if (typeof dirty === 'function') { try { dirty(); } catch (e) {} }
      try { localStorage.setItem(lsKey(YM), JSON.stringify(state)); } catch (e) {}
    }
    if (typeof TurniApi !== 'undefined' && TurniApi.isLoggedIn && TurniApi.isLoggedIn()) {
      TurniApi.schedulerBulkForecasts(m, br, items)
        .then((r) => toast('Forecast ' + br + ' ' + m + ' salvato (' + (r.saved != null ? r.saved : items.length) + ' giorni)'))
        .catch((e) => toast('Salvato in locale (DB: ' + e.message + ')', 'warn'));
    } else {
      toast('Forecast salvato in locale');
    }
    if (fcIsPlanner(m) && typeof renderCov === 'function') { try { renderCov(); } catch (e) {} }
  };
})();
