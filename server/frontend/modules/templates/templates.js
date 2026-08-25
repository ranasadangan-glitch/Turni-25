/* TurniDSP — Shift Templates module (Personale → Template Turni)
 *
 * Reusable weekly shift templates over /api/schedules/templates (GET/POST/PUT/
 * DELETE). The rich config (color, service, break, Mon–Sun grid) is
 * stored inside the pattern JSONB so the DB schema is unchanged.
 *
 * "Apply" writes the template's weekly pattern across the planner's currently
 * open month for all in-scope drivers, reusing the scheduler engine's state.
 */
(function () {
  'use strict';

  const DOW = [{ n: 1, l: 'Lun' }, { n: 2, l: 'Mar' }, { n: 3, l: 'Mer' }, { n: 4, l: 'Gio' },
               { n: 5, l: 'Ven' }, { n: 6, l: 'Sab' }, { n: 7, l: 'Dom' }];
  const PALETTE = ['#1F5FBF', '#2E9E5B', '#C77700', '#7A3FB8', '#0E7E74', '#D6453D', '#B97E10', '#475066'];

  // Quick-create presets. days keyed by ISO weekday 1=Mon..7=Sun.
  const PRESETS = [
    { name: 'Mattina',  color: '#1F5FBF', service: 'NEXT',  brk: 30, days: { 1: 'X', 2: 'X', 3: 'X', 4: 'X', 5: 'X', 6: 'OFF', 7: 'OFF' } },
    { name: 'Pomeriggio', color: '#7A3FB8', service: 'SAMEA', brk: 30, days: { 1: 'SameA', 2: 'SameA', 3: 'SameA', 4: 'SameA', 5: 'SameA', 6: 'OFF', 7: 'OFF' } },
    { name: 'Cargo',    color: '#C77700', service: 'MM',    brk: 20, days: { 1: 'MM', 2: 'MM', 3: 'MM', 4: 'MM', 5: 'MM', 6: 'MM', 7: 'OFF' } },
    { name: 'Same Day', color: '#2E9E5B', service: 'SAMEAE', brk: 30, days: { 1: 'SameAE', 2: 'SameAE', 3: 'SameAE', 4: 'SameAE', 5: 'SameAE', 6: 'SameAE', 7: 'OFF' } },
    { name: 'Personalizzato', color: '#475066', service: '', brk: 30, days: {} },
  ];

  let _tplAll = [];
  let _tplRefs = null;   // { codes, services, branches }
  let _tplInited = false;
  let _tplEditId = null;

  // Old templates stored pattern as a bare {"1":"X"} map; new ones wrap it as
  // {days,color,service,brk}. Normalise both to one shape.
  function normPattern(p) {
    p = p || {};
    if (p.days && typeof p.days === 'object') {
      return { days: p.days, color: p.color || '#1F5FBF', service: p.service || '', brk: p.brk != null ? p.brk : 30 };
    }
    return { days: p, color: '#1F5FBF', service: '', brk: 30 };
  }

  async function bootTemplates() {
    const host = document.getElementById('sec-templates');
    if (!host) return;
    if (!_tplInited) {
      _tplInited = true;
      host.innerHTML = tplShellHtml();
    }
    if (!_tplRefs) {
      const [codes, services, branches] = await Promise.all([
        TurniApi.shiftCodes().catch(() => []),
        TurniApi.serviceTypes().catch(() => []),
        TurniApi.branches().catch(() => []),
      ]);
      _tplRefs = { codes, services, branches };
    }
    await loadTemplates();
  }

  function tplShellHtml() {
    const presetCards = PRESETS.map((p, i) =>
      `<button class="tpl-preset" onclick="openTemplateFromPreset(${i})" style="border-left:4px solid ${p.color}">
         <div style="font-weight:700">${esc(p.name)}</div>
         <div class="text-xs text-muted">${weekPreview(p.days)}</div>
       </button>`).join('');
    return `
      <div class="page-head"><div class="page-title">📋 Template Turni</div>
        <button class="btn btn-primary" onclick="openTemplate()">＋ Nuovo template</button>
      </div>
      <div class="card card-pad mb-4">
        <div class="section-title mb-2">Preset rapidi</div>
        <div class="tpl-preset-row">${presetCards}</div>
      </div>
      <div id="tplGrid" class="tpl-grid"></div>`;
  }

  function weekPreview(days) {
    return DOW.map((d) => {
      const c = days[d.n] || days[String(d.n)];
      return c ? esc(c) : '·';
    }).join(' ');
  }

  async function loadTemplates() {
    try {
      _tplAll = await TurniApi.templates();
      renderTemplates();
    } catch (e) {
      const g = document.getElementById('tplGrid');
      if (g) g.innerHTML = `<div class="text-muted" style="padding:16px">Errore: ${esc(e.message)}</div>`;
    }
  }

  function branchName(id) {
    const b = (_tplRefs.branches || []).find((x) => String(x.id) === String(id));
    return b ? b.code : '';
  }

  function renderTemplates() {
    const g = document.getElementById('tplGrid');
    if (!g) return;
    if (!_tplAll.length) {
      g.innerHTML = `<div class="card card-pad" style="grid-column:1/-1;text-align:center;padding:36px;color:var(--text-muted)">
        Nessun template. Crea il primo dai preset qui sopra o con “Nuovo template”.</div>`;
      return;
    }
    g.innerHTML = _tplAll.map((t) => {
      const p = normPattern(t.pattern);
      const grid = DOW.map((d) => {
        const c = p.days[d.n] || p.days[String(d.n)] || '';
        const off = !c || c.toUpperCase() === 'OFF';
        return `<div class="tpl-day ${off ? 'off' : ''}"><span class="tpl-dow">${d.l}</span><span class="tpl-code">${off ? 'OFF' : esc(c)}</span></div>`;
      }).join('');
      return `<div class="card tpl-card" style="border-top:3px solid ${p.color}">
        <div class="tpl-card-head">
          <div><div class="tpl-name">${esc(t.name)}</div>
            <div class="text-xs text-muted">${p.service ? esc(p.service) + ' · ' : ''}pausa ${p.brk}min${t.branch_id ? ' · ' + esc(branchName(t.branch_id)) : ''}</div></div>
        </div>
        <div class="tpl-week">${grid}</div>
        <div class="tpl-actions">
          <button class="btn btn-primary sm" onclick="applyTemplate(${t.id})">▶ Applica</button>
          <button class="btn ghost sm" onclick="openTemplate(${t.id})">✏️ Modifica</button>
          <button class="btn ghost sm" onclick="duplicateTemplate(${t.id})">⧉ Duplica</button>
          <button class="btn warn sm" onclick="deleteTemplate_(${t.id})">🗑</button>
        </div>
      </div>`;
    }).join('');
  }

  // ── Editor ───────────────────────────────────────────────────────
  function codeOptions(sel) {
    const codes = (_tplRefs.codes || []).map((c) => c.code);
    if (!codes.includes('OFF')) codes.unshift('OFF');
    return `<option value="">—</option>` + codes.map((c) => `<option value="${esc(c)}"${c === sel ? ' selected' : ''}>${esc(c)}</option>`).join('');
  }

  window.openTemplateFromPreset = function (i) { openTemplate(null, PRESETS[i]); };
  window.openTemplate = function (id, preset) {
    _tplEditId = id || null;
    const t = id ? _tplAll.find((x) => x.id === id) : null;
    const p = t ? normPattern(t.pattern) : (preset ? { days: preset.days, color: preset.color, service: preset.service, brk: preset.brk } : { days: {}, color: '#1F5FBF', service: '', brk: 30 });

    document.getElementById('tplModalTitle').textContent = t ? 'Modifica template' : 'Nuovo template';
    document.getElementById('tplName').value = t ? t.name : (preset ? preset.name : '');
    document.getElementById('tplBreak').value = p.brk;
    document.getElementById('tplModalMsg').textContent = '';

    // colour swatches
    document.getElementById('tplColors').innerHTML = PALETTE.map((c) =>
      `<button type="button" class="tpl-swatch${c === p.color ? ' on' : ''}" data-c="${c}" style="background:${c}" onclick="pickTplColor('${c}')"></button>`).join('');

    // service select
    const svcOpts = `<option value="">—</option>` + (_tplRefs.services || []).map((s) =>
      `<option value="${esc(s.code || s.name)}"${(s.code || s.name) === p.service ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
    document.getElementById('tplService').innerHTML = svcOpts;

    // branch select
    const brOpts = `<option value="">Tutte</option>` + (_tplRefs.branches || []).map((b) =>
      `<option value="${b.id}"${String(b.id) === String(t && t.branch_id) ? ' selected' : ''}>${esc(b.code)}</option>`).join('');
    document.getElementById('tplBranch').innerHTML = brOpts;

    // weekly grid
    document.getElementById('tplWeek').innerHTML = DOW.map((d) => {
      const c = p.days[d.n] || p.days[String(d.n)] || '';
      return `<div class="tpl-daycol"><label class="lbl">${d.l}</label>
        <select class="sel tpl-daysel" data-d="${d.n}">${codeOptions(c || 'OFF')}</select></div>`;
    }).join('');

    document.getElementById('tplModal').dataset.color = p.color;
    document.getElementById('tplModal').classList.add('on');
  };
  window.pickTplColor = function (c) {
    document.getElementById('tplModal').dataset.color = c;
    document.querySelectorAll('#tplColors .tpl-swatch').forEach((b) => b.classList.toggle('on', b.dataset.c === c));
  };

  function collectTemplate() {
    const days = {};
    document.querySelectorAll('#tplWeek .tpl-daysel').forEach((s) => { if (s.value) days[s.dataset.d] = s.value; });
    return {
      name: document.getElementById('tplName').value.trim(),
      branch_id: +document.getElementById('tplBranch').value || null,
      pattern: {
        days,
        color: document.getElementById('tplModal').dataset.color || '#1F5FBF',
        service: document.getElementById('tplService').value || '',
        brk: +document.getElementById('tplBreak').value || 0,
      },
    };
  }
  window.saveTemplate = async function () {
    const msg = document.getElementById('tplModalMsg');
    const payload = collectTemplate();
    if (!payload.name) { msg.textContent = 'Indica un nome'; return; }
    if (!Object.keys(payload.pattern.days).length) { msg.textContent = 'Assegna almeno un giorno'; return; }
    try {
      if (_tplEditId) { const u = await TurniApi.updateTemplate(_tplEditId, payload); const i = _tplAll.findIndex((x) => x.id === _tplEditId); if (i >= 0) _tplAll[i] = u; }
      else { const c = await TurniApi.createTemplate(payload); _tplAll.push(c); }
      closeAll();
      renderTemplates();
      toast(_tplEditId ? 'Template aggiornato' : 'Template creato', 'ok');
    } catch (e) { msg.textContent = e.message || 'Errore salvataggio'; }
  };

  window.duplicateTemplate = async function (id) {
    const t = _tplAll.find((x) => x.id === id);
    if (!t) return;
    try {
      const c = await TurniApi.createTemplate({ name: t.name + ' (copia)', branch_id: t.branch_id, pattern: normPattern(t.pattern) });
      _tplAll.push(c);
      renderTemplates();
      toast('Template duplicato', 'ok');
    } catch (e) { toast('Errore: ' + e.message, 'bad'); }
  };
  window.deleteTemplate_ = async function (id) {
    const t = _tplAll.find((x) => x.id === id);
    if (!window.confirm(`Eliminare il template “${t ? t.name : ''}”?`)) return;
    try {
      await TurniApi.deleteTemplate(id);
      _tplAll = _tplAll.filter((x) => x.id !== id);
      renderTemplates();
      toast('Template eliminato', 'ok');
    } catch (e) { toast('Errore: ' + e.message, 'bad'); }
  };

  // ── Apply to the planner's current month ─────────────────────────
  window.applyTemplate = function (id) {
    const t = _tplAll.find((x) => x.id === id);
    if (!t) return;
    if (typeof state === 'undefined' || !state || !Array.isArray(state.drivers) || !state.drivers.length) {
      toast('Apri prima il planner (Pianificazione) con i DAS caricati', 'warn');
      return;
    }
    const branchOpts = (_tplRefs.branches || []).map((b) => `<option value="${esc(b.code)}">${esc(b.code)}</option>`).join('');
    document.getElementById('tplApplyName').textContent = t.name;
    document.getElementById('tplApplyBranch').innerHTML = `<option value="">Tutte le filiali</option>` + branchOpts;
    document.getElementById('tplApplyMonth').textContent = (typeof YM !== 'undefined') ? YM : '';
    document.getElementById('tplApplyModal').dataset.tplId = id;
    document.getElementById('tplApplyModal').classList.add('on');
  };
  window.confirmApplyTemplate = function () {
    const id = +document.getElementById('tplApplyModal').dataset.tplId;
    const branch = document.getElementById('tplApplyBranch').value || '';
    const t = _tplAll.find((x) => x.id === id);
    const p = normPattern(t.pattern);
    const days = daysInMonth(YM);
    const drivers = state.drivers.filter((d) => !branch || d.filiale === branch);
    if (!drivers.length) { toast('Nessun DAS per la filiale selezionata', 'warn'); return; }
    drivers.forEach((dr) => {
      if (!state.schedule[dr.id]) state.schedule[dr.id] = {};
      for (let day = 1; day <= days; day++) {
        const jsDow = new Date(YM + '-' + String(day).padStart(2, '0')).getDay(); // 0=Sun..6=Sat
        const iso = jsDow === 0 ? 7 : jsDow;                                       // 1=Mon..7=Sun
        const code = p.days[iso] || p.days[String(iso)];
        if (code && code.toUpperCase() !== 'OFF') state.schedule[dr.id][day] = code;
        else state.schedule[dr.id][day] = 'OFF';
      }
    });
    if (typeof saveAll === 'function') { try { saveAll(true); } catch (e) {} }
    if (typeof refreshAll === 'function') { try { refreshAll(); } catch (e) {} }
    closeAll();
    toast(`Template “${t.name}” applicato a ${drivers.length} DAS (${YM})`, 'ok');
  };

  window.bootTemplates = bootTemplates;
})();
