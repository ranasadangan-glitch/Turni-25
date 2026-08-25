/* TurniDSP — Dashboard overview (KPI, alert, attività)
   Estratto dal monolite app.html: stesso scope globale, stesso comportamento.
   Ordine di caricamento definito in app.html (vedi fondo pagina). */
// ── Data loading ──────────────────────────────────────────────────
let _kpiData=null, _branches=[], _charts={};

async function initBranches() {
  try {
    _branches = await TurniApi.branches();
    const sel = $d('branchSel');
    sel.innerHTML = '<option value="">Tutte le filiali</option>' +
      _branches.map(b=>`<option value="${esc(b.code)}">${esc(b.code)}</option>`).join('');
    // The header branch selector drives BOTH the dashboard KPIs and the
    // scheduler roster (spec §17). Selecting a branch reloads the scheduler
    // for that branch; "Tutte le filiali" ('') loads every employee.
    sel.addEventListener('change', function () {
      // Scope the forecast/coverage (scopeServices reads window._covFil) to the
      // selected branch so footer Forecast/Planned/Delta use that branch only.
      window._covFil = sel.value || '';
      try { refreshOverview(); } catch (e) {}
      var sec = (typeof _currentSection !== 'undefined') ? _currentSection : '';
      if (sec === 'scheduler' && typeof loadMonth === 'function') { try { loadMonth(); } catch (e) {} }
    });

    const nuBranches = $d('nuBranches');
    if(nuBranches) nuBranches.innerHTML = _branches.map(b=>`<option value="${b.id}">${esc(b.code)} — ${esc(b.name)}</option>`).join('');
  } catch(e) { console.error('branches:', e.message); }
}

async function refreshOverview() {
  const date   = $d('kpiDate').value || today();
  const branch = $d('branchSel').value || undefined;
  $d('dspDateLabel').textContent = fmt(date);
  $d('fcBadge').textContent = fmt(date);

  try {
    _kpiData = await TurniApi.kpi({ date, ...(branch?{branch}:{}) });
    renderKPIs(_kpiData);
    renderForecastCard(_kpiData);
    renderExpiryCard(_kpiData);
    renderAttendanceCard(_kpiData);
    renderDSP(_kpiData);
    renderBranchHeatmap(_kpiData);
    renderServiceSummary(_kpiData);
    renderWeekPreview(_kpiData);
    renderTodayEmployees(_kpiData);
    renderCharts();
  } catch(e) { toast('Errore KPI: '+e.message,'bad'); console.error(e); }

  renderQuickActions();
  loadAlerts();
  renderActivity();
}

// ── Home: Quick Actions ───────────────────────────────────────────
// Client-only shortcuts into the flows a manager reaches for most.
// Admin-only entries are filtered out for other roles.
function renderQuickActions() {
  const el = $d('quickActions');
  if (!el) return;
  const isAdm = document.body.classList.contains('is-admin');
  const acts = [
    { label: '📅 Apri planner',    go: 'goPlanning()' },
    { label: '➕ Nuovo dipendente', go: "navigate('employees')" },
    { label: '📈 Forecast',        go: "navigate('settings');setCfgTab('forecast')", admin: true },
    { label: '📖 Legenda',         go: "navigate('settings');setCfgTab('codes')",    admin: true },
    { label: '🏢 Filiali',         go: "navigate('settings');setCfgTab('filiali')",  admin: true },
    { label: '📊 Report',          go: "navigate('reports')" },
  ].filter(a => !a.admin || isAdm);
  el.innerHTML = acts.map(a =>
    `<button class="btn btn-ghost sm" onclick="${a.go}">${a.label}</button>`
  ).join('');
}

// ── Home: Service Summary ─────────────────────────────────────────
function renderServiceSummary(d) {
  const tb = $d('svcSummaryTbl') && $d('svcSummaryTbl').querySelector('tbody');
  if (!tb) return;
  const rows = d.services || [];
  if (!rows.length) {
    tb.innerHTML = '<tr><td colspan="5" class="text-muted" style="padding:12px;text-align:center">Nessun forecast o turno per questa data</td></tr>';
    return;
  }
  tb.innerHTML = rows.map(s => {
    const cov = s.coverage || 0;
    const cls = cov >= 100 ? 'b-ok' : cov >= 80 ? 'b-warn' : 'b-bad';
    const dl  = s.delta > 0 ? '+' + s.delta : s.delta;
    return `<tr>
      <td><b>${esc(s.label)}</b></td>
      <td>${s.forecast}</td>
      <td>${s.planned}</td>
      <td style="color:${s.delta < 0 ? 'var(--bad)' : 'var(--ok)'}">${dl}</td>
      <td><span class="badge ${cls}">${cov}%</span></td>
    </tr>`;
  }).join('');
}

// ── Home: Weekly Preview ──────────────────────────────────────────
function renderWeekPreview(d) {
  const el = $d('weekPreview');
  if (!el) return;
  const days = d.week || [];
  if (!days.length) { el.innerHTML = '<span class="text-muted text-sm">Nessun dato per la settimana</span>'; return; }
  const IT = { Mon:'Lun', Tue:'Mar', Wed:'Mer', Thu:'Gio', Fri:'Ven', Sat:'Sab', Sun:'Dom' };
  el.innerHTML = days.map(w => {
    const cov = w.forecast ? Math.round(w.planned / w.forecast * 100) : (w.planned ? 100 : 0);
    const bar = w.forecast ? Math.min(100, cov) : 0;
    const col = cov >= 100 ? 'var(--ok)' : cov >= 80 ? 'var(--warn)' : 'var(--bad)';
    return `<div class="card" style="padding:8px;text-align:center">
      <div class="text-xs text-muted">${IT[w.dow] || w.dow}</div>
      <div style="font-weight:700;font-size:.82rem">${String(w.date).slice(8,10)}/${String(w.date).slice(5,7)}</div>
      <div class="text-xs" style="margin-top:4px">${w.planned} / ${w.forecast}</div>
      <div style="height:4px;background:var(--line);border-radius:3px;margin-top:5px;overflow:hidden">
        <div style="height:100%;width:${bar}%;background:${col}"></div>
      </div>
      ${w.absent ? `<div class="text-xs" style="color:var(--bad);margin-top:3px">${w.absent} ass.</div>` : ''}
    </div>`;
  }).join('');
}

// ── Home: Today's Employees ───────────────────────────────────────
function renderTodayEmployees(d) {
  const tbl = $d('todayEmpTbl');
  const tb  = tbl && tbl.querySelector('tbody');
  if (!tb) return;
  const rows = d.today_employees || [];
  const cnt = $d('todayEmpCount');
  if (cnt) cnt.textContent = rows.length ? rows.length + ' dipendenti' : '';
  if (!rows.length) {
    tb.innerHTML = '<tr><td colspan="4" class="text-muted" style="padding:12px;text-align:center">Nessun dipendente</td></tr>';
    return;
  }
  tb.innerHTML = rows.map(r => {
    let stato = '<span class="badge badge-muted">—</span>';
    if (r.is_work)         stato = '<span class="badge b-ok">In turno</span>';
    else if (r.is_absence) stato = '<span class="badge b-bad">Assente</span>';
    else if (r.is_off)     stato = '<span class="badge b-warn">Riposo</span>';
    const name = `${r.cognome || ''} ${r.nome || ''}`.trim() || '—';
    return `<tr class="dsp-row" style="cursor:pointer" onclick="focusEmployeeInBoard('${esc(name)}')" title="Trova nel planner">
      <td><b>${esc(name)}</b></td>
      <td>${esc(r.branch_code || '—')}</td>
      <td>${r.shift_code ? esc(r.shift_code) : '<span class="text-muted">—</span>'}</td>
      <td>${stato}</td>
    </tr>`;
  }).join('');
}

// ── KPI Cards ─────────────────────────────────────────────────────
function renderKPIs(d) {
  const dr  = d.drivers   || {};
  const fc  = d.forecast  || {};
  const att = d.attendance || {};
  const ex  = d.contracts  || {};

  const pct = dr.total ? Math.round(dr.present/dr.total*100) : 0;
  const fcOk = fc.delta >= 0;
  const exBad = (ex.in_7||0)+(ex.expired||0);

  const cards = [
    { cls:'pri',  icon:'👷', label:'Driver totali',
      value: dr.total||0,
      subs: [{l:'Presenti',v:dr.present||0},{l:'Assenti',v:dr.absent||0},{l:'In riposo',v:dr.on_leave||0}],
      bar: pct, barColor:'var(--brand)', delta: pct+'% presenti' },
    { cls: fcOk?'ok':'bad', icon:'🎯', label:'Forecast vs Pianificato',
      value: fc.planned||0,
      subs: [{l:'Forecast',v:fc.forecast||0},{l:'Delta',v:(fc.delta>0?'+':'')+(fc.delta||0)}],
      delta: (fc.delta_pct>0?'▲':'▼')+' '+Math.abs(fc.delta_pct||0)+'%',
      deltaOk: fcOk },
    { cls: exBad>0?'warn':'ok', icon:'📋', label:'Contratti in scadenza',
      value: ex.in_30||0,
      subs: [{l:'Scaduti',v:ex.expired||0},{l:'7 gg',v:ex.in_7||0},{l:'15 gg',v:ex.in_15||0}],
      delta: '30 giorni' },
    { cls:'teal', icon:'🏥', label:'Assenze oggi',
      value: (att.absent||0)+(att.medical||0)+(att.vacation||0),
      subs: [{l:'Malattia',v:att.medical||0},{l:'Ferie',v:att.vacation||0},{l:'Assenti',v:att.absent||0}],
      delta: (att.training||0)>0 ? att.training+' in formazione' : '' },
  ];

  $d('kpiGrid').innerHTML = cards.map((c,i)=>`
    <div class="kpi-card ${c.cls} fade-in fade-in-${i}">
      <div class="kpi-icon">${c.icon}</div>
      <div class="kpi-val" data-target="${c.value}">${c.value}</div>
      <div class="kpi-label">${c.label}</div>
      <div class="kpi-subs">
        ${c.subs.map(s=>`<div class="kpi-sub"><span class="sl">${s.l}</span><span class="sv">${s.v}</span></div>`).join('')}
      </div>
      ${c.bar!==undefined?`<div class="kpi-bar"><div class="kpi-fill" style="width:${c.bar}%;background:${c.barColor}"></div></div>`:''}
      ${c.delta?`<div class="text-xs text-muted mt-2">${c.delta}</div>`:''}
    </div>`).join('');

  $d('kpiGrid').querySelectorAll('.kpi-val').forEach(el => {
    const t = +el.dataset.target; if(t) animateCount(el, t);
  });
}


function renderExpiryCard(d) {
  const ex = d.contracts||{};
  $d('expiryContent').innerHTML = [
    [ex.expired||0,'Scaduti','bad'],
    [ex.in_7||0,'Entro 7 giorni','bad'],
    [ex.in_15||0,'Entro 15 giorni','warn'],
    [ex.in_30||0,'Entro 30 giorni','muted'],
  ].map(([n,l,c])=>`<div class="dash-expiry-row">
    <div class="dash-expiry-num" style="color:var(--${c==='bad'?'bad':c==='warn'?'warn':'muted'})">${n}</div>
    <div><div class="font-semi text-sm">${l}</div></div>
  </div>`).join('');
}

function renderAttendanceCard(d) {
  const a = d.attendance||{};
  const tot = (a.present||0)+(a.absent||0)+(a.medical||0)+(a.vacation||0)+(a.training||0)||1;
  const pct = n => Math.round(n/tot*100);
  const row = (label,val,color) => `
    <div class="dash-presence-row">
      <div class="dash-pl">${label}</div>
      <div class="prog-wrap flex-1" style="height:7px"><div class="prog-bar" style="width:${pct(val)}%;background:${color}"></div></div>
      <div class="text-sm font-semi" style="width:28px;text-align:right">${val}</div>
    </div>`;
  $d('attContent').innerHTML = [
    row('Presenti',    a.present||0,  'var(--ok)'),
    row('Assenti',     a.absent||0,   'var(--bad)'),
    row('Malattia',    a.medical||0,  'var(--warn)'),
    row('Ferie',       a.vacation||0, 'var(--brand)'),
    row('Formazione',  a.training||0, 'var(--teal)'),
  ].join('');
}

function renderDSP(kpiData) {
  const tbody = $d('dspTbl').querySelector('tbody');
  const dsp = kpiData?.dsp;
  if(!dsp||!dsp.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-muted" style="padding:16px;text-align:center">Nessun dato — aggiungi DAS nello Scheduler</td></tr>';
    return;
  }
  let totD=0,totP=0;
  tbody.innerHTML = dsp.map(r=>{
    totD+=(r.drivers||0); totP+=(r.present||0);
    const cov = r.drivers>0 ? Math.round(r.present/r.drivers*100) : 0;
    return `<tr class="dsp-row" style="cursor:pointer" onclick="focusBranchInBoard('${esc(r.branch_code||'')}')" title="Filtra il planner su questa filiale">
      <td><b>${esc(r.branch_code||'—')}</b></td>
      <td>${r.drivers||0}</td>
      <td class="text-ok font-semi">${r.present||0}</td>
      <td>
        <div class="flex items-center gap-2">
          <div class="prog-wrap" style="height:6px;width:70px">
            <div class="prog-bar" style="width:${cov}%;background:${cov>=80?'var(--ok)':cov>=50?'var(--warn)':'var(--bad)'}"></div>
          </div>
          <span class="text-xs">${cov}%</span>
        </div>
      </td>
    </tr>`;
  }).join('') + `<tr style="border-top:2px solid var(--line)">
    <td><b>Totale</b></td><td><b>${totD}</b></td>
    <td class="text-ok font-semi"><b>${totP}</b></td>
    <td><b>${totD>0?Math.round(totP/totD*100):0}%</b></td>
  </tr>`;
}

// ── Branch coverage heatmap (Feature 3) ───────────────────────────
// Status thresholds on coverage % (present / required).
function branchStatus(pct, required) {
  if (!required) return { cls: 'bh-none', label: 'Nessun forecast', color: 'var(--text-muted)' };
  if (pct >= 100) return { cls: 'bh-green',  label: 'Coperta',   color: 'var(--ok)' };
  if (pct >= 85)  return { cls: 'bh-yellow', label: 'Attenzione', color: 'var(--warn)' };
  if (pct >= 60)  return { cls: 'bh-orange', label: 'Carenza',   color: '#e08600' };
  return { cls: 'bh-red', label: 'Critica', color: 'var(--bad)' };
}
function renderBranchHeatmap(d) {
  const host = $d('branchHeatmap');
  if (!host) return;
  const rows = (d && d.dsp) || [];
  if (!rows.length) { host.innerHTML = '<div class="text-muted text-sm" style="padding:12px">Nessuna filiale con dati.</div>'; return; }
  host.innerHTML = rows.map(function (b) {
    const required = +b.required || 0;
    const present = +b.present || 0;
    const missing = Math.max(0, required - present);
    const pct = required ? Math.round(present / required * 100) : 0;
    const st = branchStatus(pct, required);
    const barW = required ? Math.min(100, Math.round(present / required * 100)) : 0;
    const mini = function (v, l) { return '<div class="bh-mini"><span class="bh-mini-v">' + v + '</span><span class="bh-mini-l">' + l + '</span></div>'; };
    return '<div class="bh-card ' + st.cls + '" onclick="openBranchDetail(\'' + esc(b.branch_code) + '\')" title="Dettaglio filiale">' +
      '<div class="bh-card-head"><span class="bh-branch">' + esc(b.branch_code) + '</span>' +
      '<span class="bh-pct" style="color:' + st.color + '">' + (required ? pct + '%' : '—') + '</span></div>' +
      '<div class="bh-bar"><div class="bh-bar-fill" style="width:' + barW + '%;background:' + st.color + '"></div></div>' +
      '<div class="bh-status" style="color:' + st.color + '">' + st.label + '</div>' +
      '<div class="bh-minis">' + mini(present, 'In turno') + mini(required, 'Richiesti') +
        mini(missing, 'Mancanti') + mini(+b.absent || 0, 'Assenti') +
        mini(+b.vacation || 0, 'Ferie') + mini(+b.medical || 0, 'Malattia') + '</div>' +
      '</div>';
  }).join('');
}

// Click a branch card → detailed coverage panel (services, missing, actions).
async function openBranchDetail(code) {
  const modal = $d('branchDetailModal');
  const body = $d('branchDetailBody');
  $d('branchDetailTitle').textContent = '🗺 Filiale ' + code;
  body.innerHTML = '<div class="skel" style="height:160px;border-radius:10px"></div>';
  modal.classList.add('on');
  try {
    const date = $d('kpiDate').value || today();
    const data = await TurniApi.kpi({ date, branch: code });
    const b = ((data.dsp || []).find(function (x) { return x.branch_code === code; })) || {};
    const required = +b.required || 0, present = +b.present || 0, missing = Math.max(0, required - present);
    const pct = required ? Math.round(present / required * 100) : 0;
    const st = branchStatus(pct, required);
    const svcRows = (data.services || []).map(function (s) {
      const scls = s.coverage >= 100 ? 'b-ok' : s.coverage >= 80 ? 'b-warn' : 'b-bad';
      return '<tr><td><b>' + esc(s.label) + '</b></td><td>' + s.forecast + '</td><td>' + s.planned + '</td>' +
        '<td style="color:' + (s.delta < 0 ? 'var(--bad)' : 'var(--ok)') + '">' + (s.delta > 0 ? '+' + s.delta : s.delta) + '</td>' +
        '<td><span class="badge ' + scls + '">' + s.coverage + '%</span></td></tr>';
    }).join('') || '<tr><td colspan="5" class="text-muted">Nessun servizio con forecast.</td></tr>';
    body.innerHTML =
      '<div class="kpi-grid" style="grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px">' +
      '<div class="kpi-card" style="padding:12px"><div class="kpi-val" style="color:' + st.color + '">' + (required ? pct + '%' : '—') + '</div><div class="kpi-label">Copertura</div></div>' +
      '<div class="kpi-card" style="padding:12px"><div class="kpi-val">' + present + '</div><div class="kpi-label">In turno</div></div>' +
      '<div class="kpi-card" style="padding:12px"><div class="kpi-val">' + required + '</div><div class="kpi-label">Richiesti</div></div>' +
      '<div class="kpi-card ' + (missing > 0 ? 'bad' : 'ok') + '" style="padding:12px"><div class="kpi-val">' + missing + '</div><div class="kpi-label">Mancanti</div></div>' +
      '</div>' +
      '<div class="section-title text-sm mb-2">Copertura per servizio</div>' +
      '<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Servizio</th><th>Forecast</th><th>Pianificati</th><th>Delta</th><th>Copertura</th></tr></thead><tbody>' + svcRows + '</tbody></table></div>' +
      '<div style="margin-top:14px;display:flex;gap:8px"><button class="btn btn-primary sm" onclick="closeAll();focusBranchInBoard(\'' + esc(code) + '\')">📅 Apri nel planner</button></div>';
  } catch (e) {
    body.innerHTML = '<div style="color:var(--bad)">Errore: ' + esc(e.message) + '</div>';
  }
}

// Click a DSP/branch row on Home → open the Planning board filtered to it
function focusBranchInBoard(branchCode) {
  if (typeof goPlanning === 'function') goPlanning(); else if (_currentSection !== 'scheduler') navigate('scheduler');
  if (typeof setNavActive === 'function') setNavActive('scheduler');
  const fFiliale = document.getElementById('fFiliale');
  if (fFiliale && branchCode) { fFiliale.value = branchCode; renderGrid(); }
  const board = document.getElementById('boardOuter');
  if (board) board.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function loadAlerts() {
  try {
    const rows = await TurniApi.expiryAlerts(60);
    const tbody = $d('alertsTbl').querySelector('tbody');
    if(!rows.length) { tbody.innerHTML='<tr><td colspan="5" class="text-muted" style="padding:12px;text-align:center">Nessuna scadenza nei prossimi 60 giorni</td></tr>'; return; }
    tbody.innerHTML = rows.slice(0,25).map(r=>`<tr class="dsp-row" style="cursor:pointer" onclick="focusEmployeeInBoard('${esc(r.full_name||'')}')" title="Trova questo dipendente nel planner">
      <td><b>${esc(r.full_name||'—')}</b></td>
      <td>${esc(r.alert_type||'—')}</td>
      <td>${fmt(r.expiry_date)}</td>
      <td>${r.days_left<0?'Scaduto':r.days_left+' gg'}</td>
      <td><span class="badge ${r.level==='overdue'||r.level==='critical'?'b-bad':r.level==='warning'?'b-warn':'b-pri'}">${esc(r.level)}</span></td>
    </tr>`).join('');
  } catch(e) { $d('alertsTbl').querySelector('tbody').innerHTML=`<tr><td colspan="5" class="text-muted">${esc(e.message)}</td></tr>`; }
}

// Click an expiry/alert row on Home → open the Planning board, searched
function focusEmployeeInBoard(fullName) {
  if (typeof goPlanning === 'function') goPlanning(); else if (_currentSection !== 'scheduler') navigate('scheduler');
  if (typeof setNavActive === 'function') setNavActive('scheduler');
  const q = document.getElementById('q');
  if (q && fullName) { q.value = fullName.split(' ')[0]; renderGrid(); }
  const board = document.getElementById('boardOuter');
  if (board) board.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Activity feed ─────────────────────────────────────────────────
async function renderActivity() {
  const icons = {create:'➕',update:'✏️',delete:'🗑',login:'🔐',logout:'🚪'};
  const colors = {create:'var(--ok-bg)',update:'var(--brand-lt)',delete:'var(--bad-bg)',login:'var(--teal-bg)'};
  try {
    // Cap at 10: the card is narrow and scrollable, so rendering 20 verbose
    // audit lines only added scroll length without adding useful context.
    const data = (_kpiData?.activity || await TurniApi.audit({limit:20}) || []).slice(0,10);
    $d('activityList').innerHTML = (data||[]).map(r=>{
      const a = r.action||'';
      return `<div class="feed-item">
        <div class="feed-icon" style="background:${colors[a]||'var(--bg2)'}">${icons[a]||'⚡'}</div>
        <div><div class="feed-text">${esc(r.detail||(r.entity+' · '+r.action))}</div>
        <div class="feed-meta">${esc(r.username||'—')} · ${fmtTs(r.ts)}</div></div>
      </div>`;
    }).join('') || '<div class="text-muted text-sm">Nessuna attività</div>';
  } catch(e) { $d('activityList').innerHTML=`<div class="text-muted text-sm">${esc(e.message)}</div>`; }
}

// ── Charts ────────────────────────────────────────────────────────
function destroyChart(id) { if(_charts[id]){_charts[id].destroy();delete _charts[id];} }

function chartOpts() {
  return {
    responsive:true, maintainAspectRatio:false,
    plugins:{legend:{display:false}, tooltip:{mode:'index',intersect:false}},
    scales:{x:{grid:{display:false},ticks:{maxTicksLimit:8,font:{size:11}}},y:{grid:{color:'rgba(0,0,0,.04)'},ticks:{font:{size:11}}}}
  };
}

async function renderCharts() {
  const d = _kpiData || await TurniApi.kpi({date:$d('kpiDate').value||today()}).catch(()=>null);
  if(!d) return;

  destroyChart('chartAtt');
  if(d.attendance_trend?.length) {
    _charts.chartAtt = new Chart($d('chartAtt'), {
      type:'bar',
      data:{
        labels: d.attendance_trend.map(r=>r.d.slice(5)),
        datasets:[
          {label:'Presenti', data:d.attendance_trend.map(r=>r.present), backgroundColor:'rgba(5,150,105,.75)', borderRadius:4},
          {label:'Assenti',  data:d.attendance_trend.map(r=>r.absent),  backgroundColor:'rgba(220,38,38,.55)', borderRadius:4},
        ]
      },
      options:{...chartOpts(), plugins:{...chartOpts().plugins, legend:{display:true,position:'top',labels:{font:{size:12}}}}}
    });
  }

  destroyChart('chartFc');
  if(d.forecast_trend?.length) {
    _charts.chartFc = new Chart($d('chartFc'), {
      type:'line',
      data:{
        labels: d.forecast_trend.map(r=>r.d.slice(5)),
        datasets:[
          {label:'Forecast',   data:d.forecast_trend.map(r=>r.forecast), borderColor:'var(--brand)',backgroundColor:'rgba(79,70,229,.1)',tension:.4,fill:true,pointRadius:3},
          {label:'Pianificati',data:d.forecast_trend.map(r=>r.planned),  borderColor:'var(--ok)',   backgroundColor:'rgba(5,150,105,.05)', tension:.4,fill:false,pointRadius:3},
        ]
      },
      options:{...chartOpts(), plugins:{...chartOpts().plugins, legend:{display:true,position:'top',labels:{font:{size:12}}}}}
    });
  }

  destroyChart('chartAbs');
  if(d.absence_types?.length) {
    const palette=['var(--brand)','var(--ok)','var(--warn)','var(--bad)','var(--purple)','var(--teal)','#F59E0B','#6B7280'];
    _charts.chartAbs = new Chart($d('chartAbs'), {
      type:'doughnut',
      data:{labels:d.absence_types.map(r=>r.absence_type), datasets:[{data:d.absence_types.map(r=>r.cnt), backgroundColor:palette, borderWidth:0}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right',labels:{font:{size:12},padding:10}}}}
    });
  }

  destroyChart('chartGrow');
  if(d.employee_growth?.length) {
    _charts.chartGrow = new Chart($d('chartGrow'), {
      type:'bar',
      data:{labels:d.employee_growth.map(r=>r.month), datasets:[{label:'Nuovi',data:d.employee_growth.map(r=>r.added),backgroundColor:'rgba(79,70,229,.75)',borderRadius:6}]},
      options:chartOpts()
    });
  }
}

// ── Notifications ─────────────────────────────────────────────────
let _notifOpen=false;

function wireTools() {
  const ym=new Date().toISOString().slice(0,7);
  const addDays=(iso,n)=>{const d=new Date(iso);d.setDate(d.getDate()+n);return d.toISOString().slice(0,10);};
  $d('tplEmp').href   = TurniApi.xlsxTemplateUrl('employees');
  $d('tplFc').href    = TurniApi.xlsxTemplateUrl('forecast');
  $d('tplSch').href   = TurniApi.xlsxTemplateUrl('schedule');
  $d('expEmp').href   = TurniApi.xlsxExportUrl('employees');
  $d('expFc').href    = TurniApi.xlsxExportUrl('forecast',{month:ym});
  $d('expSch').href   = TurniApi.xlsxExportUrl('schedule',{month:ym});
  $d('pdfWeek').href  = TurniApi.pdfUrl('schedule/weekly',{from:addDays(today(),-6)});
  $d('pdfMonth').href = TurniApi.pdfUrl('schedule/monthly',{month:ym});
  $d('pdfAbs').href   = TurniApi.pdfUrl('absences',{month:ym});
}

// ── Boot ──────────────────────────────────────────────────────────
async function bootWorkspaceOverview() {
  initSidebarUser();
  setGreeting();
  $d('kpiDate').value = today();
  $d('kpiDate').addEventListener('change', refreshOverview);
  await initBranches();
  // Load config from DB so branches/services are always current
  if (DB_SYNC) {
    const br = teamFiliale || (filiali()[0] || 'DLO1');
    await loadConfigFromDB(br).catch(()=>{});
    refreshFilSelects();
  }
  wireTools();
  refreshOverview();
  loadNotifications();
  TurniApi.refreshNotifications && TurniApi.refreshNotifications().catch(()=>{});
  setInterval(loadNotifications, 5*60*1000);
  setInterval(refreshOverview, 5*60*1000); // Auto-refresh KPIs every 5 min
  $d('navSync').textContent = '🟢 PostgreSQL';
}
// bootWorkspaceOverview() called once when the workspace first mounts


// ── Report charts (separate canvases in reports section) ──────────
var _rptCharts = {};
