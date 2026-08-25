/* TurniDSP — Documents module (Personale → Documenti)
 *
 * Full document register over /api/documents (list-all / upload / delete).
 * Dashboard cards, category filter + search, table with expiry badges,
 * drag & drop upload modal, preview / download / replace / delete.
 */
(function () {
  'use strict';

  // doc_type is free text; these are the categories the UI offers and groups by.
  const DOC_CATS = [
    { key: 'identity',        label: "Carta d'identità" },
    { key: 'driving_license', label: 'Patente di guida' },
    { key: 'medical',         label: 'Certificato medico' },
    { key: 'contract',        label: 'Contratto' },
    { key: 'training',        label: 'Formazione' },
    { key: 'other',           label: 'Altro' },
  ];
  const catLabel = (k) => (DOC_CATS.find((c) => c.key === k) || {}).label || (k || '—');

  let _docAll = [];
  let _docEmployees = [];
  let _docInited = false;
  let _docReplaceId = null;   // when set, a successful upload deletes this doc
  let _docSearchTimer = null;

  function empName(id, row) {
    if (row && (row.last_name || row.first_name)) return `${row.last_name || ''} ${row.first_name || ''}`.trim();
    const e = _docEmployees.find((x) => String(x.id) === String(id));
    return e ? `${e.last_name || ''} ${e.first_name || ''}`.trim() : ('#' + id);
  }

  // Expiry classification drives both the badge and the dashboard cards.
  function expiryState(d) {
    if (!d.expiry_date) return { key: 'permanent', label: 'Permanente', cls: 'b-ok' };
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const exp = new Date(String(d.expiry_date).slice(0, 10));
    const days = Math.round((exp - today) / 86400000);
    if (days < 0)  return { key: 'expired',  label: 'Scaduto', cls: 'b-bad', days };
    if (days <= 30) return { key: 'expiring', label: `Tra ${days}g`, cls: 'b-warn', days };
    return { key: 'valid', label: 'Valido', cls: 'b-ok', days };
  }

  async function bootDocuments() {
    const host = document.getElementById('sec-documents');
    if (!host) return;
    if (!_docInited) {
      _docInited = true;
      host.innerHTML = docShellHtml();
      wireDocFilters();
    }
    await loadDocuments();
  }

  function docShellHtml() {
    return `
      <div class="page-head"><div class="page-title">📁 Documenti</div>
        <button class="btn btn-primary" onclick="openDocUpload()">⬆ Carica documento</button>
      </div>
      <div class="kpi-grid" id="docCards" style="margin-bottom:16px"></div>
      <div class="card card-pad mb-4">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end">
          <div><label class="lbl">Dipendente</label><select id="docfEmp" class="sel" style="min-width:150px"></select></div>
          <div><label class="lbl">Categoria</label><select id="docfCat" class="sel"><option value="">Tutte</option>${DOC_CATS.map((c) => `<option value="${c.key}">${c.label}</option>`).join('')}</select></div>
          <div><label class="lbl">Stato</label><select id="docfState" class="sel"><option value="">Tutti</option><option value="valid">Validi</option><option value="expiring">In scadenza</option><option value="expired">Scaduti</option></select></div>
          <div style="flex:1;min-width:160px"><label class="lbl">Cerca</label><input id="docfSearch" class="inp" placeholder="Nome, numero, categoria…" autocomplete="off"></div>
        </div>
      </div>
      <div class="card card-pad">
        <div style="overflow-x:auto"><table class="tbl" id="docTbl">
          <thead><tr><th>Dipendente</th><th>Documento</th><th>Categoria</th><th>Emissione</th><th>Scadenza</th><th>Stato</th><th></th></tr></thead>
          <tbody><tr><td colspan="7"><div class="skel" style="height:22px;border-radius:6px"></div></td></tr></tbody>
        </table></div>
      </div>`;
  }

  function wireDocFilters() {
    ['docfEmp', 'docfCat', 'docfState'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', renderDocuments);
    });
    const s = document.getElementById('docfSearch');
    if (s) s.addEventListener('input', () => { clearTimeout(_docSearchTimer); _docSearchTimer = setTimeout(renderDocuments, 200); });
  }

  async function loadDocuments() {
    try {
      const [docs, emps] = await Promise.all([
        TurniApi.documentsAll(),
        _docEmployees.length ? Promise.resolve({ rows: _docEmployees }) : TurniApi.employees({}),
      ]);
      _docAll = Array.isArray(docs) ? docs : (docs.rows || []);
      if (!_docEmployees.length) {
        _docEmployees = Array.isArray(emps) ? emps : (emps.rows || []);
        fillDocEmpSelects();
      }
      renderDocuments();
    } catch (e) {
      const tb = document.querySelector('#docTbl tbody');
      if (tb) tb.innerHTML = `<tr><td colspan="7" class="text-muted" style="padding:16px">Errore: ${esc(e.message)}</td></tr>`;
    }
  }

  function fillDocEmpSelects() {
    const opts = _docEmployees.slice().sort((a, b) => (a.last_name || '').localeCompare(b.last_name || ''))
      .map((e) => `<option value="${e.id}">${esc((e.last_name || '') + ' ' + (e.first_name || ''))}</option>`).join('');
    const f = document.getElementById('docfEmp');
    if (f) f.innerHTML = '<option value="">Tutti</option>' + opts;
    const m = document.getElementById('docEmp');
    if (m) m.innerHTML = '<option value="">— seleziona —</option>' + opts;
  }

  function filteredDocs() {
    const fEmp = (document.getElementById('docfEmp') || {}).value || '';
    const fCat = (document.getElementById('docfCat') || {}).value || '';
    const fState = (document.getElementById('docfState') || {}).value || '';
    const q = ((document.getElementById('docfSearch') || {}).value || '').toLowerCase().trim();
    return _docAll.filter((d) => {
      if (fEmp && String(d.employee_id) !== fEmp) return false;
      if (fCat && d.doc_type !== fCat) return false;
      if (fState) {
        const s = expiryState(d).key;
        if (fState === 'valid' && !(s === 'valid' || s === 'permanent')) return false;
        if (fState === 'expiring' && s !== 'expiring') return false;
        if (fState === 'expired' && s !== 'expired') return false;
      }
      if (q) {
        const hay = (empName(d.employee_id, d) + ' ' + (d.number || '') + ' ' + catLabel(d.doc_type)).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function renderDocuments() {
    renderDocCards();
    const tb = document.querySelector('#docTbl tbody');
    if (!tb) return;
    const rows = filteredDocs();
    if (!rows.length) {
      tb.innerHTML = `<tr><td colspan="7" class="text-muted" style="padding:28px;text-align:center">Nessun documento trovato.</td></tr>`;
      return;
    }
    tb.innerHTML = rows.map((d) => {
      const st = expiryState(d);
      const hasFile = !!d.file_path;
      const fileUrl = hasFile ? TurniApi.uploadUrl(d.file_path) : null;
      return `<tr>
        <td><b>${esc(empName(d.employee_id, d))}</b>${d.branch_code ? ` <small class="text-muted">${esc(d.branch_code)}</small>` : ''}</td>
        <td>${esc(d.number || catLabel(d.doc_type))}</td>
        <td>${esc(catLabel(d.doc_type))}</td>
        <td>${fmt(d.issue_date)}</td>
        <td>${fmt(d.expiry_date)}</td>
        <td><span class="badge ${st.cls}">${st.label}</span></td>
        <td style="white-space:nowrap;text-align:right">
          ${hasFile ? `<a class="btn ghost sm" title="Apri" href="${fileUrl}" target="_blank" rel="noopener">👁</a>
          <a class="btn ghost sm" title="Scarica" href="${fileUrl}" download>⬇</a>` : '<span class="text-muted text-xs">nessun file</span>'}
          <button class="btn ghost sm" title="Sostituisci" onclick="replaceDoc(${d.id})">🔁</button>
          <button class="btn warn sm" title="Elimina" onclick="deleteDoc(${d.id})">🗑</button>
        </td></tr>`;
    }).join('');
  }

  function renderDocCards() {
    const el = document.getElementById('docCards');
    if (!el) return;
    let expiring = 0, expired = 0, valid = 0;
    _docAll.forEach((d) => { const s = expiryState(d).key; if (s === 'expired') expired++; else if (s === 'expiring') expiring++; else valid++; });
    const card = (v, l, cls) => `<div class="kpi-card ${cls || ''}"><div class="kpi-val">${v}</div><div class="kpi-label">${l}</div></div>`;
    el.innerHTML = card(_docAll.length, 'Documenti', 'pri') + card(expiring, 'In scadenza', 'warn') + card(expired, 'Scaduti', 'bad') + card(valid, 'Validi', 'ok');
  }

  // ── Actions ──────────────────────────────────────────────────────
  window.deleteDoc = async function (id) {
    if (!window.confirm('Eliminare questo documento?')) return;
    try {
      await TurniApi.deleteDocument(id);
      _docAll = _docAll.filter((x) => x.id !== id);
      renderDocuments();
      toast('Documento eliminato', 'ok');
    } catch (e) { toast('Errore: ' + e.message, 'bad'); }
  };
  window.replaceDoc = function (id) {
    const d = _docAll.find((x) => x.id === id);
    if (!d) return;
    openDocUpload();
    // prefill from the doc being replaced; on save the old one is removed
    _docReplaceId = id;
    document.getElementById('docEmp').value = d.employee_id;
    document.getElementById('docCat').value = d.doc_type || 'other';
    document.getElementById('docNumber').value = d.number || '';
    document.getElementById('docModalTitle').textContent = 'Sostituisci documento';
  };

  // ── Upload modal (drag & drop) ───────────────────────────────────
  window.openDocUpload = function () {
    _docReplaceId = null;
    document.getElementById('docModalTitle').textContent = 'Carica documento';
    document.getElementById('docEmp').value = '';
    document.getElementById('docCat').value = 'contract';
    document.getElementById('docNumber').value = '';
    document.getElementById('docIssue').value = '';
    document.getElementById('docExpiry').value = '';
    document.getElementById('docModalMsg').textContent = '';
    setDocFile(null);
    document.getElementById('docModal').classList.add('on');
  };

  let _docFile = null;
  function setDocFile(f) {
    _docFile = f;
    const dz = document.getElementById('docDrop');
    if (dz) dz.innerHTML = f
      ? `<div style="font-weight:600">📄 ${esc(f.name)}</div><div class="text-xs text-muted">${Math.round(f.size / 1024)} KB · clicca per cambiare</div>`
      : `<div style="font-size:1.6rem">⬆</div><div class="text-sm">Trascina qui un PDF o immagine, oppure clicca</div><div class="text-xs text-muted">Max 10 MB · PDF, JPG, PNG</div>`;
  }
  window.docPickFile = function () { document.getElementById('docFileInput').click(); };
  window.docFileChosen = function (ev) { const f = ev.target.files && ev.target.files[0]; if (f) setDocFile(f); };
  window.docDropHandler = function (ev) {
    ev.preventDefault();
    document.getElementById('docDrop').classList.remove('dragover');
    const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (f) setDocFile(f);
  };
  window.docDragOver = function (ev) { ev.preventDefault(); document.getElementById('docDrop').classList.add('dragover'); };
  window.docDragLeave = function (ev) { ev.preventDefault(); document.getElementById('docDrop').classList.remove('dragover'); };

  window.saveDocument = async function () {
    const msg = document.getElementById('docModalMsg');
    const employee_id = +document.getElementById('docEmp').value || null;
    const doc_type = document.getElementById('docCat').value;
    if (!employee_id) { msg.textContent = 'Seleziona un dipendente'; return; }
    if (!_docFile && !_docReplaceId) { msg.textContent = 'Seleziona un file da caricare'; return; }
    const fd = new FormData();
    fd.append('employee_id', employee_id);
    fd.append('doc_type', doc_type);
    fd.append('number', document.getElementById('docNumber').value.trim());
    fd.append('issue_date', document.getElementById('docIssue').value);
    fd.append('expiry_date', document.getElementById('docExpiry').value);
    if (_docFile) fd.append('file', _docFile);
    try {
      const saved = await TurniApi.uploadDocument(fd);
      // Replace: drop the old record once the new one is stored
      if (_docReplaceId) { try { await TurniApi.deleteDocument(_docReplaceId); } catch (e) {} _docReplaceId = null; }
      closeAll();
      await loadDocuments();
      toast('Documento salvato', 'ok');
      return saved;
    } catch (e) { msg.textContent = e.message || 'Errore caricamento'; }
  };

  window.bootDocuments = bootDocuments;
})();
