/* TurniDSP — Automatic Shift Generator (rule-based engine)
 * ---------------------------------------------------------------------------
 * Forecast-driven, rule-based monthly/weekly/daily schedule generation. It
 * NEVER uses fixed working hours — assignments are decided by contract working
 * days, service qualification, availability, absences, weekend fairness and
 * workload balance, all governed by the configurable Rule Engine
 * (scheduling_rules table, loaded via TurniApi.schedulerRules()).
 *
 * Produces a PREVIEW plan (not written until applied) plus a report:
 * coverage %, employees assigned, missing, warnings, optimization score, and a
 * per-assignment explanation.
 *
 * Reuses scheduler globals: state, services(), forecastOf(), daysInMonth(),
 * YM, dow(), codeCls(), defCode(), activeDrivers(), svcInFiliale(), getCode().
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  let _rulesCache = null;
  async function getGenRules(force) {
    if (_rulesCache && !force) return _rulesCache;
    try { _rulesCache = await TurniApi.schedulerRules(); }
    catch (e) { _rulesCache = []; }
    return _rulesCache;
  }
  window.invalidateGenRules = function () { _rulesCache = null; };

  const isWeekend = (d) => { const w = dow(YM, d); return w === 0 || w === 6; };
  const isAbsence = (code) => code && (codeCls(code) === 'mal');
  const isRest = (code) => code && code.toUpperCase() === 'OFF';

  // The shift code to write for a driver assigned to a service: prefer the
  // driver's own default code when it counts for the service, else the
  // service's first counted code.
  function assignCode(s, dr) {
    const own = dr.defaultCode || (typeof defCode === 'function' ? defCode(dr.service) : '');
    if (own && (s.count || []).indexOf(own) >= 0) return own;
    return (s.count && s.count[0]) || own || 'X';
  }
  function qualifiedFor(dr, s) {
    const own = dr.defaultCode || (typeof defCode === 'function' ? defCode(dr.service) : '');
    return (s.count || []).indexOf(own) >= 0;
  }
  function inServiceBranch(dr, s, branch) {
    if (branch && dr.filiale !== branch) return false;
    if (s.filiali && s.filiali.length) return s.filiali.indexOf(dr.filiale) >= 0;
    return true;
  }

  // Consecutive working days ending at day d-1, combining already-written
  // schedule and this run's plan.
  function streakBefore(dr, d, plan) {
    let n = 0;
    for (let k = d - 1; k >= 1; k--) {
      const code = (plan[dr.id] && plan[dr.id][k]) || getCode(dr.id, k);
      if (code && !isRest(code) && !isAbsence(code)) n++; else break;
    }
    return n;
  }

  // ── Rule evaluation ──────────────────────────────────────────────
  // Each SKIP/REQUIRE rule returns {ok, reason}. Reasons that pass become the
  // human explanation shown next to each assignment.
  const SKIP_EVAL = {
    contract_day: (dr, d) => {
      const wd = Array.isArray(dr.workDays) ? dr.workDays : [];
      return wd.indexOf(dow(YM, d)) >= 0
        ? { ok: true, reason: 'Giorno lavorativo da contratto' }
        : { ok: false, reason: 'Fuori dai giorni contrattuali' };
    },
    unavailable: (dr, d) => {
      const existing = getCode(dr.id, d);
      return isAbsence(existing)
        ? { ok: false, reason: 'Assente (' + existing + ')' }
        : { ok: true, reason: 'Disponibile' };
    },
    already_assigned: (dr, d, s, plan, stats, ctx) => {
      if (plan[dr.id] && plan[dr.id][d]) return { ok: false, reason: 'Già assegnato oggi' };
      // In empty / lock-manual mode, an existing manual work code is protected.
      if ((ctx.mode === 'empty' || ctx.lockManual)) {
        const ex = getCode(dr.id, d);
        if (ex && !isRest(ex) && !isAbsence(ex)) return { ok: false, reason: 'Turno manuale bloccato' };
      }
      return { ok: true, reason: null };
    },
    qualified: (dr, d, s) => qualifiedFor(dr, s)
      ? { ok: true, reason: 'Qualificato per ' + s.label }
      : { ok: false, reason: 'Non qualificato per ' + s.label },
    branch_match: (dr, d, s, plan, stats, ctx) => inServiceBranch(dr, s, ctx.branch)
      ? { ok: true, reason: 'Filiale ' + dr.filiale }
      : { ok: false, reason: 'Filiale diversa' },
    consecutive: (dr, d, s, plan, stats, ctx, params) => {
      const max = (params && +params.maxConsecutive) || 6;
      return streakBefore(dr, d, plan) < max
        ? { ok: true, reason: 'Riposo rispettato' }
        : { ok: false, reason: 'Supererebbe ' + max + ' giorni consecutivi' };
    },
  };

  // SCORE rules add to a candidate's ranking. Higher score = assigned first.
  const SCORE_EVAL = {
    workload_balance: (dr, d, s, stats, params) => {
      const w = (params && +params.weight) || 2;
      return w * (1 / (1 + (stats[dr.id] ? stats[dr.id].total : 0)));
    },
    weekend_fairness: (dr, d, s, stats, params) => {
      if (!isWeekend(d)) return 0;
      const w = (params && +params.weight) || 1;
      return w * (1 / (1 + (stats[dr.id] ? stats[dr.id].weekend : 0)));
    },
    preferred_code: (dr, d, s, stats, params) => {
      const w = (params && +params.weight) || 1;
      return (dr.defaultCode && (s.count || []).indexOf(dr.defaultCode) >= 0) ? w : 0;
    },
  };

  function evalCandidate(dr, d, s, plan, stats, ctx, rules) {
    const reasons = [];
    for (const rule of rules) {
      if (!rule.enabled) continue;
      if (rule.action !== 'skip' && rule.action !== 'require') continue;
      const fn = SKIP_EVAL[rule.code];
      if (!fn) continue;                 // unknown code → ignored (forward-compatible)
      const r = fn(dr, d, s, plan, stats, ctx, rule.params || {});
      if (!r.ok) return { ok: false, reason: r.reason };
      if (r.reason) reasons.push(r.reason);
    }
    return { ok: true, reasons };
  }
  function scoreCandidate(dr, d, s, stats, rules) {
    let sc = 0;
    for (const rule of rules) {
      if (!rule.enabled || rule.action !== 'score') continue;
      const fn = SCORE_EVAL[rule.code];
      if (fn) sc += fn(dr, d, s, stats, rule.params || {});
    }
    return sc;
  }

  // ── Main generation ──────────────────────────────────────────────
  window.generateSchedulePreview = async function (opts) {
    opts = opts || {};
    const rules = (await getGenRules()).slice().sort((a, b) => a.priority - b.priority);
    const ctx = { branch: opts.branch || '', mode: opts.mode || 'all', lockManual: !!opts.lockManual };
    const days = daysInMonth(YM);

    let drivers = activeDrivers();
    if (ctx.branch) drivers = drivers.filter((d) => d.filiale === ctx.branch);
    // Optional: restrict to specific employees (Genera solo selezionati).
    if (opts.driverIds && opts.driverIds.length) {
      const set = new Set(opts.driverIds.map(String));
      drivers = drivers.filter((d) => set.has(String(d.id)));
    }
    // Derived (minOf) services aren't directly assignable — they're computed
    // from their component services, which we do assign. Optionally restrict to
    // a single service (Genera solo servizio).
    let svcs = services().filter((s) => !s.minOf && (typeof svcInFiliale !== 'function' || svcInFiliale(s, ctx.branch)));
    if (opts.service) svcs = svcs.filter((s) => s.key === opts.service);

    // Scope: which days to (re)generate. 'month' = all; 'week' = the planner's
    // current week; explicit opts.days wins.
    let targetDays = [];
    if (opts.days && opts.days.length) targetDays = opts.days.slice();
    else if (opts.scope === 'week' && typeof monthWeeks === 'function') {
      const weeks = monthWeeks();
      const wi = (typeof weekIdx !== 'undefined' && weeks[weekIdx]) ? weekIdx : 0;
      targetDays = (weeks[wi] && weeks[wi].days) || [];
    } else { for (let d = 1; d <= days; d++) targetDays.push(d); }

    const plan = {};
    const stats = {};
    drivers.forEach((d) => { stats[d.id] = { total: 0, weekend: 0 }; });
    const assignments = [];
    const warnings = [];
    let totalReq = 0, totalAssigned = 0, restCount = 0;
    const noCandServices = {};

    for (const d of targetDays) {
      for (const s of svcs) {
        const need = forecastOf(s, d);
        if (need <= 0) continue;
        totalReq += need;

        const cands = [];
        for (const dr of drivers) {
          const ev = evalCandidate(dr, d, s, plan, stats, ctx, rules);
          if (ev.ok) cands.push({ dr, reasons: ev.reasons, score: scoreCandidate(dr, d, s, stats, rules) });
        }
        cands.sort((a, b) => b.score - a.score);

        let got = 0;
        for (const c of cands) {
          if (got >= need) break;
          const code = assignCode(s, c.dr);
          if (!plan[c.dr.id]) plan[c.dr.id] = {};
          plan[c.dr.id][d] = code;
          stats[c.dr.id].total++;
          if (isWeekend(d)) stats[c.dr.id].weekend++;
          const reasons = c.reasons.slice();
          if (isWeekend(d)) reasons.push('Equilibrio weekend mantenuto');
          reasons.push('Carico equo');
          assignments.push({
            driverId: c.dr.id, name: (c.dr.cognome + ' ' + c.dr.nome).trim(),
            day: d, service: s.label, code, weekend: isWeekend(d), reasons,
          });
          got++; totalAssigned++;
        }
        if (got < need) {
          warnings.push({ type: 'understaffed', day: d, service: s.label, need, got, missing: need - got });
          if (!cands.length) noCandServices[s.label] = (noCandServices[s.label] || 0) + 1;
        }
      }
      // Fill each driver's un-used contractual working day with OFF (rest) so
      // the month grid is complete (only in full mode, never over a manual/lock).
      if (ctx.mode === 'all' && !ctx.lockManual) {
        for (const dr of drivers) {
          if (plan[dr.id] && plan[dr.id][d]) continue;
          const ex = getCode(dr.id, d);
          if (isAbsence(ex)) continue;                 // keep absences
          if (!plan[dr.id]) plan[dr.id] = {};
          plan[dr.id][d] = 'OFF';
          restCount++;
        }
      }
    }

    // Qualification warnings: services with no candidate at all on some days.
    Object.keys(noCandServices).forEach((svc) => {
      warnings.push({ type: 'no_qualified', service: svc, days: noCandServices[svc] });
    });

    // Optimization score (0–100): coverage weighted with workload fairness and
    // a penalty for warnings.
    const coveragePct = totalReq ? Math.round((totalAssigned / totalReq) * 100) : 100;
    const totals = drivers.map((d) => stats[d.id].total);
    const mean = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : 0;
    const variance = totals.length ? totals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / totals.length : 0;
    const fairness = mean > 0 ? Math.max(0, 1 - Math.sqrt(variance) / (mean + 1)) : 1;
    const warnPenalty = Math.min(0.25, warnings.length * 0.01);
    const score = Math.round(Math.max(0, Math.min(1, (coveragePct / 100) * 0.7 + fairness * 0.3 - warnPenalty)) * 100);

    return {
      plan, assignments,
      report: {
        coveragePct, assigned: totalAssigned, required: totalReq,
        missing: Math.max(0, totalReq - totalAssigned),
        drivers: drivers.length, rest: restCount,
        warnings, score, branch: ctx.branch || 'tutte', month: YM,
      },
    };
  };

  // Apply a previously generated plan into the live schedule (undoable).
  let _lastSnapshot = null;
  window.applyGeneratedPlan = function (plan, mode) {
    _lastSnapshot = JSON.parse(JSON.stringify(state.schedule || {}));
    state.schedule = state.schedule || {};
    Object.keys(plan).forEach((id) => {
      state.schedule[id] = state.schedule[id] || {};
      const drr = state.drivers.find((x) => String(x.id) === String(id));
      Object.keys(plan[id]).forEach((day) => {
        // Contract expiry wins over any generated assignment (auto-fill OFF).
        state.schedule[id][day] = (drr && typeof afterExpiry === 'function' && afterExpiry(drr, +day)) ? 'OFF' : plan[id][day];
      });
    });
    // Normalize every post-expiry day to OFF in the stored schedule (covers
    // cells that weren't part of the generated plan too), so state = DB = render.
    if (typeof sanitizeExpiredOff === 'function') { try { sanitizeExpiredOff(); } catch (e) {} }
    if (typeof dirty === 'function') { try { dirty(); } catch (e) {} }
    if (typeof logAction === 'function') logAction('Turni generati automaticamente (motore regole)');
    if (typeof refreshAll === 'function') refreshAll();
  };
  window.undoGeneratedPlan = function () {
    if (!_lastSnapshot) { toast('Niente da annullare'); return; }
    state.schedule = _lastSnapshot;
    _lastSnapshot = null;
    if (typeof dirty === 'function') { try { dirty(); } catch (e) {} }
    if (typeof logAction === 'function') logAction('Generazione turni annullata');
    if (typeof refreshAll === 'function') refreshAll();
    toast('Generazione annullata', 'ok');
  };
  window.canUndoGeneration = function () { return !!_lastSnapshot; };

  // ── Generation UI (modal) ────────────────────────────────────────
  let _lastPreview = null;
  window.openGenerator = function () {
    if (typeof isAdmin === 'function' && !isAdmin()) { toast('Riservato all\'Admin', 'warn'); return; }
    const sel = document.getElementById('genBranch');
    if (sel) {
      const fils = (typeof filiali === 'function' ? filiali() : []) || [];
      sel.innerHTML = "<option value=''>Tutte le filiali</option>" + fils.map((f) => "<option>" + esc(f) + "</option>").join('');
      if (typeof teamFiliale !== 'undefined' && teamFiliale) sel.value = teamFiliale;
    }
    const svcSel = document.getElementById('genService');
    if (svcSel) {
      const svcs = (typeof services === 'function' ? services() : []).filter((s) => !s.minOf);
      svcSel.innerHTML = "<option value=''>Tutti</option>" + svcs.map((s) => "<option value='" + esc(s.key) + "'>" + esc(s.label) + "</option>").join('');
    }
    document.getElementById('genResult').innerHTML = "<p class='text-sm text-muted'>Scegli le opzioni e genera un'anteprima. Nulla verrà scritto finché non premi «Applica».</p>";
    document.getElementById('genActions').style.display = 'none';
    _lastPreview = null;
    document.getElementById('genModal').classList.add('on');
  };

  window.runGenerator = async function () {
    const branch = document.getElementById('genBranch').value || '';
    const mode = document.getElementById('genMode').value || 'all';
    const scope = (document.getElementById('genScope') || {}).value || 'month';
    const service = (document.getElementById('genService') || {}).value || '';
    const lockManual = document.getElementById('genLock').checked;
    const res = document.getElementById('genResult');
    res.innerHTML = "<div class='skel' style='height:120px;border-radius:10px'></div>";
    try {
      _lastPreview = await window.generateSchedulePreview({ branch, mode, scope, service, lockManual });
      renderGenReport(_lastPreview);
      document.getElementById('genActions').style.display = 'flex';
    } catch (e) {
      res.innerHTML = "<div style='color:var(--bad)'>Errore generazione: " + esc(e.message) + "</div>";
    }
  };

  window.applyGenerator = function () {
    if (!_lastPreview) return;
    const mode = document.getElementById('genMode').value || 'all';
    window.applyGeneratedPlan(_lastPreview.plan, mode);
    closeAll();
    toast('Turni applicati · ' + _lastPreview.report.assigned + ' assegnazioni', 'ok');
  };

  function covClass(pct) { return pct >= 95 ? 'ok' : pct >= 80 ? 'warn' : 'bad'; }

  function renderGenReport(preview) {
    const r = preview.report;
    const kpi = (v, l, cls) => "<div class='kpi-card " + (cls || '') + "' style='padding:12px'><div class='kpi-val'>" + v + "</div><div class='kpi-label'>" + l + "</div></div>";
    let warnHtml = '';
    if (r.warnings.length) {
      const items = r.warnings.slice(0, 40).map((w) => {
        if (w.type === 'understaffed') return "<li>Giorno " + w.day + " · <b>" + esc(w.service) + "</b>: servono " + w.need + ", assegnati " + w.got + " <span style='color:var(--bad)'>(-" + w.missing + ")</span></li>";
        if (w.type === 'no_qualified') return "<li><b>" + esc(w.service) + "</b>: nessun DAS qualificato/disponibile per " + w.days + " giorni</li>";
        return "<li>" + esc(JSON.stringify(w)) + "</li>";
      }).join('');
      warnHtml = "<div class='card card-pad' style='margin-top:12px'><div class='section-title text-sm mb-2'>⚠️ Avvisi (" + r.warnings.length + ")</div>" +
        "<ul style='margin:0;padding-left:18px;font-size:.8rem;max-height:150px;overflow:auto'>" + items + (r.warnings.length > 40 ? "<li>… e altri " + (r.warnings.length - 40) + "</li>" : '') + "</ul></div>";
    } else {
      warnHtml = "<div class='card card-pad' style='margin-top:12px'><span class='badge b-ok'>Nessun conflitto rilevato</span></div>";
    }
    // sample assignments with explanations
    const sample = preview.assignments.slice(0, 12).map((a) =>
      "<div style='padding:7px 0;border-bottom:1px solid var(--border)'>" +
      "<div style='font-size:.82rem'><b>" + esc(a.name) + "</b> · <span class='badge b-pri'>" + esc(a.code) + "</span> " +
      "<span class='text-xs text-muted'>g" + a.day + " · " + esc(a.service) + "</span></div>" +
      "<div class='text-xs text-muted'>" + a.reasons.map((x) => '• ' + esc(x)).join(' ') + "</div></div>").join('');

    document.getElementById('genResult').innerHTML =
      "<div class='kpi-grid' style='grid-template-columns:repeat(4,1fr);gap:8px'>" +
      kpi(r.coveragePct + '%', 'Copertura', covClass(r.coveragePct)) +
      kpi(r.assigned, 'Assegnazioni', 'pri') +
      kpi(r.missing, 'Mancanti', r.missing > 0 ? 'bad' : 'ok') +
      kpi(r.score, 'Optimization Score', covClass(r.score)) +
      "</div>" + warnHtml +
      "<div class='card card-pad' style='margin-top:12px'><div class='section-title text-sm mb-2'>Assegnazioni e motivazioni <span class='text-xs text-muted'>(" + preview.assignments.length + " totali · " + r.drivers + " DAS)</span></div>" +
      sample + (preview.assignments.length > 12 ? "<div class='text-xs text-muted' style='padding-top:8px'>… e altre " + (preview.assignments.length - 12) + " assegnazioni</div>" : '') + "</div>";
  }
})();
