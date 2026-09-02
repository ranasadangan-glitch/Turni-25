/* TurniDSP — Codici (standalone shift-code management)
 *
 * Realizes the flow: Dipendente → Codice → Codice (descrizione) → Categoria.
 * CRUD over /api/codes, which edits scheduler_config[branch].codes (the source
 * of truth) and re-derives the shift_codes read-model server-side. Codes feed
 * the scheduler and the employee "codice predefinito" (default_shift_code).
 * Writes require config.manage; rendered into the #sec-codes section.
 */
(function () {
  'use strict';

  const CAT_LABELS = {
    next: 'NEXT', samea: 'Same A', sameb: 'Same B', mm: 'CargoBike / MM',
    abs: 'Altri servizi', mal: 'Assenze', off: 'Riposo',
  };

  let _cats = [];
  let _codes = [];
  let _inited = false;
  let _editing = null; // null = form closed, '' = new, or an existing code string

  async function bootCodes() {
    const host = document.getElementById('sec-codes');
    if (!host) return;
    if (!_inited) { _inited = true; host.innerHTML = '<div id="codesRoot"></div>'; }
    await loadCodes();
  }

  async function loadCodes() {
    const root = document.getElementById('codesRoot');
    if (!root) return;
    root.innerHTML = '<div class="skel" style="height:200px;border-radius:10px"></div>';
    try {
      const d = await TurniApi.codes();
      _cats = d.categories || [];
      _codes = d.codes || [];
      render();
    } catch (e) {
      root.innerHTML = '<div class="text-muted" style="padding:16px">Errore: ' + esc(e.message) + '</div>';
    }
  }

  const catLabel = (c) => CAT_LABELS[c] || c;
  const catOptions = (sel) => _cats.map((c) =>
    '<option value="' + esc(c) + '"' + (c === sel ? ' selected' : '') + '>' + esc(catLabel(c)) + '</option>').join('');
  const find = (code) => _codes.find((c) => c.code === code);
  const curLabel = (code) => { const c = code && find(code); return c ? c.label : ''; };
  const curCat = (code) => { const c = code && find(code); return c ? c.category : (_cats[0] || 'abs'); };

  function render() {
    const root = document.getElementById('codesRoot');
    if (!root) return;

    const byCat = {};
    _codes.forEach((c) => { (byCat[c.category] = byCat[c.category] || []).push(c); });

    let body = '';
    _cats.forEach((cat) => {
      const list = byCat[cat] || [];
      if (!list.length) return;
      body += '<tr class="rp-area"><td colspan="3">' + esc(catLabel(cat)) +
        ' <span class="text-xs text-muted">(' + list.length + ')</span></td></tr>';
      list.forEach((c) => {
        body += '<tr><td><strong>' + esc(c.code) + '</strong></td>' +
          '<td>' + (esc(c.label) || '<span class="text-xs text-muted">—</span>') + '</td>' +
          '<td style="text-align:right;white-space:nowrap">' +
          '<button class="btn btn-ghost sm" ' + actAttr('click', 'codeEdit', [c.code]) + '>✏️</button> ' +
          '<button class="btn warn sm" ' + actAttr('click', 'codeDelete', [c.code]) + '>🗑</button></td></tr>';
      });
    });
    if (!_codes.length) {
      body = '<tr><td colspan="3" class="text-muted" style="padding:16px">Nessun codice. Aggiungine uno.</td></tr>';
    }

    const ed = _editing;
    const form = ed !== null ? (
      '<div class="card card-pad" style="margin-bottom:14px">' +
        '<div style="font-weight:600;margin-bottom:8px">' + (ed ? 'Modifica codice: ' + esc(ed) : 'Nuovo codice') + '</div>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">' +
          '<label>Codice<br><input id="cCode" class="inp" value="' + (ed ? esc(ed) : '') + '"' + (ed ? ' disabled' : '') +
            ' placeholder="es. NAV" style="text-transform:uppercase;max-width:140px"></label>' +
          '<label>Descrizione<br><input id="cLabel" class="inp" value="' + esc(curLabel(ed)) + '" placeholder="es. Navetta"></label>' +
          '<label>Categoria<br><select id="cCat" class="inp">' + catOptions(curCat(ed)) + '</select></label>' +
          '<button class="btn btn-primary sm" ' + actAttr('click', 'codeSave') + '>💾 Salva</button>' +
          '<button class="btn btn-ghost sm" ' + actAttr('click', 'codeCancel') + '>Annulla</button>' +
        '</div>' +
        '<div id="codeMsg" class="text-xs" style="color:var(--danger,#c00);margin-top:6px"></div>' +
      '</div>') : '';

    root.innerHTML =
      '<div class="page-head"><div class="page-title">🏷️ Codici</div>' +
        '<button class="btn btn-primary sm" ' + actAttr('click', 'codeNew') + '>＋ Nuovo codice</button></div>' +
      '<p class="text-sm text-muted" style="margin-bottom:12px">Gestione codici turno: <strong>codice</strong>, ' +
        '<strong>descrizione</strong> e <strong>categoria</strong>. I codici alimentano lo scheduler e il codice ' +
        'predefinito del dipendente.</p>' +
      form +
      '<div class="card card-pad" style="overflow-x:auto"><table class="tbl">' +
        '<thead><tr><th style="min-width:90px">Codice</th><th>Descrizione</th>' +
        '<th style="text-align:right">Azioni</th></tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  window.codeNew = function () { _editing = ''; render(); };
  window.codeEdit = function (code) { _editing = code; render(); };
  window.codeCancel = function () { _editing = null; render(); };

  window.codeSave = async function () {
    const isNew = _editing === '';
    const codeEl = document.getElementById('cCode');
    const code = isNew ? (codeEl ? codeEl.value.trim() : '') : _editing;
    const label = (document.getElementById('cLabel') || {}).value ? document.getElementById('cLabel').value.trim() : '';
    const category = (document.getElementById('cCat') || {}).value || '';
    const msg = document.getElementById('codeMsg');
    if (!code) { if (msg) msg.textContent = 'Indica il codice'; return; }
    try {
      if (isNew) await TurniApi.createCode({ code, label, category });
      else await TurniApi.updateCode(code, { label, category });
      _editing = null;
      toast(isNew ? 'Codice creato' : 'Codice aggiornato', 'ok');
      await loadCodes();
    } catch (e) { if (msg) msg.textContent = e.message || 'Errore'; }
  };

  window.codeDelete = async function (code) {
    if (!window.confirm('Eliminare il codice “' + code + '”?')) return;
    try { await TurniApi.deleteCode(code); toast('Codice eliminato', 'ok'); await loadCodes(); }
    catch (e) { toast('Errore: ' + e.message, 'bad'); }
  };

  window.bootCodes = bootCodes;
})();
