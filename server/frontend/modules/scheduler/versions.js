/* TurniDSP — Schedule Version History (Step 12)
 * ---------------------------------------------------------------------------
 * Save the current month's schedule as a named version, list past versions,
 * restore or compare them. Snapshots are the state.schedule map (per month +
 * branch); restoring is a client-side apply, so no live table is touched until
 * the user restores. Integrated into the existing Scheduler page.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  function verBranch() { return (typeof teamFiliale !== 'undefined' && teamFiliale) || (typeof filiali === 'function' && filiali()[0]) || 'DLO1'; }

  // Coverage % of the current in-memory schedule (forecast vs planned).
  function currentCoverage() {
    try {
      const svs = services().filter((s) => !s.minOf);
      const drivers = activeDrivers();
      const days = daysInMonth(YM);
      let fc = 0, pl = 0;
      for (const s of svs) for (let d = 1; d <= days; d++) { const f = forecastOf(s, d); fc += f; pl += Math.min(f, harmonyOf(s, d, drivers)); }
      return fc ? Math.round(pl / fc * 100) : 0;
    } catch (e) { return null; }
  }

  window.openVersions = function () {
    document.getElementById('verLabel').value = '';
    document.getElementById('verModal').classList.add('on');
    loadVersions();
  };

  async function loadVersions() {
    const body = document.getElementById('verList');
    body.innerHTML = "<div class='skel' style='height:80px;border-radius:8px'></div>";
    try {
      const rows = await TurniApi.schedulerVersions(YM, verBranch());
      if (!rows.length) { body.innerHTML = "<div class='text-muted text-sm' style='padding:14px'>Nessuna versione salvata per " + esc(YM) + " · " + esc(verBranch()) + ".</div>"; return; }
      body.innerHTML = rows.map((v) => {
        const when = new Date(v.created_at).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
        const cov = v.coverage_pct != null ? "<span class='badge " + (v.coverage_pct >= 95 ? 'b-ok' : v.coverage_pct >= 80 ? 'b-warn' : 'b-bad') + "'>" + v.coverage_pct + "%</span>" : '';
        return "<div class='ver-row'>" +
          "<div style='flex:1'><b>" + esc(v.label) + "</b> " + cov +
          "<div class='text-xs text-muted'>" + esc(v.created_by || '') + " · " + when + "</div></div>" +
          "<div style='display:flex;gap:5px'>" +
          "<button class='btn ghost sm' onclick='compareVersion(" + v.id + ")'>Confronta</button>" +
          "<button class='btn btn-primary sm' onclick='restoreVersion(" + v.id + ")'>Ripristina</button>" +
          "<button class='btn warn sm' onclick='deleteVersion(" + v.id + ")'>🗑</button></div></div>";
      }).join('');
    } catch (e) { body.innerHTML = "<div style='color:var(--bad);padding:12px'>Errore: " + esc(e.message) + "</div>"; }
  }

  window.saveCurrentVersion = async function () {
    const label = document.getElementById('verLabel').value.trim();
    try {
      const v = await TurniApi.saveSchedulerVersion({
        month: YM, branch_code: verBranch(),
        label: label || null,
        snapshot: state.schedule || {},
        coverage_pct: currentCoverage(),
      });
      toast('Versione salvata: ' + v.label, 'ok');
      document.getElementById('verLabel').value = '';
      loadVersions();
    } catch (e) { toast('Errore: ' + e.message, 'bad'); }
  };

  let _preRestore = null;
  window.restoreVersion = async function (id) {
    if (!window.confirm('Ripristinare questa versione? Lo schedule corrente verrà sostituito (puoi annullare subito dopo).')) return;
    try {
      const v = await TurniApi.schedulerVersion(id);
      _preRestore = JSON.parse(JSON.stringify(state.schedule || {}));
      state.schedule = v.snapshot || {};
      if (typeof dirty === 'function') { try { dirty(); } catch (e) {} }
      if (typeof logAction === 'function') logAction('Versione ripristinata: ' + v.label);
      if (typeof refreshAll === 'function') refreshAll();
      closeAll();
      toast('Versione "' + v.label + '" ripristinata', 'ok');
      const btn = document.getElementById('verUndoBtn'); if (btn) btn.style.display = '';
    } catch (e) { toast('Errore: ' + e.message, 'bad'); }
  };
  window.undoRestore = function () {
    if (!_preRestore) { toast('Niente da annullare'); return; }
    state.schedule = _preRestore; _preRestore = null;
    if (typeof dirty === 'function') { try { dirty(); } catch (e) {} }
    if (typeof refreshAll === 'function') refreshAll();
    const btn = document.getElementById('verUndoBtn'); if (btn) btn.style.display = 'none';
    toast('Ripristino annullato', 'ok');
  };

  window.compareVersion = async function (id) {
    try {
      const v = await TurniApi.schedulerVersion(id);
      const snap = v.snapshot || {};
      const cur = state.schedule || {};
      let changed = 0, added = 0, removed = 0;
      const ids = new Set([...Object.keys(snap), ...Object.keys(cur)]);
      ids.forEach((did) => {
        const a = snap[did] || {}, b = cur[did] || {};
        const days = new Set([...Object.keys(a), ...Object.keys(b)]);
        days.forEach((d) => {
          const va = a[d] || '', vb = b[d] || '';
          if (va === vb) return;
          if (!va) added++; else if (!vb) removed++; else changed++;
        });
      });
      toast('Rispetto a "' + v.label + '": ' + changed + ' modifiche, ' + added + ' aggiunte, ' + removed + ' rimosse', 'ok');
    } catch (e) { toast('Errore: ' + e.message, 'bad'); }
  };

  window.deleteVersion = async function (id) {
    if (!window.confirm('Eliminare questa versione?')) return;
    try { await TurniApi.deleteSchedulerVersion(id); toast('Versione eliminata', 'ok'); loadVersions(); }
    catch (e) { toast('Errore: ' + e.message, 'bad'); }
  };
})();
