/* TurniDSP — Roles & Permissions module (Impostazioni → Ruoli & Permessi)
 *
 * Management UI over /api/roles: role list, a checkbox permission matrix
 * (permissions × roles) grouped by feature area, plus create / clone / delete
 * role. The `admin` column is always-on (super-role) and read-only.
 */
(function () {
  'use strict';

  // Group permission strings by their prefix into human feature areas.
  const AREA_LABELS = {
    employee: 'Dipendenti', contract: 'Contratti', document: 'Documenti',
    absence: 'Assenze', schedule: 'Pianificazione', forecast: 'Forecast',
    disciplinary: 'Disciplinare', team: 'Team', report: 'Report',
    audit: 'Audit', user: 'Utenti', config: 'Configurazione',
  };
  const PERM_VERB = { view: 'Visualizza', manage: 'Gestisci' };

  let _roles = [];       // [{role,label,builtin}]
  let _permissions = []; // ['employee.view', ...]
  let _matrix = {};      // {role:{perm:true}}
  let _usage = {};       // {role:count}
  let _dirty = {};       // {role: Set(perm)} pending edits
  let _rolesInited = false;

  async function bootRoles() {
    const host = document.getElementById('sec-roles');
    if (!host) return;
    if (!_rolesInited) { _rolesInited = true; host.innerHTML = `<div id="rolesRoot"></div>`; }
    await loadRoles();
  }

  async function loadRoles() {
    const root = document.getElementById('rolesRoot');
    root.innerHTML = `<div class="skel" style="height:200px;border-radius:10px"></div>`;
    try {
      const d = await TurniApi.roles();
      _roles = d.roles || [];
      _permissions = d.permissions || [];
      _matrix = d.matrix || {};
      _usage = d.usage || {};
      _dirty = {};
      renderRoles();
    } catch (e) {
      root.innerHTML = `<div class="text-muted" style="padding:16px">Errore: ${esc(e.message)}</div>`;
    }
  }

  function areaOf(perm) { return perm.split('.')[0]; }
  function permLabel(perm) {
    const [, verb] = perm.split('.');
    return PERM_VERB[verb] || verb;
  }
  // Effective (dirty-aware) checkbox state
  function isChecked(role, perm) {
    if (role === 'admin') return true;
    if (_dirty[role]) return _dirty[role].has(perm);
    return !!(_matrix[role] && _matrix[role][perm]);
  }

  function renderRoles() {
    const root = document.getElementById('rolesRoot');
    // group permissions by area, preserving a sensible order
    const areas = [];
    const seen = {};
    _permissions.forEach((p) => { const a = areaOf(p); if (!seen[a]) { seen[a] = []; areas.push(a); } seen[a].push(p); });

    const roleCols = _roles.map((r) =>
      `<th style="text-align:center;min-width:90px">${esc(r.label || r.role)}
        <div class="text-xs text-muted" style="font-weight:400">${esc(r.role)}${r.builtin ? '' : ' ·<br>' + (_usage[r.role] || 0) + ' utenti'}</div>
        ${r.builtin ? '' : `<button class="btn warn sm" style="margin-top:4px" onclick="deleteRoleUi('${esc(r.role)}')">🗑</button>`}
       </th>`).join('');

    let body = '';
    areas.forEach((a) => {
      body += `<tr class="rp-area"><td colspan="${_roles.length + 1}">${esc(AREA_LABELS[a] || a)}</td></tr>`;
      seen[a].forEach((perm) => {
        body += `<tr><td>${esc(permLabel(perm))} <span class="text-xs text-muted">${esc(perm)}</span></td>` +
          _roles.map((r) => {
            const dis = r.role === 'admin';
            return `<td style="text-align:center"><input type="checkbox" ${isChecked(r.role, perm) ? 'checked' : ''} ${dis ? 'disabled' : ''}
              onchange="toggleRolePerm('${esc(r.role)}','${esc(perm)}',this.checked)"></td>`;
          }).join('') + `</tr>`;
      });
    });

    const dirtyRoles = Object.keys(_dirty);
    root.innerHTML = `
      <div class="page-head"><div class="page-title">🔐 Ruoli &amp; Permessi</div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-ghost sm" onclick="openCreateRole()">＋ Nuovo ruolo</button>
          <button class="btn btn-primary sm" id="rolesSaveBtn" ${dirtyRoles.length ? '' : 'disabled'} onclick="saveRoleChanges()">💾 Salva modifiche${dirtyRoles.length ? ' (' + dirtyRoles.length + ')' : ''}</button>
        </div>
      </div>
      <p class="text-sm text-muted" style="margin-bottom:12px">L'amministratore ha sempre accesso completo. Spunta i permessi per ogni ruolo, poi salva.</p>
      <div class="card card-pad" style="overflow-x:auto">
        <table class="tbl rp-matrix">
          <thead><tr><th style="min-width:220px">Permesso</th>${roleCols}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
  }

  // Ensure a dirty set exists for a role, seeded from its current perms.
  function ensureDirty(role) {
    if (!_dirty[role]) {
      const s = new Set();
      _permissions.forEach((p) => { if (_matrix[role] && _matrix[role][p]) s.add(p); });
      _dirty[role] = s;
    }
    return _dirty[role];
  }
  window.toggleRolePerm = function (role, perm, checked) {
    const s = ensureDirty(role);
    if (checked) s.add(perm); else s.delete(perm);
    // refresh only the save button state
    const btn = document.getElementById('rolesSaveBtn');
    const n = Object.keys(_dirty).length;
    if (btn) { btn.disabled = n === 0; btn.textContent = '💾 Salva modifiche' + (n ? ' (' + n + ')' : ''); }
  };

  window.saveRoleChanges = async function () {
    const roles = Object.keys(_dirty);
    if (!roles.length) return;
    try {
      for (const role of roles) {
        await TurniApi.updateRolePermissions(role, [..._dirty[role]]);
      }
      toast(`Permessi aggiornati (${roles.length} ruol${roles.length === 1 ? 'o' : 'i'})`, 'ok');
      await loadRoles();
    } catch (e) { toast('Errore: ' + e.message, 'bad'); }
  };

  // ── Create / clone role ──────────────────────────────────────────
  window.openCreateRole = function () {
    const opts = _roles.map((r) => `<option value="${esc(r.role)}">${esc(r.label || r.role)}</option>`).join('');
    document.getElementById('roleCloneFrom').innerHTML = `<option value="">Nessuno (vuoto)</option>` + opts;
    document.getElementById('roleNewCode').value = '';
    document.getElementById('roleNewLabel').value = '';
    document.getElementById('roleModalMsg').textContent = '';
    document.getElementById('roleModal').classList.add('on');
  };
  window.saveNewRole = async function () {
    const role = document.getElementById('roleNewCode').value.trim();
    const label = document.getElementById('roleNewLabel').value.trim();
    const clone_from = document.getElementById('roleCloneFrom').value || null;
    const msg = document.getElementById('roleModalMsg');
    if (!role) { msg.textContent = 'Indica il codice del ruolo'; return; }
    try {
      await TurniApi.createRole({ role, label: label || role, clone_from });
      closeAll();
      toast('Ruolo creato', 'ok');
      await loadRoles();
    } catch (e) { msg.textContent = e.message || 'Errore'; }
  };
  window.deleteRoleUi = async function (role) {
    if ((_usage[role] || 0) > 0) { toast(`Ruolo assegnato a ${_usage[role]} utenti`, 'warn'); return; }
    if (!window.confirm(`Eliminare il ruolo “${role}”?`)) return;
    try {
      await TurniApi.deleteRole(role);
      toast('Ruolo eliminato', 'ok');
      await loadRoles();
    } catch (e) { toast('Errore: ' + e.message, 'bad'); }
  };

  window.bootRoles = bootRoles;
})();
