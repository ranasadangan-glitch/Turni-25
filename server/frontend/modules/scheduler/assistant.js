/* TurniDSP — AI Workforce Assistant (in-scheduler suggestions panel)
 * ---------------------------------------------------------------------------
 * A right-side drawer INSIDE the Scheduler page (not a separate page) that
 * continuously analyses the current month's schedule and produces actionable
 * suggestions. Deterministic rule-based analysis over the same data the
 * generator uses (state.drivers / schedule / forecast, services, documents).
 *
 * Categories: coverage problems, workload balance, vacation conflicts, branch
 * rebalancing, qualification gaps, medical & training & contract expiry.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  const SEV = { high: 'b-bad', medium: 'b-warn', low: 'b-pri', info: 'b-muted' };
  const fullName = (dr) => ((dr.cognome || '') + ' ' + (dr.nome || '')).trim();
  const qualifiedFor = (dr, s) => {
    const own = dr.defaultCode || (typeof defCode === 'function' ? defCode(dr.service) : '');
    return (s.count || []).indexOf(own) >= 0;
  };
  const inBranch = (dr, s) => !(s.filiali && s.filiali.length) || s.filiali.indexOf(dr.filiale) >= 0;
  // The code to write when assigning a driver to a service (prefer their own).
  function assignCodeFor(dr, s) {
    const own = dr.defaultCode || (typeof defCode === 'function' ? defCode(dr.service) : '');
    if (own && (s.count || []).indexOf(own) >= 0) return own;
    return (s.count && s.count[0]) || own || 'X';
  }

  // Qualified + available (working day, not absent, not already assigned) on d.
  function candidatesFor(s, d) {
    return (typeof activeDrivers === 'function' ? activeDrivers() : []).filter((dr) => {
      if (!inBranch(dr, s)) return false;
      if (!qualifiedFor(dr, s)) return false;
      if ((dr.workDays || []).indexOf(dow(YM, d)) < 0) return false;
      const ex = getCode(dr.id, d);
      if (ex && codeCls(ex) === 'mal') return false;   // absent
      if (ex && ex.toUpperCase() !== 'OFF') return false; // already assigned
      return true;
    });
  }

  function sug(category, severity, icon, title, detail, extra) {
    return Object.assign({ category, severity, icon, title, detail }, extra || {});
  }

  // ── Analysers (each guarded so one failure can't blank the panel) ──
  function analyzeCoverage(out) {
    const svcs = (typeof scopeServices === 'function' ? scopeServices() : services()).filter((s) => !s.minOf);
    const drivers = typeof scopedActive === 'function' ? scopedActive() : activeDrivers();
    const days = daysInMonth(YM);
    const gaps = [];
    for (let d = 1; d <= days; d++) {
      for (const s of svcs) {
        const delta = deltaOf(s, d, drivers);
        if (delta < 0) gaps.push({ s, d, need: -delta });
      }
    }
    gaps.sort((a, b) => b.need - a.need);
    gaps.slice(0, 6).forEach((g) => {
      const cands = candidatesFor(g.s, g.d);
      const pick = cands.slice(0, g.need);
      out.push(sug('coverage', 'high', '🚨',
        'Servono ' + g.need + ' DAS · ' + g.s.label,
        'Giorno ' + g.d + ': copertura sotto il forecast.',
        {
          employees: cands.slice(0, 4).map(fullName),
          reason: 'Qualificati · Disponibili · Nessun conflitto', day: g.d, service: g.s.key,
          // One-click apply data: assign the top qualified/available drivers.
          apply: pick.length ? { day: g.d, drivers: pick.map((dr) => ({ id: dr.id, name: fullName(dr), code: assignCodeFor(dr, g.s) })) } : null,
        }));
    });
  }

  function analyzeWorkload(out) {
    const drivers = typeof scopedActive === 'function' ? scopedActive() : activeDrivers();
    const days = daysInMonth(YM);
    const load = drivers.map((dr) => {
      let n = 0;
      for (let d = 1; d <= days; d++) { const c = getCode(dr.id, d); if (c && c.toUpperCase() !== 'OFF' && codeCls(c) !== 'mal') n++; }
      return { dr, n };
    }).sort((a, b) => b.n - a.n);
    if (load.length >= 2 && load[0].n - load[load.length - 1].n >= 4) {
      const hi = load[0], lo = load[load.length - 1];
      out.push(sug('workload', 'medium', '⚖️',
        fullName(hi.dr) + ' ha molti turni (' + hi.n + ')',
        'Bilancia il carico: alterna un turno con ' + fullName(lo.dr) + ' (' + lo.n + ' turni).',
        { reason: 'Distribuzione più equa del lavoro' }));
    }
  }

  function analyzeVacation(out) {
    const svcs = (typeof scopeServices === 'function' ? scopeServices() : services()).filter((s) => !s.minOf);
    const drivers = typeof scopedActive === 'function' ? scopedActive() : activeDrivers();
    const days = daysInMonth(YM);
    for (const s of svcs) {
      for (let d = 1; d <= days; d++) {
        // qualified drivers on ferie this day
        const onLeave = drivers.filter((dr) => qualifiedFor(dr, s) && inBranch(dr, s) && (getCode(dr.id, d) || '').toUpperCase() === 'F');
        if (onLeave.length >= 3 && deltaOf(s, d, drivers) < 0) {
          const keep = Math.max(1, onLeave.length + deltaOf(s, d, drivers)); // how many could stay off while covering
          out.push(sug('vacation', 'high', '🌴',
            onLeave.length + ' DAS in ferie · ' + s.label,
            'Giorno ' + d + ': troppe ferie contemporanee, copertura sotto target. Approvane al massimo ' + Math.max(0, keep) + '.',
            { employees: onLeave.slice(0, 5).map(fullName) }));
          return; // one representative vacation-conflict suggestion is enough
        }
      }
    }
  }

  function analyzeBranchBalance(out) {
    if (typeof filiali !== 'function' || filiali().length < 2) return;
    const svcs = services().filter((s) => !s.minOf);
    const days = daysInMonth(YM);
    const byBranch = {};
    filiali().forEach((f) => { byBranch[f] = { req: 0, cov: 0 }; });
    const all = activeDrivers();
    for (const f of filiali()) {
      const drv = all.filter((d) => d.filiale === f);
      for (const s of svcs) {
        if (s.filiali && s.filiali.length && s.filiali.indexOf(f) < 0) continue;
        for (let d = 1; d <= days; d++) { byBranch[f].req += forecastOf(s, d); byBranch[f].cov += Math.min(forecastOf(s, d), harmonyOf(s, d, drv)); }
      }
    }
    const rows = filiali().map((f) => ({ f, pct: byBranch[f].req ? byBranch[f].cov / byBranch[f].req : 1 }));
    rows.sort((a, b) => a.pct - b.pct);
    const worst = rows[0], best = rows[rows.length - 1];
    if (worst && best && best.pct - worst.pct >= 0.15) {
      out.push(sug('branch', 'medium', '🔀',
        'Riequilibra le filiali',
        'Sposta un DAS da ' + best.f + ' (' + Math.round(best.pct * 100) + '%) a ' + worst.f + ' (' + Math.round(worst.pct * 100) + '%). La copertura migliora.',
        { reason: 'Bilanciamento tra filiali' }));
    }
  }

  function analyzeQualification(out) {
    const svcs = services().filter((s) => !s.minOf);
    const days = daysInMonth(YM);
    const all = activeDrivers();
    for (const s of svcs) {
      let anyForecast = false;
      for (let d = 1; d <= days; d++) { if (forecastOf(s, d) > 0) { anyForecast = true; break; } }
      if (!anyForecast) continue;
      const qualified = all.filter((dr) => qualifiedFor(dr, s) && inBranch(dr, s));
      if (!qualified.length) {
        const trainable = all.filter((dr) => inBranch(dr, s)).slice(0, 3).map(fullName);
        out.push(sug('qualification', 'high', '🎓',
          'Nessun DAS qualificato · ' + s.label,
          'Servizio richiesto dal forecast ma senza DAS qualificati. DAS da formare:',
          { employees: trainable }));
      }
    }
  }

  async function analyzeExpiries(out) {
    // Medical & training document expiry (from the documents module data).
    try {
      const docs = await TurniApi.documentsAll();
      const today = new Date(); today.setHours(0, 0, 0, 0);
      docs.forEach((d) => {
        if (!d.expiry_date) return;
        const days = Math.round((new Date(String(d.expiry_date).slice(0, 10)) - today) / 86400000);
        const name = ((d.last_name || '') + ' ' + (d.first_name || '')).trim() || ('#' + d.employee_id);
        if (d.doc_type === 'medical' && days >= 0 && days <= 30) {
          out.push(sug('medical', days <= 10 ? 'high' : 'medium', '🩺',
            'Certificato medico in scadenza',
            name + ': scade tra ' + days + ' giorni. Pianifica il rinnovo.', { reason: 'Validità sanitaria' }));
        }
        if (d.doc_type === 'training' && days >= 0 && days <= 45) {
          out.push(sug('training', days <= 15 ? 'high' : 'medium', '📚',
            'Formazione in scadenza',
            name + ': scade tra ' + days + ' giorni. Pianifica un corso di aggiornamento.', { reason: 'Formazione' }));
        }
      });
    } catch (e) { /* documents unavailable — skip */ }
    // Contract expiry (scheduler drivers carry an expiry date).
    try {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      (state.drivers || []).forEach((dr) => {
        if (dr.ctrType !== 'determinato' || !dr.expiry) return;
        const days = Math.round((new Date(dr.expiry + 'T00:00:00') - today) / 86400000);
        if (days >= 0 && days <= 30) {
          out.push(sug('contract', days <= 10 ? 'high' : 'medium', '📋',
            'Contratto in scadenza',
            fullName(dr) + ': scade tra ' + days + ' giorni. Verifica il rinnovo.', { reason: 'Contratto determinato' }));
        }
      });
    } catch (e) { /* ignore */ }
  }

  async function analyzeSchedule() {
    const out = [];
    const run = (fn) => { try { fn(out); } catch (e) { /* keep other analysers alive */ } };
    run(analyzeCoverage);
    run(analyzeQualification);
    run(analyzeVacation);
    run(analyzeWorkload);
    run(analyzeBranchBalance);
    await analyzeExpiries(out);
    return out;
  }

  // ── Panel UI ─────────────────────────────────────────────────────
  window.toggleAssistant = function () {
    const p = document.getElementById('aiPanel');
    if (!p) return;
    if (p.classList.contains('on')) { p.classList.remove('on'); return; }
    p.classList.add('on');
    refreshAssistant();
  };
  window.closeAssistant = function () { const p = document.getElementById('aiPanel'); if (p) p.classList.remove('on'); };

  let _items = [];
  window.refreshAssistant = async function () {
    const body = document.getElementById('aiBody');
    if (!body) return;
    body.innerHTML = "<div class='skel' style='height:80px;border-radius:8px;margin-bottom:8px'></div><div class='skel' style='height:80px;border-radius:8px'></div>";
    _items = await analyzeSchedule();
    const badge = document.getElementById('aiCount');
    if (badge) { badge.textContent = _items.length; badge.style.display = _items.length ? 'inline-block' : 'none'; }
    if (!_items.length) {
      body.innerHTML = "<div style='text-align:center;padding:30px;color:var(--text-muted)'><div style='font-size:2rem'>✅</div>Nessun suggerimento. La pianificazione è in salute.</div>";
      return;
    }
    body.innerHTML = _items.map((s, i) => {
      const emp = (s.employees && s.employees.length)
        ? "<div class='ai-emps'>" + s.employees.map((e) => "<span class='badge b-pri'>" + esc(e) + "</span>").join('') + "</div>" : '';
      const reason = s.reason ? "<div class='text-xs text-muted' style='margin-top:3px'>" + esc(s.reason) + "</div>" : '';
      // One-click apply for actionable (coverage) suggestions.
      const action = (s.apply && s.apply.drivers && s.apply.drivers.length)
        ? "<div style='margin-top:8px'><button class='btn btn-primary sm' "+actAttr('click','applyAiSuggestion',[i])+">✔ Assegna " + s.apply.drivers.length + "</button></div>" : '';
      return "<div class='ai-card'>" +
        "<div class='ai-card-head'><span class='ai-icon'>" + s.icon + "</span>" +
        "<span class='badge " + (SEV[s.severity] || 'b-muted') + "'>" + esc(s.category) + "</span></div>" +
        "<div class='ai-title'>" + esc(s.title) + "</div>" +
        "<div class='ai-detail'>" + esc(s.detail) + "</div>" + emp + reason + action + "</div>";
    }).join('');
  };

  // Apply an actionable suggestion in one click (assigns the suggested drivers
  // to fill the coverage gap), then re-analyse so the panel updates live.
  window.applyAiSuggestion = function (i) {
    const s = _items[i];
    if (!s || !s.apply || !s.apply.drivers) return;
    state.schedule = state.schedule || {};
    s.apply.drivers.forEach((d) => {
      if (!state.schedule[d.id]) state.schedule[d.id] = {};
      state.schedule[d.id][s.apply.day] = d.code;
    });
    if (typeof dirty === 'function') { try { dirty(); } catch (e) {} }
    if (typeof logAction === 'function') logAction('Suggerimento AI applicato: ' + s.apply.drivers.length + ' assegnazioni g' + s.apply.day);
    if (typeof refreshAll === 'function') refreshAll();
    toast('Assegnati ' + s.apply.drivers.length + ' DAS · giorno ' + s.apply.day, 'ok');
    refreshAssistant();
  };
  window.analyzeSchedule = analyzeSchedule;   // reused by future dashboard widgets
})();
