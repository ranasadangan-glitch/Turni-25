/* TurniDSP — Board Monday-style (drag&drop, context menu, slide panel)
   Estratto dal monolite app.html: stesso scope globale, stesso comportamento.
   Ordine di caricamento definito in app.html (vedi fondo pagina). */
// ── Board renderGrid (Monday-style) ──────────────────────────────
var CLS_COLORS_SPA = {
  next:  {bg:'var(--next-bg)', fg:'var(--next)', br:'var(--next-br)', av:'#92400E'},
  samea: {bg:'var(--samea-bg)',fg:'var(--samea)',br:'var(--samea-br)',av:'#1E40AF'},
  sameb: {bg:'var(--sameb-bg)',fg:'var(--sameb)',br:'var(--sameb-br)',av:'#5B21B6'},
  mm:    {bg:'var(--mm-bg)',   fg:'var(--mm)',   br:'var(--mm-br)',   av:'#065F46'},
  abs:   {bg:'var(--abs-bg)',  fg:'var(--abs)',  br:'var(--abs-br)',  av:'#374151'},
  mal:   {bg:'var(--mal-bg)',  fg:'var(--mal)',  br:'var(--mal-br)',  av:'#991B1B'},
  off:   {bg:'var(--off-bg)',  fg:'var(--off)',  br:'var(--off-br)',  av:'#374151'},
};
function getCLS(c){ return CLS_COLORS_SPA[c] || CLS_COLORS_SPA.abs; }
// Feedback when a user clicks a locked (post-expiry) cell.
function cellExpiredMsg(){ if(typeof toast==='function') toast('Contratto scaduto — giorno bloccato in OFF','warn'); }
var _grpCollapsed = new Set();
var dayCursor = 1;   // day-view cursor (1..daysInMonth), used when planMode==='day'
// How rows are grouped: 'class' = by contract-class/rotta (default),
// 'service' = one group per service (Service view), 'none' = one flat list
// of employees (Employee view). Time range stays independent (planMode).
var boardGroupBy = 'none';   // default flat list (grouping toggle removed, spec §16)
function setGroupBy(m){
  boardGroupBy=m;
  document.querySelectorAll('#groupBySeg button').forEach(function(b){b.classList.toggle('on',b.dataset.gb===m);});
  renderGrid();
}

function buildGroups(drivers) {
  if(boardGroupBy==='none'){
    return drivers.length?[{cls:'abs',name:'Tutti i dipendenti',drivers:drivers.slice()}]:[];
  }
  if(boardGroupBy==='service'){
    var map={},order=[];
    drivers.forEach(function(d){
      var key=d.service||'—';
      if(!(key in map)){map[key]=[];order.push(key);}
      map[key].push(d);
    });
    return order.map(function(k){
      var cls=codeMeta(defCode(k)).cls||'abs';
      return {cls:cls,name:k,drivers:map[k]};
    });
  }
  var groups=CFG().groups, result=[], used={};
  for(var gi=0;gi<groups.length;gi++){
    var g=groups[gi];
    var drv=drivers.filter(function(d){
      var dc=codeMeta(d.defaultCode||defCode(d.service)).cls||'abs';
      return dc===g.cls&&!used[d.id];
    });
    if(drv.length>0){drv.forEach(function(d){used[d.id]=1;});result.push({cls:g.cls,name:g.name,drivers:drv});}
  }
  var lo=drivers.filter(function(d){return !used[d.id];});
  if(lo.length) result.push({cls:'abs',name:'Altri',drivers:lo});
  return result;
}
function toggleGroup(cls){
  if(_grpCollapsed.has(cls))_grpCollapsed.delete(cls); else _grpCollapsed.add(cls);
  renderGrid();
}

// Footer KPIs (Driver / In turno / Assenti / OFF / Forecast / Delta /
// Copertura / Conflitti / Sync) + violation banner. Standalone so any mutation
// (cell edit, paint, drag&drop, delete, undo/redo, generate, import) can call
// it for instant recalculation without a full grid re-render (spec §18/§19).
function refreshBottomBar(){
  if(typeof state==='undefined'||!state)return;
  var visDays=(typeof gridDays!=='undefined'&&gridDays.length)?gridDays:[];
  var refDay=gridRefDay,all=scopedActive();
  var kPres=0,kAbs=0,kOff=0,kViols=0;
  all.forEach(function(dr){
    var c=getCode(dr.id,refDay);
    if(c){var cls=codeCls(c);if(c.toUpperCase()==='OFF')kOff++;else if(cls==='mal')kAbs++;else kPres++;}
    if(driverHasViolation(dr))kViols++;
  });
  var svs=scopeServices();
  var selSvc=(document.getElementById('fService')||{}).value||'';
  var selCode=selSvc&&typeof defCode==='function'?defCode(selSvc):'';
  var fcSvcs=selSvc?svs.filter(function(s){return (s.count||[]).indexOf(selCode)>=0;}):svs;
  var fcT=0,plT=0;
  fcSvcs.forEach(function(s){visDays.forEach(function(d){fcT+=forecastOf(s,d);plT+=cnt(dayCodes(d,all),s.count);});});
  var delta=plT-fcT;
  function setEl(id,v){var e=document.getElementById(id);if(e)e.textContent=v;}
  setEl('kpiDrivers',all.length);setEl('kpiPresent',kPres);setEl('kpiAbsent',kAbs);
  setEl('kpiOff',kOff);setEl('kpiFc',fcT||'—');setEl('kpiCov',fcT>0?Math.round(plT/fcT*100)+'%':'—');
  setEl('kpiFcLbl',selSvc?('Forecast · '+selSvc):'Forecast');
  setEl('kpiDelta',(fcT||plT)?(delta>0?'+'+delta:delta):'—');
  var dTile=document.getElementById('kpiDeltaTile');
  if(dTile){dTile.classList.remove('ok','bad','warn');dTile.classList.add(delta<0?'bad':(delta>0?'ok':'warn'));}
  setEl('kpiViol',kViols);setEl('kpiSyncBar',(typeof DB_SYNC!=='undefined'&&DB_SYNC)?'🟢 DB':'🟡 locale');
  setEl('statDrivers',all.length);setEl('statPresent',kPres);setEl('statAbsent',kAbs);setEl('statOff',kOff);
  var viols=all.filter(driverHasViolation),vb=document.getElementById('violBanner');
  if(vb){if(viols.length){vb.style.display='block';vb.innerHTML='<b>⚠️ Attenzione riposi:</b> '+viols.length+' DAS con 7+ giorni consecutivi: '+viols.slice(0,5).map(function(d){return esc(d.cognome);}).join(', ')+(viols.length>5?'…':'')+'.';} else vb.style.display='none';}
  if(typeof renderOpsKPI==='function'){try{renderOpsKPI();}catch(e){}}
  if(typeof renderForecastDeltaFooter==='function'){try{renderForecastDeltaFooter();}catch(e){}}
}
// Recompute one employee's SEM (total worked days) cell in place (spec §15).
function updateRowTotal(id){
  var d0=(typeof gridDays!=='undefined'&&gridDays.length)?gridDays[0]:1;
  var anyCell=document.getElementById('c_'+id+'_'+d0);if(!anyCell)return;
  var row=anyCell.closest('.emp-board-row');if(!row)return;
  var tot=row.querySelector('.tot-sc');if(!tot)return;
  var dr=state.drivers.find(function(x){return x.id===id;});if(!dr)return;
  tot.textContent=workedDays(dr,gridDays);
}

renderGrid = function() {
  var allDays=[]; for(var dd=1;dd<=daysInMonth(YM);dd++) allDays.push(dd);
  var weeks=monthWeeks();
  if(weekIdx>=weeks.length)weekIdx=weeks.length-1;
  if(weekIdx<0)weekIdx=0;
  if(dayCursor<1)dayCursor=1; if(dayCursor>daysInMonth(YM))dayCursor=daysInMonth(YM);
  var visDays=planMode==='week'?(weeks[weekIdx]?weeks[weekIdx].days:allDays)
             :planMode==='day'?[dayCursor]
             :allDays;
  // Header label
  var mNames=['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
  var ym=YM.split('-').map(Number);
  var label=mNames[ym[1]-1]+' '+ym[0];
  if(planMode==='week'&&weeks.length){var w=weeks[weekIdx];label+='  ·  Week '+w.week+' · '+fmtDM(YM,w.days[0])+'–'+fmtDM(YM,w.days[w.days.length-1]);}
  if(planMode==='day'){label+='  ·  '+dowName(YM,dayCursor).toUpperCase()+' '+fmtDM(YM,dayCursor);}
  var ml=document.getElementById('monthLabel'); if(ml) ml.textContent=label;
  var ps=document.getElementById('planScope'); if(ps) ps.textContent='';
  var wn=document.getElementById('weekNav'); if(wn) wn.style.display='none';
  var now=new Date(),nowISO=now.toISOString().slice(0,7),nowDay=now.getDate();
  var all=scopedActive();
  window._schedVisDays=visDays;                 // metric maths for the SEM/sort filters
  var drivers=filteredDrivers();
  if(typeof schedApplySort==='function')drivers=schedApplySort(drivers,visDays);
  gridRefDay=(nowISO===YM&&visDays.includes(nowDay))?nowDay:visDays[0];
  gridDrivers=drivers;gridDays=visDays;refreshCodeList();
  refreshBottomBar();   // footer KPIs + violation banner (also callable standalone)
  // Grid layout
  var cellW=planMode==='day'?'minmax(140px,1fr)':'50px';
  var colT='205px repeat('+visDays.length+','+cellW+') 38px';
  document.documentElement.style.setProperty('--grid-cols',colT);
  var html='';
  // Column headers
  // Header on three separate rows — settimana / data / giorno — mirroring the
  // source spreadsheet (SETT. 28 · 05/07 · DOM) instead of stacking the
  // weekday and day number inside one cell. Weeks run Sunday→Saturday, the
  // same grouping the forecast editor and the original file use.
  var mm=YM.split('-')[1];
  // Week separators (§3): mark the first visible day of each week (except the
  // very first) so a clear vertical divider is drawn between WK groups.
  var wkSepDays={},_wkPrev=null;
  visDays.forEach(function(d){var st=sunWeek(YM,d).start;if(_wkPrev!==null&&st!==_wkPrev)wkSepDays[d]=1;_wkPrev=st;});
  var wkSep=function(d){return wkSepDays[d]?' wk-sep':'';};
  // Live-search highlight: wrap matches of the current query in the driver
  // name/sub cells. _q is read once per render; _hl guards if the helper is absent.
  var _q=(document.getElementById('q')||{}).value||'';
  var _hl=function(s){return (_q&&typeof window._schedHL==='function')?window._schedHL(s,_q):s;};
  var dayCls=function(d){
    var isT=nowISO===YM&&d===nowDay;
    var isW=[0,6].includes(new Date(YM+'-'+String(d).padStart(2,'0')).getDay());
    return 'col-day-h'+(isT?' today-h':'')+(isW?' wend-h':'')+wkSep(d);
  };
  // 1) settimana
  html+='<div class="board-thead th-wk" style="grid-template-columns:'+colT+'">';
  html+='<div class="col-emp-h"></div>';
  var curKey=null;
  visDays.forEach(function(d){
    var wm=sunWeek(YM,d);
    if(wm.start!==curKey){
      var span=visDays.filter(function(k){return sunWeek(YM,k).start===wm.start;}).length;
      var wkA=(typeof weekFilterActive==='function'&&weekFilterActive(wm.start));
      html+='<div class="col-wk-h'+(curKey!==null?' wk-sep':'')+'" style="grid-column:span '+span+'">SETT. '+wm.label+
        '<button class="colf-btn colx-btn'+(wkA?' active':'')+'" title="Filtro settimana (Excel)" onclick="weekFilterOpen(event,\''+wm.start+'\')">'+(wkA?'▼':'▾')+'</button></div>';
      curKey=wm.start;
    }
  });
  html+='<div class="col-tot-h"></div></div>';
  // 2) data
  html+='<div class="board-thead th-dt" style="grid-template-columns:'+colT+'">';
  var empA=(typeof empFilterActive==='function'&&empFilterActive())||(typeof colSortActive==='function'&&colSortActive());
  html+='<div class="col-emp-h col-emp-hf"><span>DAS / Servizio</span>'+
    '<button class="colf-btn colx-btn'+(empA?' active':'')+'" title="Filtra / ordina dipendenti (Excel)" onclick="empFilterOpen(event)">'+(empA?'▼':'▾')+'</button></div>';
  visDays.forEach(function(d){
    var fActive=(typeof colFilterActive==='function'&&colFilterActive(d));
    html+='<div class="'+dayCls(d)+'" data-day="'+d+'"><span class="ddate">'+String(d).padStart(2,'0')+'/'+mm+'</span>'+
      '<button class="colf-btn'+(fActive?' active':'')+'" title="Filtro colonna (Excel)" onclick="colFilterOpen(event,'+d+')">'+(fActive?'▼':'▾')+'</button></div>';
  });
  var semA=(typeof semFilterActive==='function'&&semFilterActive());
  html+='<div class="col-tot-h col-tot-hf"><span>SEM</span>'+
    '<button class="colf-btn colx-btn'+(semA?' active':'')+'" title="Ordina / filtra per metrica" onclick="semFilterOpen(event)">'+(semA?'▼':'▾')+'</button></div></div>';
  // 3) giorno
  html+='<div class="board-thead th-dw" style="grid-template-columns:'+colT+'">';
  html+='<div class="col-emp-h"></div>';
  visDays.forEach(function(d){
    html+='<div class="'+dayCls(d)+'"><span class="dow">'+dowName(YM,d).toUpperCase()+'</span></div>';
  });
  html+='<div class="col-tot-h"></div></div>';
  if(!drivers.length){
    _vTeardown();
    var biE=document.getElementById('boardInner');biE.classList.remove('v-on');
    html+='<div class="board-empty"><div class="ei">👥</div><p>Nessun DAS'+(scopeFil()?' per '+esc(scopeFil()):'')+'. Aggiungilo da "Anagrafica DAS".</p></div>';
    biE.innerHTML=html;return;
  }
  var groups=buildGroups(drivers);
  // Flatten groups → a single render list (group header + its driver rows).
  // Collapsed groups contribute only their header. This flat model is what lets
  // us window very large rosters (virtual scrolling) without changing editing,
  // sticky columns, drag&drop or grouping.
  var flat=[];
  groups.forEach(function(grp){
    var coll=_grpCollapsed.has(grp.cls);
    flat.push({t:'g',grp:grp,collapsed:coll});
    if(!coll) grp.drivers.forEach(function(dr){ flat.push({t:'d',dr:dr,grp:grp}); });
  });
  function ghHTML(grp,collapsed){
    var st=getCLS(grp.cls),h='';
    h+='<div class="group-header-row'+(collapsed?' collapsed':'')+'" style="grid-template-columns:'+colT+'">';
    h+='<div class="gh-cell" onclick="toggleGroup(\''+grp.cls+'\')"><span class="gh-arrow">▼</span><span class="gh-dot" style="background:'+st.fg+'"></span>'+esc(grp.name)+'<span class="gh-count">'+grp.drivers.length+'</span></div>';
    for(var gi=0;gi<visDays.length;gi++) h+='<div style="background:'+st.bg+';opacity:.3;border-right:1px solid var(--line)"></div>';
    h+='<div style="background:'+st.bg+';opacity:.3"></div></div>';
    return h;
  }
  function drHTML(dr,grp){
    var st=getCLS(grp.cls),vflag=consecutiveFlag(dr),viol=Object.keys(vflag).length>0;
    var initials=((dr.cognome||'')[0]||'').toUpperCase()+((dr.nome||'')[0]||'').toUpperCase();
    var wTotal=workedDays(dr,visDays),h='';
    h+='<div class="emp-board-row'+(window._schedSelEmp==dr.id?' emp-row-sel':'')+'" data-drv="'+dr.id+'" style="grid-template-columns:'+colT+'">';
    h+='<div class="emp-cell" onclick="schedSelectEmp('+dr.id+');openOpsBottom('+dr.id+')" title="Dettaglio operativo">'+(viol?'<span class="viol-dot" title="7+ giorni consecutivi">⚠</span>':'')+
      '<div class="emp-avatar" style="background:'+st.av+'">'+esc(initials)+'</div>'+
      '<div style="min-width:0"><div class="emp-name-text">'+_hl(esc(dr.cognome)+' '+esc(dr.nome))+'</div>'+
      '<div class="emp-sub-text">'+_hl(esc(dr.filiale)+' · '+esc(dr.contratto||'—'))+'</div></div></div>';
    visDays.forEach(function(d){
      // Contract expiry: days after the expiry date render as a locked OFF cell
      // (existing OFF style), not editable. Enforced dynamically so changing the
      // expiry date reflects on the next render — no stored regeneration needed.
      if(typeof afterExpiry==='function'&&afterExpiry(dr,d)){
        var eT=nowISO===YM&&d===nowDay,eW=[0,6].includes(new Date(YM+'-'+String(d).padStart(2,'0')).getDay()),est=getCLS('off');
        h+='<div id="c_'+dr.id+'_'+d+'" class="shift-cell sc-expired'+(eT?' today-sc':'')+(eW?' wend-sc':'')+wkSep(d)+'" title="Contratto scaduto — OFF automatico" onclick="cellExpiredMsg()">'+
          '<div class="shift-card sc-lock" style="background:'+est.bg+';color:'+est.fg+';border-color:'+est.br+'">OFF 🔒</div></div>';
        return;
      }
      var code=getCode(dr.id,d),cls=codeCls(code),cst=getCLS(cls);
      var isT=nowISO===YM&&d===nowDay,isW=[0,6].includes(new Date(YM+'-'+String(d).padStart(2,'0')).getDay()),isV=!!vflag[d];
      h+='<div id="c_'+dr.id+'_'+d+'" class="shift-cell'+(isT?' today-sc':'')+(isW?' wend-sc':'')+(isV?' viol-sc':'')+wkSep(d)+'"'+
        ' onclick="cellClick(event,'+dr.id+','+d+')"'+
        ' ondblclick="spOpenPanel('+dr.id+','+d+')"'+
        ' oncontextmenu="event.shiftKey?cellPopBrush(event,\''+esc(code||'')+'\'):boardCtxOpen(event,'+dr.id+','+d+')"'+
        ' ondragover="boardDragOver(event,this)"'+
        ' ondragleave="boardDragLeave(this)"'+
        ' ondrop="boardDrop(event,'+dr.id+','+d+')">';
      if(code){
        h+='<div class="shift-card" draggable="true"'+
          ' ondragstart="boardDragStart(event,'+dr.id+','+d+')"'+
          ' ondragend="boardDragEnd()"'+
          ' style="background:'+cst.bg+';color:'+cst.fg+';border-color:'+cst.br+'"'+
          ' title="'+esc(codeLabel(code))+'">'+esc(code)+'</div>';
      }
      h+='</div>';
    });
    h+='<div class="tot-sc">'+wTotal+'</div></div>';
    return h;
  }
  function itemHTML(it){ return it.t==='g'?ghHTML(it.grp,it.collapsed):drHTML(it.dr,it.grp); }

  var bi=document.getElementById('boardInner');
  var zoom=parseFloat(bi.style.zoom||'1')||1;
  // Full render for normal rosters (and while zoomed) — identical to before.
  if(flat.length<=VIRTUAL_MIN||zoom!==1){
    _vTeardown();
    bi.classList.remove('v-on');
    for(var fi=0;fi<flat.length;fi++) html+=itemHTML(flat[fi]);
    bi.innerHTML=html;
    return;
  }
  // Virtualized path: only the visible window of rows is in the DOM.
  bi.classList.add('v-on');
  bi.innerHTML=html+'<div id="vTop"></div><div id="vWin"></div><div id="vBot"></div>';
  _vStart(flat,itemHTML);
};

// ── Virtual scrolling (row windowing) ────────────────────────────
// Fixed heights (enforced by CSS .v-on) keep the spacer math exact; a large
// pixel buffer above/below covers header-offset imprecision so no blank rows
// appear. Active only for big rosters at 1× zoom (see renderGrid).
var VIRTUAL_MIN=150, V_DR_H=35, V_GH_H=31, V_BUFFER=600;
var _vState=null;
function _vTeardown(){
  if(_vState){ window.removeEventListener('scroll',_vState.onScroll,true); window.removeEventListener('resize',_vState.onScroll); }
  _vState=null;
}
// Container-agnostic row windowing: the scheduler board scrolls via the page
// section (not boardOuter), so we listen to scroll at the window in the capture
// phase (catches any nested scroller) and decide the visible window purely from
// the list's viewport position — no assumption about which element scrolls.
function _vStart(flat,itemHTML){
  _vTeardown();
  var top=document.getElementById('vTop'),win=document.getElementById('vWin'),bot=document.getElementById('vBot');
  if(!top||!win||!bot)return;
  var offs=new Array(flat.length+1);offs[0]=0;
  for(var i=0;i<flat.length;i++) offs[i+1]=offs[i]+(flat[i].t==='g'?V_GH_H:V_DR_H);
  var total=offs[flat.length];
  var st={onScroll:null,raf:0,lastStart:-1,lastEnd:-1};
  function render(){
    st.raf=0;
    if(_vState!==st||!document.getElementById('vTop'))return;  // superseded / torn down
    var contentTop=top.getBoundingClientRect().top;            // viewport y of list start
    var a=-contentTop-V_BUFFER, b=window.innerHeight-contentTop+V_BUFFER;
    var start=0; while(start<flat.length&&offs[start+1]<a) start++;
    var end=start; while(end<flat.length&&offs[end]<b) end++;
    if(start===st.lastStart&&end===st.lastEnd) return;
    st.lastStart=start; st.lastEnd=end;
    top.style.height=offs[start]+'px';
    bot.style.height=(total-offs[end])+'px';
    var h=''; for(var i=start;i<end;i++) h+=itemHTML(flat[i]);
    win.innerHTML=h;
  }
  st.onScroll=function(){ if(!st.raf) st.raf=requestAnimationFrame(render); };
  window.addEventListener('scroll',st.onScroll,true);
  window.addEventListener('resize',st.onScroll);
  _vState=st;
  render();
}

// ── goToToday / shiftWeek ────────────────────────────────────────
function goToToday(){
  var ti=new Date().toISOString().slice(0,7);
  if(ti!==YM){YM=ti;weekIdx=0;loadMonth();return;}
  var weeks=monthWeeks(),td=new Date().getDate();weekIdx=0;dayCursor=td;
  for(var i=0;i<weeks.length;i++){if(weeks[i].days.includes(td)){weekIdx=i;break;}}renderGrid();
}
function shiftWeek(dir){
  if(planMode==='day'){dayCursor=Math.max(1,Math.min(daysInMonth(YM),dayCursor+dir));renderGrid();}
  else if(planMode==='week'){var weeks=monthWeeks();weekIdx=Math.max(0,Math.min(weeks.length-1,weekIdx+dir));renderGrid();}
  else shiftMonth(dir);
}

// ── Drag & Drop ──────────────────────────────────────────────────
var _bdSrc=null;
// Select an employee row (highlight it). DOM-only toggle — no re-render, so it
// stays instant with 2000+ rows; the class is also re-emitted by drHTML so the
// selection survives the next render.
window.schedSelectEmp=function(id){
  window._schedSelEmp=id;
  var b=document.getElementById('boardInner'); if(!b)return;
  var prev=b.querySelector('.emp-board-row.emp-row-sel'); if(prev)prev.classList.remove('emp-row-sel');
  var row=b.querySelector('.emp-board-row[data-drv="'+id+'"]'); if(row)row.classList.add('emp-row-sel');
};
function boardDragStart(e,id,d){_bdSrc={id,d,code:getCode(id,d)};e.dataTransfer.effectAllowed='copyMove';e.target.classList.add('dragging');}
function boardDragEnd(){document.querySelectorAll('.shift-card.dragging').forEach(function(el){el.classList.remove('dragging');});_bdSrc=null;}
function boardDragOver(e,cell){if(!_bdSrc)return;e.preventDefault();var copy=e.altKey||e.ctrlKey;cell.classList.toggle('drag-over',!copy);cell.classList.toggle('copy-over',copy);}
function boardDragLeave(cell){cell.classList.remove('drag-over','copy-over');}
function boardDrop(e,tId,tDay){
  e.preventDefault();e.currentTarget.classList.remove('drag-over','copy-over');
  if(!_bdSrc)return;var copy=e.altKey||e.ctrlKey,src=_bdSrc;
  if(src.id===tId&&src.d===tDay)return;
  if(typeof pushUndo==='function')pushUndo(JSON.parse(JSON.stringify(state.schedule)));
  commitCell(tId,tDay,src.code);if(!copy)commitCell(src.id,src.d,'');
  toast((copy?'📋 Copiato':'↕ Spostato')+': '+(src.code||'vuoto'));renderGrid();
}

// ── Context menu ─────────────────────────────────────────────────
var _bdCtx=null,_bdClipboard=null;
function boardCtxOpen(e,id,d){
  e.preventDefault();_bdCtx={id,d};
  var m=document.getElementById('ctxMenu');
  var p=document.getElementById('ctx-paste');if(p)p.style.display=_bdClipboard?'flex':'none';
  m.style.left=Math.min(e.clientX,window.innerWidth-170)+'px';
  m.style.top=Math.min(e.clientY,window.innerHeight-160)+'px';
  m.style.display='block';
}
document.addEventListener('click',function(){document.getElementById('ctxMenu').style.display='none';});
function boardCtxAction(action){
  if(!_bdCtx)return;var id=_bdCtx.id,d=_bdCtx.d,code=getCode(id,d);
  if(action==='edit')spOpenPanel(id,d);
  else if(action==='copy'){_bdClipboard=code;showKbdHint('📋 Copiato: '+(code||'vuoto'));}
  else if(action==='paste'&&_bdClipboard!==null){if(typeof pushUndo==='function')pushUndo(JSON.parse(JSON.stringify(state.schedule)));commitCell(id,d,_bdClipboard);renderGrid();}
  else if(action==='duplicate'&&code){
    var dow_=dow(YM,d),days=daysInMonth(YM);if(typeof pushUndo==='function')pushUndo(JSON.parse(JSON.stringify(state.schedule)));var n=0;
    for(var dd=1;dd<=days;dd++){if(dow(YM,dd)===dow_){commitCell(id,dd,code);n++;}}toast('Duplicato su '+n+' giorni');renderGrid();
  }
  else if(action==='delete'){if(typeof pushUndo==='function')pushUndo(JSON.parse(JSON.stringify(state.schedule)));commitCell(id,d,'');renderGrid();}
}

// ── Slide panel (shift editor) ────────────────────────────────────
var _spCtxSPA=null;
function spOpenPanel(driverId,day){
  var dr=state.drivers.find(function(x){return x.id===driverId;});if(!dr)return;
  if(typeof afterExpiry==='function'&&afterExpiry(dr,day)){cellExpiredMsg();return;}
  _spCtxSPA={driverId,day};
  var curCode=getCode(driverId,day);
  document.getElementById('spTitle').textContent=dr.cognome+' '+dr.nome;
  document.getElementById('spSub').textContent=dowName(YM,day)+' '+fmtDM(YM,day)+' — '+YM;
  var grid=document.getElementById('spServiceGrid');grid.innerHTML='';
  groupedCodes().forEach(function(g){
    g.codes.forEach(function(c){
      var btn=document.createElement('button');btn.className='sp-service-btn'+(c===curCode?' active':'');
      btn.style.background='var(--'+g.cls+'-bg)';btn.style.color='var(--'+g.cls+')';
      btn.textContent=c;btn.title=codeLabel(c);
      btn.onclick=function(){
        document.querySelectorAll('.sp-service-btn').forEach(function(b){b.classList.toggle('active',b.textContent===c);});
        document.getElementById('spCodeInput').value=c;
      };
      grid.appendChild(btn);
    });
  });
  document.getElementById('spCodeInput').value=curCode||'';
  document.getElementById('spNote').value='';
  document.getElementById('spDriverInfo').innerHTML='<b>'+esc(dr.filiale)+'</b> · '+esc(dr.service)+' · '+esc(dr.contratto||'—');
  var dSel=document.getElementById('spDriver');
  dSel.innerHTML=scopedActive().map(function(d){return '<option value="'+d.id+'"'+(d.id===driverId?' selected':'')+'>'+esc(d.cognome)+' '+esc(d.nome)+'</option>';}).join('');
  document.getElementById('spDay').value=day;document.getElementById('spDay').max=daysInMonth(YM);
  var conflicts=[];
  if(curCode&&curCode.toUpperCase()!=='OFF'){var cf=consecutiveFlag(dr);if(Object.keys(cf).length>0)conflicts.push('7+ giorni consecutivi senza riposo');}
  if(dr.ctrType==='determinato'&&dr.expiry){var exp=new Date(dr.expiry+'T00:00:00'),tgt=new Date(YM+'-'+String(day).padStart(2,'0')+'T00:00:00');if(tgt>exp)conflicts.push('Contratto scaduto il '+fmtDate(dr.expiry));}
  document.getElementById('spConflicts').innerHTML=conflicts.map(function(c){return '<div class="sp-conflict"><span>⚠️</span><span>'+esc(c)+'</span></div>';}).join('');
  document.getElementById('slidePanel').classList.add('open');
  document.getElementById('spBackdrop').style.display='block';
  setTimeout(function(){document.getElementById('spCodeInput').focus();},230);
}
function closePanel(){
  document.getElementById('slidePanel').classList.remove('open');
  document.getElementById('spBackdrop').style.display='none';
  _spCtxSPA=null;
}
function boardSpSave(){
  var ctx=_spCtxSPA;if(!ctx)return;
  var code=document.getElementById('spCodeInput').value.trim();
  var resolved=code?resolveCode(code):'';
  if(code&&resolved===null){toast('Codice non valido: '+code);return;}
  if(typeof pushUndo==='function')pushUndo(JSON.parse(JSON.stringify(state.schedule)));
  commitCell(ctx.driverId,ctx.day,resolved||'');
  closePanel();renderGrid();setSaveState('saving');setTimeout(function(){setSaveState('saved');},800);
}
function boardSpDuplicate(){
  var ctx=_spCtxSPA;if(!ctx)return;
  var code=resolveCode(document.getElementById('spCodeInput').value.trim());
  if(!code){toast('Seleziona un codice prima di duplicare');return;}
  var dow_=dow(YM,ctx.day),days=daysInMonth(YM);
  if(typeof pushUndo==='function')pushUndo(JSON.parse(JSON.stringify(state.schedule)));
  var n=0;for(var d=1;d<=days;d++){if(dow(YM,d)===dow_){commitCell(ctx.driverId,d,code);n++;}}
  dirty();renderGrid();closePanel();toast('Duplicato su '+n+' giorni');
}
function boardSpDelete(){
  var ctx=_spCtxSPA;if(!ctx)return;
  if(typeof pushUndo==='function')pushUndo(JSON.parse(JSON.stringify(state.schedule)));
  commitCell(ctx.driverId,ctx.day,'');
  dirty();renderGrid();closePanel();setSaveState('saved');
}

// ── Keyboard shortcuts ────────────────────────────────────────────
document.addEventListener('keydown',function(e){
  var inInput=['INPUT','TEXTAREA','SELECT'].includes(document.activeElement&&document.activeElement.tagName);
  if(e.key==='Escape'){
    closePanel();
    document.getElementById('ctxMenu').style.display='none';
    document.querySelectorAll('.overlay.on').forEach(function(o){o.classList.remove('on');});
  }
  if(e.ctrlKey&&!e.shiftKey&&e.key==='z'){e.preventDefault();if(typeof doUndo==='function')doUndo();}
  if(e.ctrlKey&&e.shiftKey&&(e.key==='z'||e.key==='Z')){e.preventDefault();if(typeof doRedo==='function')doRedo();}
  // Ctrl+F → focus the visible employee search (opens the planner + filter bar first).
  if(e.ctrlKey&&(e.key==='f'||e.key==='F')){e.preventDefault();if(typeof goPlanning==='function')goPlanning();setTimeout(function(){var sb=document.getElementById('sfbSearch')||document.getElementById('q');if(sb){sb.focus();if(sb.select)sb.select();}},60);showKbdHint('🔍 Cerca dipendente');}
  // Ctrl+K → focus the header global search (employees across the app).
  if(e.ctrlKey&&(e.key==='k'||e.key==='K')){var gs=document.getElementById('globalSearch');if(gs){e.preventDefault();gs.focus();if(gs.select)gs.select();showKbdHint('🔍 Ricerca globale');}}
  if(e.ctrlKey&&e.key==='s'&&!inInput){e.preventDefault();saveAll(false);setSaveState('saved');showKbdHint('💾 Salvato');}
});

// ── Dashboard JS (adapted) ────────────────────────────────────────


