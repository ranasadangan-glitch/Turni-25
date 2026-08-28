/* TurniDSP — People module (da employees.html)
   Estratto dal monolite app.html: stesso scope globale, stesso comportamento.
   Ordine di caricamento definito in app.html (vedi fondo pagina). */
// ── People module (ported from employees.html) ─────────────────────
let _employees = [], _selectedEmpId = null;

function empInitials(r) { return ((r.last_name||'')[0]||(r.first_name||'')[0]||'?').toUpperCase() + ((r.first_name||'')[0]||'').toUpperCase(); }
// Avatar content: the uploaded photo when present, else initials. Same helper
// for the list and the profile hero so they stay consistent.
function empAvatarInner(r) { return (r && r.photo_url) ? ('<img src="' + esc(r.photo_url) + '" alt="">') : esc(empInitials(r)); }
function empContractStatus(r) {
  if (!r.contract_end_date) return { cls:'badge-muted', label:'Indeterminato' };
  const days = Math.ceil((new Date(r.contract_end_date)-new Date())/86400000);
  if (days < 0) return { cls:'badge-bad', label:'Scaduto' };
  if (days <= 7) return { cls:'badge-bad', label:days+'gg' };
  if (days <= 30) return { cls:'badge-warn', label:days+'gg' };
  return { cls:'badge-ok', label:fmt(r.contract_end_date) };
}

async function bootPeople() {
  try {
    const branches = await TurniApi.branches();
    const sel = document.getElementById('empBranchFilter');
    branches.forEach(b => { const o=document.createElement('option'); o.value=b.code; o.textContent=b.code; sel.appendChild(o); });
  } catch {}
  await loadEmployees();
  // Deep-link: #employees/123 opens that profile directly
  const hashParts = location.hash.replace('#','').split('/');
  if (hashParts[0] === 'employees' && hashParts[1]) {
    const id = +hashParts[1];
    if (id) openProfile(id);
  }
}

async function loadEmployees() {
  try {
    const data = await TurniApi.employees({ pageSize: 500 });
    _employees = data.rows || data;
    filterEmployees();
  } catch (e) {
    document.getElementById('empList').innerHTML = `<div style="padding:16px;color:var(--bad)">${esc(e.message)}</div>`;
  }
}

function filterEmployees(q) {
  if (q === undefined) q = document.getElementById('empSearch').value;
  const branch = document.getElementById('empBranchFilter').value;
  const status = document.getElementById('empStatusFilter').value;
  q = (q||'').toLowerCase();

  let rows = _employees;
  if (branch) rows = rows.filter(r => r.branch_code === branch);
  if (status) rows = rows.filter(r => r.status === status);
  if (q) rows = rows.filter(r =>
    (r.last_name+' '+r.first_name).toLowerCase().includes(q) ||
    (r.transporter_id||'').toLowerCase().includes(q) ||
    (r.employee_code||'').toLowerCase().includes(q)
  );

  document.getElementById('empCount').textContent = rows.length + ' dipendenti';
  const list = document.getElementById('empList');
  if (!rows.length) { list.innerHTML = '<div style="padding:20px;text-align:center" class="text-muted text-sm">Nessun risultato</div>'; return; }

  list.innerHTML = rows.map(r => {
    const cs = empContractStatus(r);
    return `<div class="emp-row${r.id===_selectedEmpId?' selected':''}" ${actAttr('click','openProfile',[r.id])}>
      <div class="emp-avatar${r.status==='inactive'?' inactive':''}">${empAvatarInner(r)}</div>
      <div style="flex:1;min-width:0">
        <div class="emp-name">${esc(r.last_name)} ${esc(r.first_name)}</div>
        <div class="emp-meta">${esc(r.branch_code||'—')} · ${esc(r.service_name||'—')}</div>
      </div>
      <span class="badge ${cs.cls}" style="font-size:.65rem">${cs.label}</span>
    </div>`;
  }).join('');
}

async function openProfile(id) {
  _selectedEmpId = id;
  if (_currentSection === 'employees') { try { history.replaceState({section:'employees'}, '', '#employees/'+id); } catch(e) {} }
  filterEmployees(); // update selected state

  const panel = document.getElementById('profileContent');
  const noSel = document.getElementById('noSelection');
  noSel.style.display = 'none';
  panel.style.display = 'block';
  panel.innerHTML = `<div style="padding:40px;text-align:center" class="text-muted">Caricamento…</div>`;

  try {
    const emp = await TurniApi.employeeProfile(id);
    renderEmpProfile(emp);
  } catch (e) {
    panel.innerHTML = `<div style="padding:20px;color:var(--bad)">Errore: ${esc(e.message)}</div>`;
  }
}

function renderEmpProfile(emp) {
  const cs = empContractStatus(emp);
  const panel = document.getElementById('profileContent');

  panel.innerHTML = `
    <div class="profile-hero">
      <div class="profile-avatar">${empAvatarInner(emp)}</div>
      <div>
        <h1>${esc(emp.last_name)} ${esc(emp.first_name)}</h1>
        <p>${esc(emp.branch_name||emp.branch_code||'—')} · ${esc(emp.service_type_name||'—')} · ${esc(emp.contract_label||'—')}</p>
        <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
          <span class="badge ${emp.status==='active'?'badge-ok':'badge-muted'}">${emp.status==='active'?'Attivo':'Inattivo'}</span>
          <span class="badge ${cs.cls}">${cs.label}</span>
          ${emp.open_disciplinary > 0 ? `<span class="badge badge-bad">⚠ ${emp.open_disciplinary} disciplinare</span>` : ''}
          ${emp.absences_today > 0 ? `<span class="badge badge-warn">Assente oggi</span>` : ''}
        </div>
      </div>
    </div>

    <div class="profile-tabs">
      <button class="profile-tab on" ${actAttr('click','switchEmpTab',['overview'])}>Panoramica</button>
      <button class="profile-tab" ${actAttr('click','switchEmpTab',['schedule'])}>Turni recenti</button>
      <button class="profile-tab" ${actAttr('click','switchEmpTab',['absences'])}>Assenze (${(emp.absences||[]).length})</button>
      <button class="profile-tab" ${actAttr('click','switchEmpTab',['documents'])}>Documenti (${(emp.documents||[]).length})</button>
      ${emp.open_disciplinary > 0 ? '<button class="profile-tab"' + actAttr('click','switchEmpTab',['disciplinary']) + '>Disciplinare</button>' : ''}
    </div>

    <div id="tab-overview" class="tab-content on">
      <div class="info-grid">
        <div class="info-item"><label>Codice dipendente</label><span>${esc(emp.employee_code||'—')}</span></div>
        <div class="info-item"><label>Transporter ID</label><span>${esc(emp.transporter_id||'—')}</span></div>
        <div class="info-item"><label>Email</label><span>${emp.email?`<a href="mailto:${esc(emp.email)}">${esc(emp.email)}</a>`:'—'}</span></div>
        <div class="info-item"><label>Telefono</label><span>${esc(emp.phone||'—')}</span></div>
        <div class="info-item"><label>Filiali</label><span>${esc(emp.branch_name||emp.branch_code||'—')}${(Array.isArray(emp.branch_ids)&&emp.branch_ids.length>1)?` <small class="text-muted">+${emp.branch_ids.length-1}</small>`:''}</span></div>
        <div class="info-item"><label>Servizi</label><span>${esc(emp.service_type_name||'—')}${(Array.isArray(emp.service_type_ids)&&emp.service_type_ids.length>1)?` <small class="text-muted">+${emp.service_type_ids.length-1}</small>`:''}</span></div>
        <div class="info-item"><label>Contratto</label><span>${esc(emp.contract_label||'—')}</span></div>
        <div class="info-item"><label>Giorni contrattuali</label><span>${(Array.isArray(emp.work_days)&&emp.work_days.length)?emp.work_days.map(n=>({1:'Lun',2:'Mar',3:'Mer',4:'Gio',5:'Ven',6:'Sab',7:'Dom'}[n]||n)).join(' '):'—'}</span></div>
        <div class="info-item"><label>Data assunzione</label><span>${fmt(emp.hire_date)}</span></div>
        <div class="info-item"><label>Inizio contratto</label><span>${fmt(emp.contract_start_date)}</span></div>
        <div class="info-item"><label>Fine contratto</label><span class="${cs.cls}">${fmt(emp.contract_end_date)||'Indeterminato'}</span></div>
        ${emp.tenure_months ? `<div class="info-item"><label>Anzianità</label><span>${Math.floor(emp.tenure_months/12)} anni ${emp.tenure_months%12} mesi</span></div>` : ''}
        <div class="info-item"><label>Codici turno</label><span>${(Array.isArray(emp.default_shift_codes)&&emp.default_shift_codes.length)?esc(emp.default_shift_codes.join(', ')):esc(emp.default_shift_code||'—')}</span></div>
        ${emp.nationality ? `<div class="info-item"><label>Nazionalità</label><span>${esc(emp.nationality)}</span></div>` : ''}
        ${emp.tax_code ? `<div class="info-item"><label>Codice fiscale</label><span>${esc(emp.tax_code)}</span></div>` : ''}
      </div>
      ${(emp.emergency_name||emp.emergency_phone) ? `
        <div class="card card-pad" style="margin-bottom:14px">
          <div class="section-title text-sm mb-2">🆘 Contatto emergenza</div>
          <div>${esc(emp.emergency_name||'—')} · ${esc(emp.emergency_phone||'—')}</div>
        </div>` : ''}
      ${emp.notes ? `<div class="card card-pad"><div class="section-title text-sm mb-2">📝 Note</div><div class="text-sm">${esc(emp.notes)}</div></div>` : ''}
      <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
        ${USER.role==='admin'||USER.role==='hr_manager'?`<button class="btn btn-primary btn-sm" ${actAttr('click','editEmployee',[emp.id])}>✏️ Modifica</button>`:''}
        ${USER.role==='admin'?`<button class="btn btn-ghost btn-sm" ${actAttr('click','toggleEmpStatus',[emp.id, emp.status==='active'?'inactive':'active'])}>${emp.status==='active'?'Disattiva':'Attiva'}</button>`:''}
      </div>
    </div>

    <div id="tab-schedule" class="tab-content">
      <div class="text-sm text-muted mb-2">Ultimi 60 giorni di turni</div>
      <div style="display:flex;flex-wrap:wrap;gap:5px">
        ${(emp.recent_schedules||[]).map(s=>{
          const d=new Date(s.work_date);
          const dateStr=d.toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit'});
          return `<div title="${dateStr}: ${esc(s.shift_code)}" style="text-align:center">
            <div class="text-xs text-muted" style="margin-bottom:2px">${dateStr}</div>
            <div class="shift-mini" style="background:var(--brand-lt);color:var(--brand)">${esc(s.shift_code)}</div>
          </div>`;
        }).join('')||'<div class="text-muted text-sm">Nessun turno registrato</div>'}
      </div>
    </div>

    <div id="tab-absences" class="tab-content">
      ${(emp.absences||[]).length === 0 ? '<div class="text-muted text-sm">Nessuna assenza registrata</div>' :
        (emp.absences||[]).map(a=>`
          <div class="timeline-item">
            <div class="timeline-dot" style="background:var(--warn)"></div>
            <div style="flex:1">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px">
                <span class="font-semi text-sm">${esc(a.absence_type)}</span>
                <span class="text-xs text-muted">${fmt(a.start_date)} → ${fmt(a.end_date)}</span>
              </div>
              ${a.note ? `<div class="text-sm text-muted">${esc(a.note)}</div>` : ''}
            </div>
          </div>`).join('')}
    </div>

    <div id="tab-documents" class="tab-content">
      ${(emp.documents||[]).length === 0 ? '<div class="text-muted text-sm">Nessun documento caricato</div>' :
        (emp.documents||[]).map(d=>{
          const days = d.expiry_date ? Math.ceil((new Date(d.expiry_date)-new Date())/86400000) : null;
          const statusCls = days===null?'badge-muted':days<0?'badge-bad':days<=30?'badge-warn':'badge-ok';
          return `<div class="timeline-item">
            <div class="timeline-dot" style="background:var(--brand)"></div>
            <div style="flex:1">
              <div style="display:flex;align-items:center;gap:8px">
                <span class="font-semi text-sm">${esc(d.doc_type)}</span>
                ${d.number?`<span class="text-xs text-muted">#${esc(d.number)}</span>`:''}
                ${d.expiry_date?`<span class="badge ${statusCls}" style="font-size:.65rem">${days<0?'Scaduto':days+'gg'}</span>`:''}
              </div>
              <div class="text-xs text-muted">Scadenza: ${fmt(d.expiry_date)} · Rilascio: ${fmt(d.issue_date)}</div>
              ${d.file_path?`<a href="${esc(d.file_path)}?token=${encodeURIComponent(localStorage.getItem('turnidsp_token'))}" target="_blank" class="text-xs text-pri">📎 Visualizza</a>`:''}
            </div>
          </div>`;
        }).join('')}
    </div>

    <div id="tab-disciplinary" class="tab-content">
      ${(emp.disciplinary||[]).map(d=>`
        <div class="timeline-item">
          <div class="timeline-dot" style="background:var(--bad)"></div>
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px">
              <span class="font-semi text-sm">${esc(d.action_type)}</span>
              <span class="badge badge-${d.severity==='high'?'bad':d.severity==='medium'?'warn':'muted'}" style="font-size:.65rem">${esc(d.severity)}</span>
              <span class="text-xs text-muted">${fmt(d.action_date)}</span>
            </div>
            ${d.description?`<div class="text-sm">${esc(d.description)}</div>`:''}
          </div>
        </div>`).join('')||'<div class="text-muted text-sm">Nessun provvedimento aperto</div>'}
    </div>
  `;
}

function switchEmpTab(name) {
  document.querySelectorAll('.profile-tab').forEach(b => {
    var _s = b.getAttribute('data-args') || b.getAttribute('onclick') || '';
    b.classList.toggle('on', _s.includes('"'+name+'"') || _s.includes("'"+name+"'"));
  });
  document.querySelectorAll('.tab-content').forEach(el => {
    el.classList.toggle('on', el.id === 'tab-' + name);
  });
}

async function toggleEmpStatus(id, newStatus) {
  try {
    await TurniApi.setEmployeeStatus(id, newStatus);
    await loadEmployees();
    if (typeof syncSchedulerFromDB === 'function') syncSchedulerFromDB();
    openProfile(id);
    toast(newStatus==='active' ? 'Dipendente riattivato' : 'Dipendente disattivato');
  } catch(e) { toast(e.message, 'bad'); }
}

// Reference data for the form dropdowns, loaded once and reused.
// Filiale / Servizio / Codice turno / Contratto for the employee form all come
// from the SAME shared /meta reference tables the rest of the app uses. Those
// tables are kept in step with the Config management pages by the server-side
// sync (sync-shift-vocab + sync-org-vocab), so this is a single source of truth.
// We only cache the refs briefly and drop the cache whenever config/meta changes
// (via AppBus), so management edits show up without a reload.
let _empRefs = null;
if (window.AppBus) AppBus.on('data:changed', function (e) {
  if (e && /config|branch|service|meta|shift|contract/i.test(e.path || '')) _empRefs = null;
});
async function loadEmpRefs() {
  if (_empRefs) return _empRefs;
  const [branches, services, contracts, teams, shiftCodes] = await Promise.all([
    TurniApi.branches().catch(() => []),
    TurniApi.serviceTypes().catch(() => []),
    TurniApi.contractTypes().catch(() => []),
    TurniApi.teams().catch(() => []),
    TurniApi.shiftCodes().catch(() => []),
  ]);
  // Respect the active flag (removed Filiali are deactivated, not deleted).
  _empRefs = { branches: (branches || []).filter((b) => b.active !== false), services, contracts, teams, shiftCodes };
  return _empRefs;
}

// Contractual work days. employees.work_days is ISO (1=Mon … 7=Sun) — note
// this differs from the scheduler's own WEEKDAYS array, which uses 0 for
// Sunday; don't copy that convention here.
const EMP_DAYS = [{ n: 1, l: 'Lun' }, { n: 2, l: 'Mar' }, { n: 3, l: 'Mer' }, { n: 4, l: 'Gio' },
                  { n: 5, l: 'Ven' }, { n: 6, l: 'Sab' }, { n: 7, l: 'Dom' }];

function buildEmpDayPicker(selected) {
  const sel = Array.isArray(selected) ? selected.map(Number) : [1, 2, 3, 4, 5];
  document.getElementById('empf_work_days').innerHTML = EMP_DAYS.map(d =>
    `<button type="button" data-d="${d.n}" class="${sel.includes(d.n) ? 'on' : ''}" data-act-click="call" data-call="_toggleOn">${d.l}</button>`
  ).join('');
}
function readEmpDayPicker() {
  return [...document.querySelectorAll('#empf_work_days button.on')].map(b => +b.dataset.d);
}

function fillEmpSelect(id, items, valueKey, labelFn, selected) {
  const sel = document.getElementById(id);
  sel.innerHTML = '<option value="">—</option>' + items.map(it =>
    `<option value="${it[valueKey]}"${String(it[valueKey])===String(selected)?' selected':''}>${esc(labelFn(it))}</option>`
  ).join('');
}

// Multi-select variant. `selected` is the array column; falls back to the
// singular primary value so employees created before the multi-select
// migration still show their assignment.
// Populates branch / service / shift-code pickers. These are now single-select
// (spec §3: searchable single select), but the value is still stored as an
// array column, so the reader wraps the choice in a 1-element array and the
// API is unchanged. `selected` is the array column; falls back to the singular
// primary value for rows created before the array migration.
function fillEmpMultiSelect(id, items, valueKey, labelFn, selected, fallbackOne) {
  const sel = document.getElementById(id);
  if (!sel) return;
  let chosen = Array.isArray(selected) && selected.length ? selected
             : (fallbackOne != null && fallbackOne !== '' ? [fallbackOne] : []);
  chosen = chosen.map(String);
  // Single selects need a placeholder/empty option so "nessuno" is selectable.
  const head = sel.multiple ? '' : '<option value="">—</option>';
  sel.innerHTML = head + items.map(it =>
    `<option value="${it[valueKey]}"${chosen.includes(String(it[valueKey]))?' selected':''}>${esc(labelFn(it))}</option>`
  ).join('');
}
function readEmpMultiSelect(id, asNumber) {
  const sel = document.getElementById(id);
  if (!sel) return [];
  return [...sel.selectedOptions].map(o => o.value).filter(v => v !== '')
    .map(v => asNumber ? +v : v);
}

// Filiale / Servizio / Codice turno use the shared Autocomplete component (same
// searchable dropdown as the rest of the app). Mirror pattern: the native
// <select> (hidden) stays the value holder that saveEmployee reads; the
// Autocomplete just drives it. Created once, then re-fed items/value per open.
let _empAcs = null;
function _acItemsFromSelect(sel) {
  return Array.prototype.map.call(sel.options, o => ({ value: o.value, label: o.textContent }))
    .filter(o => o.value !== '');
}
function _initEmpAutocompletes() {
  if (typeof Autocomplete !== 'function') return;
  const cfg = [
    ['empf_branch_ids', 'empf_branch_ac', 'Cerca filiale…'],
    ['empf_service_type_ids', 'empf_service_ac', 'Cerca servizio…'],
    ['empf_default_shift_codes', 'empf_shift_ac', 'Cerca codice turno…'],
  ];
  if (!_empAcs) {
    _empAcs = {};
    cfg.forEach(([selId, mountId, ph]) => {
      const sel = document.getElementById(selId), mount = document.getElementById(mountId);
      if (!sel || !mount) return;
      _empAcs[selId] = Autocomplete({
        mount, items: _acItemsFromSelect(sel), placeholder: ph, topLayer: true, max: 100,
        getId: o => o.value, getLabel: o => o.label,
        filterFn: (o, q) => (o.label + ' ' + o.value).toLowerCase().indexOf(q) >= 0,
        onSelect: o => { sel.value = o ? o.value : ''; },
      });
    });
  } else {
    cfg.forEach(([selId]) => { const sel = document.getElementById(selId), ac = _empAcs[selId]; if (sel && ac) ac.setItems(_acItemsFromSelect(sel)); });
  }
  cfg.forEach(([selId]) => { const sel = document.getElementById(selId), ac = _empAcs[selId]; if (sel && ac) { if (sel.value) ac.setValue(sel.value); else ac.clear(); } });
}

// Scheduling is driven by contract working days, not hours: the working days
// come from the work_days picker and the selected contract's rules.
const _empFieldIds = ['first_name','last_name','employee_code','transporter_id','email','phone','device',
  'hire_date','contract_start_date','contract_end_date'];

async function openEmpForm(emp) {
  const refs = await loadEmpRefs();
  const isEdit = !!(emp && emp.id);
  document.getElementById('empEditTitle').textContent = isEdit ? 'Modifica dipendente' : 'Nuovo dipendente';
  document.getElementById('empEditMsg').textContent = '';
  document.getElementById('empEdit').dataset.editId = isEdit ? emp.id : '';

  emp = emp || {};
  _empFieldIds.forEach(f => {
    const el = document.getElementById('empf_' + f);
    let v = emp[f];
    if ((f === 'hire_date' || f === 'contract_start_date' || f === 'contract_end_date') && v) v = String(v).slice(0, 10);
    el.value = v != null ? v : '';
  });
  document.getElementById('empf_status').value = emp.status || 'active';
  fillEmpMultiSelect('empf_branch_ids', refs.branches, 'id',
    b => b.code + (b.name ? ' — ' + b.name : ''), emp.branch_ids, emp.branch_id);
  fillEmpMultiSelect('empf_service_type_ids', refs.services, 'id',
    s => s.name, emp.service_type_ids, emp.service_type_id);
  fillEmpSelect('empf_contract_type_id', refs.contracts, 'id', c => c.label || c.code, emp.contract_type_id);
  // Shift codes come from the configured legend rather than typed free-hand
  fillEmpMultiSelect('empf_default_shift_codes', refs.shiftCodes || [], 'code',
    c => c.code + (c.label && c.label !== c.code ? ' — ' + c.label : ''),
    emp.default_shift_codes, emp.default_shift_code);
  buildEmpDayPicker(emp.work_days);
  _initEmpAutocompletes();   // searchable Filiale / Servizio / Codice turno

  // Photo
  document.getElementById('empf_photo_url').value = emp.photo_url || '';
  document.getElementById('empf_photo_file').value = '';
  _renderEmpPhoto(emp.photo_url || '');
  // Employment type: "Indeterminato" when there is no end date (permanence is
  // modelled by the absence of a contract_end_date), else "Determinato".
  document.getElementById('empf_rapporto').value = emp.contract_end_date ? 'det' : 'ind';
  empOnRapporto();
  // Reset validation + capture a snapshot for the unsaved-changes guard.
  ['err_email', 'err_phone', 'err_code'].forEach((id) => { const e = document.getElementById(id); if (e) e.textContent = ''; });
  _empWireGuards();

  document.getElementById('empEdit').classList.add('on');
  _empSnap = _empFormSig();
  document.getElementById('empf_last_name').focus();
}

// ── Photo upload (client-side resize → base64 into photo_url; no backend change) ──
function _renderEmpPhoto(url) {
  const prev = document.getElementById('empf_photo_prev'); if (!prev) return;
  prev.innerHTML = url ? ('<img src="' + url + '" alt="foto">') : '👤';
  const rm = document.getElementById('empf_photo_rm'); if (rm) rm.style.display = url ? '' : 'none';
}
window.empPhotoPick = function (ev) {
  const file = ev.target.files && ev.target.files[0]; if (!file) return;
  if (!/^image\//.test(file.type)) { toast('Seleziona un file immagine', 'bad'); return; }
  const reader = new FileReader();
  reader.onload = function () {
    const img = new Image();
    img.onload = function () {
      const size = 160, canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d');
      const s = Math.min(img.width, img.height), sx = (img.width - s) / 2, sy = (img.height - s) / 2;
      ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size);   // cover-crop to a square
      const url = canvas.toDataURL('image/jpeg', 0.82);
      document.getElementById('empf_photo_url').value = url;
      _renderEmpPhoto(url);
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
};
window.empPhotoClear = function () {
  document.getElementById('empf_photo_url').value = '';
  document.getElementById('empf_photo_file').value = '';
  _renderEmpPhoto('');
};

// ── Permanent contracts have no end date → disable + clear the field ──
window.empOnRapporto = function () {
  const ind = document.getElementById('empf_rapporto').value === 'ind';
  const end = document.getElementById('empf_contract_end_date');
  const cell = document.getElementById('empf_end_cell');
  if (ind) { end.value = ''; end.disabled = true; if (cell) cell.classList.add('is-disabled'); }
  else { end.disabled = false; if (cell) cell.classList.remove('is-disabled'); }
};

// ── Real-time validation: email, phone, duplicate Employee code ──
window.empValidate = function () {
  let ok = true;
  const email = document.getElementById('empf_email').value.trim();
  const eErr = document.getElementById('err_email');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { eErr.textContent = 'Email non valida'; ok = false; } else eErr.textContent = '';
  const phone = document.getElementById('empf_phone').value.trim();
  const pErr = document.getElementById('err_phone');
  if (phone && !/^[+]?[\d\s().\-]{6,20}$/.test(phone)) { pErr.textContent = 'Telefono non valido'; ok = false; } else pErr.textContent = '';
  const code = document.getElementById('empf_employee_code').value.trim().toLowerCase();
  const cErr = document.getElementById('err_code');
  if (code) {
    const editId = String(document.getElementById('empEdit').dataset.editId || '');
    const dup = _employees.some((e) => String(e.id) !== editId && String(e.employee_code || '').trim().toLowerCase() === code);
    cErr.textContent = dup ? 'Codice già in uso' : ''; if (dup) ok = false;
  } else cErr.textContent = '';
  return ok;
};

// ── Unsaved-changes guard ──
let _empSnap = null, _empGuardsWired = false;
function _empFormSig() {
  const ids = ['empf_last_name', 'empf_first_name', 'empf_employee_code', 'empf_transporter_id', 'empf_email',
    'empf_phone', 'empf_device', 'empf_branch_ids', 'empf_service_type_ids', 'empf_contract_type_id',
    'empf_default_shift_codes', 'empf_status', 'empf_rapporto', 'empf_hire_date', 'empf_contract_start_date',
    'empf_contract_end_date', 'empf_photo_url'];
  return ids.map((id) => { const e = document.getElementById(id); return e ? e.value : ''; }).join('|') + '|' + readEmpDayPicker().join(',');
}
function _empDirty() {
  const m = document.getElementById('empEdit');
  return !!(m && m.classList.contains('on') && _empSnap != null && _empFormSig() !== _empSnap);
}
window.closeEmpForm = function () {
  if (_empDirty() && !window.confirm('Ci sono modifiche non salvate. Chiudere senza salvarle?')) return;
  _empSnap = null;
  closeAll();
};
function _empWireGuards() {
  if (_empGuardsWired) return;
  _empGuardsWired = true;
  // Backdrop click → route through the guard (capture-phase beats modal.js's closeAll).
  const ov = document.getElementById('empEdit');
  if (ov) ov.addEventListener('click', function (e) { if (e.target === ov) { e.stopImmediatePropagation(); closeEmpForm(); } }, true);
  // Section navigation / tab close.
  if (window.AppGuard) AppGuard.register('emp-form', _empDirty);
}

async function editEmployee(id) {
  try {
    const emp = await TurniApi.employeeProfile(id);
    openEmpForm(emp);
  } catch (e) { toast(e.message, 'bad'); }
}

function openNewEmployee() { openEmpForm(null); }

async function saveEmployee(andNew) {
  const msg = document.getElementById('empEditMsg');
  if (!empValidate()) { msg.textContent = 'Correggi i campi evidenziati'; return; }
  const payload = {};
  _empFieldIds.forEach(f => {
    const v = document.getElementById('empf_' + f).value.trim();
    payload[f] = v === '' ? null : v;
  });
  const ct = document.getElementById('empf_contract_type_id').value;
  payload.contract_type_id = ct ? +ct : null;
  payload.status = document.getElementById('empf_status').value;
  payload.work_days = readEmpDayPicker();
  payload.photo_url = document.getElementById('empf_photo_url').value || null;
  // Indeterminato (permanent) = no end date, regardless of what was typed.
  if (document.getElementById('empf_rapporto').value === 'ind') payload.contract_end_date = null;
  // Multi-select fields. The API derives the singular primary column
  // (branch_id / service_type_id / default_shift_code) from the first entry.
  payload.branch_ids          = readEmpMultiSelect('empf_branch_ids', true);
  payload.service_type_ids    = readEmpMultiSelect('empf_service_type_ids', true);
  payload.default_shift_codes = readEmpMultiSelect('empf_default_shift_codes', false);

  if (!payload.first_name || !payload.last_name) {
    msg.textContent = 'Nome e cognome sono obbligatori';
    return;
  }

  const editId = document.getElementById('empEdit').dataset.editId;
  try {
    let saved;
    if (editId) saved = await TurniApi.updateEmployee(+editId, payload);
    else saved = await TurniApi.createEmployee(payload);
    _empSnap = _empFormSig();   // mark clean so the guard doesn't fire on close
    await loadEmployees();
    if (typeof syncSchedulerFromDB === 'function') syncSchedulerFromDB();
    if (andNew) {
      toast(editId ? 'Dipendente aggiornato' : 'Dipendente creato · aggiungi il prossimo');
      openEmpForm(null);          // reset the form, keep the modal open
    } else {
      closeAll();
      if (saved && saved.id) openProfile(saved.id);
      toast(editId ? 'Dipendente aggiornato' : 'Dipendente creato');
    }
  } catch (e) {
    msg.textContent = e.message || 'Errore salvataggio';
  }
}

