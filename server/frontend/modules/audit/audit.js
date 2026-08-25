/* TurniDSP — Audit Log module (Report & Analytics → Audit Log)
 *
 * Enterprise timeline over /api/audit (audit_log: ts, username, role, entity,
 * entity_id, action, detail, ip). Date / user / action / entity filters +
 * search, coloured action badges, and CSV / Excel / PDF export.
 */
(function () {
  'use strict';

  const ACTION_META = {
    create:  { label: 'Creazione', cls: 'b-ok',    icon: '➕' },
    update:  { label: 'Modifica',  cls: 'b-pri',   icon: '✏️' },
    delete:  { label: 'Eliminazione', cls: 'b-bad', icon: '🗑' },
    approve: { label: 'Approvazione', cls: 'b-ok',  icon: '✔' },
    reject:  { label: 'Rifiuto',   cls: 'b-bad',   icon: '✖' },
    login:   { label: 'Accesso',   cls: 'b-muted', icon: '🔐' },
    logout:  { label: 'Uscita',    cls: 'b-muted', icon: '🚪' },
    export:  { label: 'Esportazione', cls: 'b-teal', icon: '⬇' },
  };
  const actMeta = (a) => ACTION_META[a] || { label: a || '—', cls: 'b-muted', icon: '⚡' };

  let _audAll = [];
  let _audInited = false;
  let _audSearchTimer = null;

  async function bootAudit() {
    const host = document.getElementById('sec-auditlog');
    if (!host) return;
    if (!_audInited) {
      _audInited = true;
      host.innerHTML = audShellHtml();
      wireAudFilters();
    }
    await loadAudit();
  }

  function audShellHtml() {
    return `
      <div class="page-head"><div class="page-title">📝 Audit Log</div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-ghost sm" onclick="exportAudit('csv')">⬇ CSV</button>
          <button class="btn btn-ghost sm" onclick="exportAudit('xls')">⬇ Excel</button>
          <button class="btn btn-ghost sm" onclick="exportAudit('pdf')">🖨 PDF</button>
        </div>
      </div>
      <div class="card card-pad mb-4">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end">
          <div><label class="lbl">Dal</label><input id="audfFrom" type="date" class="inp"></div>
          <div><label class="lbl">Al</label><input id="audfTo" type="date" class="inp"></div>
          <div><label class="lbl">Utente</label><select id="audfUser" class="sel"></select></div>
          <div><label class="lbl">Azione</label><select id="audfAction" class="sel"></select></div>
          <div><label class="lbl">Entità</label><select id="audfEntity" class="sel"></select></div>
          <div style="flex:1;min-width:150px"><label class="lbl">Cerca</label><input id="audfSearch" class="inp" placeholder="Utente, dettaglio…" autocomplete="off"></div>
        </div>
      </div>
      <div class="card card-pad">
        <div id="audCount" class="text-xs text-muted" style="margin-bottom:10px"></div>
        <div id="audTimeline"></div>
      </div>`;
  }

  function wireAudFilters() {
    ['audfFrom', 'audfTo', 'audfUser', 'audfAction', 'audfEntity'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', renderAudit);
    });
    const s = document.getElementById('audfSearch');
    if (s) s.addEventListener('input', () => { clearTimeout(_audSearchTimer); _audSearchTimer = setTimeout(renderAudit, 200); });
  }

  async function loadAudit() {
    try {
      _audAll = await TurniApi.audit({ limit: 1000 });
      fillAudFilters();
      renderAudit();
    } catch (e) {
      const t = document.getElementById('audTimeline');
      if (t) t.innerHTML = `<div class="text-muted" style="padding:16px">Errore: ${esc(e.message)}</div>`;
    }
  }

  function fillAudFilters() {
    const distinct = (key) => [...new Set(_audAll.map((r) => r[key]).filter(Boolean))].sort();
    const setSel = (id, vals, allLabel, meta) => {
      const el = document.getElementById(id);
      if (!el) return;
      const prev = el.value;
      el.innerHTML = `<option value="">${allLabel}</option>` + vals.map((v) =>
        `<option value="${esc(v)}">${esc(meta ? (meta(v).label || v) : v)}</option>`).join('');
      if (prev) el.value = prev;
    };
    setSel('audfUser', distinct('username'), 'Tutti');
    setSel('audfAction', distinct('action'), 'Tutte', actMeta);
    setSel('audfEntity', distinct('entity'), 'Tutte');
  }

  function filteredAudit() {
    const from = (document.getElementById('audfFrom') || {}).value || '';
    const to = (document.getElementById('audfTo') || {}).value || '';
    const user = (document.getElementById('audfUser') || {}).value || '';
    const action = (document.getElementById('audfAction') || {}).value || '';
    const entity = (document.getElementById('audfEntity') || {}).value || '';
    const q = ((document.getElementById('audfSearch') || {}).value || '').toLowerCase().trim();
    return _audAll.filter((r) => {
      const day = String(r.ts).slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      if (user && r.username !== user) return false;
      if (action && r.action !== action) return false;
      if (entity && r.entity !== entity) return false;
      if (q) {
        const hay = `${r.username || ''} ${r.action || ''} ${r.entity || ''} ${r.detail || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function fmtTime(ts) {
    try { return new Date(ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return ''; }
  }
  function fmtDay(iso) {
    try { return new Date(iso).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
    catch (e) { return iso; }
  }

  function renderAudit() {
    const wrap = document.getElementById('audTimeline');
    if (!wrap) return;
    const rows = filteredAudit();
    const cnt = document.getElementById('audCount');
    if (cnt) cnt.textContent = `${rows.length} event${rows.length === 1 ? 'o' : 'i'}`;
    if (!rows.length) {
      wrap.innerHTML = `<div class="text-muted" style="padding:28px;text-align:center">Nessun evento trovato.</div>`;
      return;
    }
    // group by day
    const byDay = {};
    rows.forEach((r) => { const d = String(r.ts).slice(0, 10); (byDay[d] = byDay[d] || []).push(r); });
    const days = Object.keys(byDay).sort().reverse();
    wrap.innerHTML = days.map((d) => `
      <div class="aud-day"><span class="aud-day-label">${esc(fmtDay(d))}</span></div>
      <div class="aud-timeline">${byDay[d].map(auditItemHtml).join('')}</div>
    `).join('');
  }

  function auditItemHtml(r) {
    const m = actMeta(r.action);
    return `<div class="aud-item">
      <div class="aud-dot ${m.cls}">${m.icon}</div>
      <div class="aud-body">
        <div class="aud-line">
          <span class="badge ${m.cls}">${esc(m.label)}</span>
          <b>${esc(r.username || '—')}</b>${r.role ? ` <span class="text-xs text-muted">${esc(r.role)}</span>` : ''}
          ${r.entity ? `<span class="text-xs text-muted">· ${esc(r.entity)}${r.entity_id ? ' #' + esc(r.entity_id) : ''}</span>` : ''}
          <span class="aud-time">${fmtTime(r.ts)}</span>
        </div>
        ${r.detail ? `<div class="aud-detail">${esc(r.detail)}</div>` : ''}
        ${r.ip ? `<div class="aud-ip text-xs text-muted">IP ${esc(r.ip)}</div>` : ''}
      </div>
    </div>`;
  }

  // ── Export ───────────────────────────────────────────────────────
  function exportRows() {
    return filteredAudit().map((r) => ({
      DataOra: new Date(r.ts).toLocaleString('it-IT'),
      Utente: r.username || '',
      Ruolo: r.role || '',
      Azione: (actMeta(r.action).label || r.action || ''),
      Entita: r.entity || '',
      ID: r.entity_id || '',
      Dettaglio: r.detail || '',
      IP: r.ip || '',
    }));
  }
  function download(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  window.exportAudit = function (fmt) {
    const rows = exportRows();
    if (!rows.length) { toast('Nessun evento da esportare', 'warn'); return; }
    const cols = Object.keys(rows[0]);
    const stamp = new Date().toISOString().slice(0, 10);
    if (fmt === 'csv') {
      const esc2 = (v) => `"${String(v).replace(/"/g, '""')}"`;
      const csv = [cols.join(';'), ...rows.map((r) => cols.map((c) => esc2(r[c])).join(';'))].join('\r\n');
      download('﻿' + csv, `audit_${stamp}.csv`, 'text/csv;charset=utf-8');
    } else if (fmt === 'xls') {
      // HTML-table workbook — opens natively in Excel.
      const html = `<table border="1"><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr>` +
        rows.map((r) => `<tr>${cols.map((c) => `<td>${esc(String(r[c]))}</td>`).join('')}</tr>`).join('') + '</table>';
      download('﻿' + html, `audit_${stamp}.xls`, 'application/vnd.ms-excel');
    } else if (fmt === 'pdf') {
      const w = window.open('', '_blank');
      if (!w) { toast('Popup bloccato dal browser', 'warn'); return; }
      w.document.write(`<html><head><title>Audit Log ${stamp}</title>
        <style>body{font-family:Arial,sans-serif;font-size:11px;padding:16px}h1{font-size:16px}
        table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:4px 6px;text-align:left}
        th{background:#f2f2f2}</style></head><body>
        <h1>Audit Log — ${stamp}</h1>
        <table><thead><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td>${esc(String(r[c]))}</td>`).join('')}</tr>`).join('')}</tbody></table>
        </body></html>`);
      w.document.close();
      w.focus();
      setTimeout(() => w.print(), 300);
    }
  };

  window.bootAudit = bootAudit;
})();
