/* TurniDSP — Scheduler engine (core)
   Estratto dal monolite app.html: stesso scope globale, stesso comportamento.
   Ordine di caricamento definito in app.html (vedi fondo pagina). */



/* ============================================================
   TurniDSP v4 — vista settimanale, filiali configurabili,
   scoping per filiale (team), import/export DAS, export
   settimanale per i driver. Motore Excel configurabile.
   ============================================================ */

const DEF_GROUPS=[{cls:"next",name:"Rotte NEXT (DLO1)"},{cls:"samea",name:"Same Day — furgone"},{cls:"sameb",name:"Same Day — furgone (B/C)"},{cls:"mm",name:"Micromobilità (cargo bike)"},{cls:"abs",name:"Altri servizi"},{cls:"mal",name:"Assenze"},{cls:"off",name:"Riposo"}];
const DEF_CODES=[["X","NEXT","next"],["L1","NEXT L1","next"],["L2","NEXT L2","next"],["L3","NEXT L3","next"],["LAVORA","Lavora","next"],["XN","NEXT N","next"],["EXTRA","Extra","next"],["CT","CT","next"],["SameA","Same A","samea"],["SameE","Same E","samea"],["SameAE","Same A+E","samea"],["SameB","Same B","sameb"],["SameC","Same C","sameb"],["SameBC","Same B+C","sameb"],["MM","CargoBike NEXT","mm"],["MMA","MM Same A","mm"],["MME","MM Same E","mm"],["MMAE","MM Same A+E","mm"],["MMB","MM Same B","mm"],["MMC","MM Same C","mm"],["MMBC","MM Same B+C","mm"],["XW","Walker","abs"],["N","Navetta","abs"],["NAV","Navetta AMZ","abs"],["NAVETTA","Navetta","abs"],["FEDEX","FedEx","abs"],["TNT","TNT","abs"],["MILKMAN","Milkman","abs"],["UFFICIO","Ufficio","abs"],["FLEET","Fleet","abs"],["AFF","Affiancato","abs"],["CORSO","Corso","abs"],["DLZ1","DLZ1","abs"],["DLZ2","DLZ2","abs"],["DLZ3","DLZ3","abs"],["DLO1","DLO1","abs"],["DLO7","DLO7","abs"],["DLO8","Altri appalti","abs"],["M","Malattia","mal"],["I","Infortunio","mal"],["AI","Assenza ing.","mal"],["PT","Paternità","mal"],["F","Ferie","mal"],["ROL","ROL","mal"],["PS","Perm. sindacale","mal"],["104","Legge 104","mal"],["LUTTO","Lutto","mal"],["ASP","Aspettativa","mal"],["DS","Donazione sangue","mal"],["SOSPESO","Sospeso","mal"],["PR","Perm. retribuito","mal"],["EXF","Ex festività","mal"],["CI","Cassa int.","mal"],["MATR","Matrimoniale","mal"],["CONG","Congedo","mal"],["SCIOPERO","Sciopero","mal"],["EM","Emergency","mal"],["OFF","Riposo","off"]].map(([code,label,cls])=>({code,label,cls}));
/* Contracts are defined by WORKING DAYS + HR rules (type, days/week,
   consecutive rest, allowed days), never by hours. */
const DEF_CONTRACTS=[{code:"21",label:"Full time",type:"full",workDays:6,restDays:1,defDays:[1,2,3,4,5,6]},{code:"PTV 18h",label:"Part-time Verticale",type:"vertical",workDays:3,restDays:4,defDays:[1,2,3]},{code:"PTV 13h",label:"Part-time Verticale",type:"vertical",workDays:2,restDays:5,defDays:[1,2]},{code:"13",label:"Part-time",type:"part",workDays:5,restDays:2,defDays:[1,2,3,4,5]},{code:"PTO 24h",label:"Part-time Orizzontale",type:"part",workDays:4,restDays:3,defDays:[1,2,3,4]},{code:"PTI 26h",label:"Part-time",type:"part",workDays:5,restDays:2,defDays:[1,2,3,4,5]},{code:"PTO 26h",label:"Part-time Orizzontale",type:"part",workDays:5,restDays:2,defDays:[1,2,3,4,5]},{code:"PTO 32h",label:"Part-time Orizzontale",type:"part",workDays:6,restDays:1,defDays:[1,2,3,4,5,6]}];
const DEF_SERVICES=[{key:"DLO1_NEXT",label:"DLO1 NEXT",count:["X","L1","L2","L3","LAVORA","XN","EXTRA","CT"],filiali:["DLO1"]},{key:"DLO1_MM_NEXT",label:"DLO1 MM NEXT",count:["MM"],filiali:["DLO1"]},{key:"DLO1_SAMEB",label:"DLO1 Same B",count:["SameB"],dlo1b:true,filiali:["DLO1"]},{key:"DLO1_MM_SAMEB",label:"DLO1 MM Same B",count:["MMB"],dlo1b:true,filiali:["DLO1"]},{key:"SAMEAE",label:"SAME AE",count:["SameAE"],minOf:["SAMEA","SAMEE"],filiali:[]},{key:"SAMEA",label:"SAME A",count:["SameA","SameAE"],filiali:[]},{key:"SAMEE",label:"SAME E",count:["SameE","SameAE"],filiali:[]},{key:"SAMEBC",label:"SAME BC",count:["SameBC"],minOf:["SAMEB","SAMEC"],filiali:[]},{key:"SAMEB",label:"SAME B",count:["SameB","SameBC"],filiali:[]},{key:"SAMEC",label:"SAME C",count:["SameC","SameBC"],filiali:[]},{key:"MM_SAMEAE",label:"MM Same AE",count:["MMAE"],minOf:["MM_SAMEA","MM_SAMEE"],filiali:[]},{key:"MM_SAMEA",label:"MM Same A",count:["MMA","MMAE"],filiali:[]},{key:"MM_SAMEE",label:"MM Same E",count:["MME","MMAE"],filiali:[]},{key:"MM_SAMEBC",label:"MM Same BC",count:["MMBC"],minOf:["MM_SAMEB","MM_SAMEC"],filiali:[]},{key:"MM_SAMEB",label:"MM Same B",count:["MMB","MMBC"],filiali:[]},{key:"MM_SAMEC",label:"MM Same C",count:["MMC","MMBC"],filiali:[]}];
const DEF_COUNTERS={next:["X","L1","L2","L3","LAVORA","XN","EXTRA","CT"],unavail:["M","I","AI","PT","F","UFFICIO","ROL","TNT","MILKMAN","NAVETTA","PS","104","LUTTO","ASP","DS","SOSPESO","PR","EXF","CI","MATR","FLEET","OFF","CONG","SCIOPERO"],sick:["M","I"]};
const DEF_FILIALI=["DLO1","DLO7"];
const COUNTER_META=[{key:"next",label:"Totale rotte NEXT",hint:"Codici contati come rotta NEXT consegnata."},{key:"unavail",label:"DAS non disponibili",hint:"Codici che rendono il DAS non disponibile."},{key:"sick",label:"Malattia / Infortunio",hint:"Codici conteggiati come malattia o infortunio."}];
const SERVICE_TYPES=["NEXT","SAME A","SAME E","SAME AE","SAME B","SAME C","MM","MM SAME A","MM SAME B","WALKER","NAVETTA"];
const SERVICE_DEFAULT_CODE={"NEXT":"X","SAME A":"SameA","SAME E":"SameE","SAME AE":"SameAE","SAME B":"SameB","SAME C":"SameC","MM":"MM","MM SAME A":"MMA","MM SAME B":"MMB","WALKER":"XW","NAVETTA":"NAVETTA"};
const DEF_STYPES=SERVICE_TYPES.map(n=>({name:n,defaultCode:SERVICE_DEFAULT_CODE[n]||"X"}));
const WEEKDAYS=[{n:1,l:"Lun"},{n:2,l:"Mar"},{n:3,l:"Mer"},{n:4,l:"Gio"},{n:5,l:"Ven"},{n:6,l:"Sab"},{n:0,l:"Dom"}];
function defaultConfig(){return JSON.parse(JSON.stringify({groups:DEF_GROUPS,codes:DEF_CODES,contracts:DEF_CONTRACTS,services:DEF_SERVICES,counters:DEF_COUNTERS,filiali:DEF_FILIALI,users:[],serviceTypes:DEF_STYPES,filDetails:{},autoGen:false,customCounters:[]}));}

/* ---------- STATO ---------- */
let YM="2026-06",state=null,covMode="delta",pkCtx=null,drvEditId=null,ROLE="team",cfgEditId=null,cfgTab="filiali",planMode="week",weekIdx=0,teamFiliale=null,ewText="",teamLocked=false,currentUser=null,cameFromLegQuick=false,anText="",gridDrivers=[],gridDays=[],cellNav=false,showFcDelta=false,covRange="week",covWeekIdx=0,gridRefDay=1;
const lsKey=m=>"turniDSP_"+m;
const CFG=()=>state.config;
const daysInMonth=m=>{const[y,mo]=m.split("-").map(Number);return new Date(y,mo,0).getDate();};
const dowName=(m,d)=>["dom","lun","mar","mer","gio","ven","sab"][new Date(m+"-"+String(d).padStart(2,"0")).getDay()];
const dow=(m,d)=>new Date(m+"-"+String(d).padStart(2,"0")).getDay();
const isWend=(m,d)=>{const g=dow(m,d);return g===0||g===6;};
const isoWeek=(m,d)=>{const dt=new Date(m+"-"+String(d).padStart(2,"0"));const t=new Date(dt);t.setDate(t.getDate()+4-(t.getDay()||7));const y0=new Date(t.getFullYear(),0,1);return Math.ceil((((t-y0)/864e5)+1)/7);};
function monthWeeks(){const days=daysInMonth(YM),map={},order=[];for(let d=1;d<=days;d++){const w=isoWeek(YM,d);if(!(w in map)){map[w]=[];order.push(w);}map[w].push(d);}return order.map(w=>({week:w,days:map[w]}));}
/* Sunday→Saturday week that a given day belongs to, clamped to the month.
   `start` is the group key (day-of-month of its Sunday, or 1 at the month
   boundary); `label` is the ISO week of the group's Saturday, which is the
   number the source spreadsheet uses (1–4 Jul 2026 → W27, 5–11 Jul → W28). */
function sunWeek(m,d){const g=dow(m,d),total=daysInMonth(m);const start=Math.max(1,d-g),end=Math.min(total,d+(6-g));return{start:start,end:end,label:isoWeek(m,end)};}
function blankState(){return{meta:{month:YM,app:"TurniDSP",v:4,adminPin:localStorage.getItem("turniDSP_pin")||"1234"},drivers:[],schedule:{},forecast:{},config:loadGlobalConfig()};}
function loadGlobalConfig(){
  // Try localStorage cache first (config rarely changes between sessions)
  const g=localStorage.getItem('turniDSP_config');
  if(g){try{const c=JSON.parse(g);if(!c.filiali)c.filiali=DEF_FILIALI.slice();return c;}catch(e){}}
  return defaultConfig();
}
async function loadConfigFromDB(branch){
  try{
    const data=await TurniApi.schedulerConfig(branch||'DLO1');
    if(data&&data.config){
      Object.assign(state.config,data.config);
      localStorage.setItem('turniDSP_config',JSON.stringify(state.config));
    }
  }catch(e){console.warn('[config]',e.message);}
}
function saveConfig(){
  localStorage.setItem('turniDSP_config',JSON.stringify(state.config));
  // Also persist to DB in background
  if(DB_SYNC&&state.config&&teamFiliale){
    const branch=teamFiliale||(filiali()[0]||'DLO1');
    TurniApi.schedulerImportConfig(branch,state.config).catch(e=>console.warn('[cfg save]',e.message));
  }
  dirty();
}
const filiali=()=>CFG().filiali||[];
function filDetail(f){if(!CFG().filDetails)CFG().filDetails={};const dt=CFG().filDetails[f]||(CFG().filDetails[f]={park:"",addr:"",conv:""});if(!Array.isArray(dt.parks)){dt.parks=[];if(dt.park||dt.addr||dt.conv)dt.parks.push({name:dt.park||"Parcheggio",addr:dt.addr||"",time:dt.conv||""});}return dt;}
function allParkNames(){const s=new Set();filiali().forEach(f=>filDetail(f).parks.forEach(p=>{if(p.name)s.add(p.name);}));return[...s];}
const users=()=>{if(!CFG().users)CFG().users=[];return CFG().users;};
const contracts=()=>CFG().contracts;
const services=()=>CFG().services;
const serviceTypes=()=>{if(!CFG().serviceTypes)CFG().serviceTypes=JSON.parse(JSON.stringify(DEF_STYPES));return CFG().serviceTypes;};
const stypeNames=()=>serviceTypes().map(s=>s.name);
function defCode(name){const t=serviceTypes().find(s=>s.name===name);return t?t.defaultCode:(SERVICE_DEFAULT_CODE[name]||"X");}
function svcInFiliale(s,fil){return !fil||!s.filiali||!s.filiali.length||s.filiali.includes(fil);}
function currentAccount(){return teamLocked&&currentUser?users().find(u=>u.username===currentUser):null;}
function acctFiliali(){const a=currentAccount();return a&&a.filiali&&a.filiali.length?a.filiali:filiali();}
function scopeServices(){if(isAdmin()){var ui=(typeof _msArr==='function')?_msArr('fFiliale'):[];if(ui.length)return services().filter(s=>ui.some(f=>svcInFiliale(s,f)));return services().filter(s=>svcInFiliale(s,window._covFil||""));}const acc=currentAccount();let list=services().filter(s=>svcInFiliale(s,teamFiliale));if(acc&&acc.services&&acc.services.length)list=list.filter(s=>acc.services.includes(s.key));return list;}

/* ---------- seed ---------- */
const SEED_DRIVERS=[{id:1,cognome:"Abbas",nome:"Tahir Muhammad",filiale:"DLO7",service:"SAME B",contratto:"13",ctrType:"determinato",expiry:"2026-09-30",workDays:[1,3,4,5,6],defaultCode:"SameB",status:"active"},{id:2,cognome:"Abdelaziz",nome:"Karim",filiale:"DLO7",service:"SAME A",contratto:"PTO 24h",ctrType:"indeterminato",expiry:null,workDays:[1,3,4,5],defaultCode:"SameAE",status:"active"},{id:3,cognome:"Aboud",nome:"Ahmed",filiale:"DLO1",service:"MM",contratto:"13",ctrType:"determinato",expiry:"2026-07-15",workDays:[1,2,3,4,5],defaultCode:"MM",status:"active"},{id:4,cognome:"Zorila",nome:"Alex",filiale:"DLO7",service:"SAME B",contratto:"PTO 26h",ctrType:"indeterminato",expiry:null,workDays:[2,3,4,5],defaultCode:"SameBC",status:"active"}];
const SEED_SCHED={1:["SameB","","SameB","SameB","SameB","SameB","SameB","OFF","SameB","SameB","SameBC","","SameBC","SameBC","","","","SameBC","","SameBC","SameBC","","","","SameBC","","SameBC","SameBC","",""],2:["SameAE","","SameAE","SameAE","SameAE","","","SameAE","SameAE","SameA","SameAE","SameA","","","SameA","","SameA","SameA","SameA","SameA","SameA","SameA","","SameA","SameA","SameA","SameA","SameA","SameA",""],3:["MMA","MM","MM","MM","OFF","OFF","SameAE","MMA","","MMA","MM","OFF","","","MM","","MM","MM","","","","MM","","MM","MM","","","","MM",""],4:["","M","M","M","M","","","","M","M","M","M","OFF","","","SameBC","SameBC","SameBC","SameBC","","","","SameBC","SameBC","SameBC","SameBC","","","","SameBC"]};
const SEED_FC={"DLO1_NEXT":[22,32,40,42,42,25,13,29,24,27,26,24,21,14,26,22,28,27,28,22,11,27,19,37,41,36,26,26,62,51],"DLO1_MM_NEXT":[22,22,22,22,22,7,7,22,22,22,22,22,7,7,22,22,22,22,22,7,7,22,22,22,22,22,7,7,22,22],"DLO1_SAMEB":[3,0,3,3,3,0,0,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"DLO1_MM_SAMEB":[10,0,10,10,10,0,0,10,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"SAMEA":[43,28,45,45,45,23,16,46,40,44,33,47,19,17,43,41,42,34,47,19,17,49,43,55,55,55,35,25,56,50],"SAMEE":[35,25,35,35,35,21,18,34,34,33,34,30,15,18,33,35,33,33,31,15,28,34,41,37,50,50,20,29,38,39],"SAMEB":[25,15,25,25,25,13,11,22,22,22,22,22,5,7,18,21,20,18,22,4,8,21,25,25,25,25,5,12,20,21],"SAMEC":[25,15,25,25,25,13,11,22,9,9,8,9,1,3,10,10,10,9,10,1,4,10,12,11,11,11,5,14,20,21],"MM_SAMEA":[15,15,15,15,15,10,10,15,15,15,15,15,10,10,15,15,15,15,15,10,10,15,15,15,15,15,10,10,15,15],"MM_SAMEE":[9,9,9,9,9,7,7,9,9,9,9,9,7,7,9,9,9,9,9,7,7,9,9,9,9,9,7,7,9,9],"MM_SAMEB":[10,0,10,10,10,0,0,10,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7],"MM_SAMEC":[10,0,10,10,10,0,0,10,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7]};

// Effective scheduler branch (spec §17): admins pick it from the header
// "Tutte le filiali" dropdown ('' = all branches); non-admins are scoped.
function schedBranch(){
  if(typeof isAdmin==='function'&&!isAdmin())return teamFiliale||filiali()[0]||'DLO1';
  const el=document.getElementById('branchSel');
  return el?String(el.value||''):'';
}
function loadMonth(){
  // DB-FIRST: when authenticated, PostgreSQL is the source of truth.
  // localStorage is kept only as an offline / loading-skeleton fallback.
  if(DB_SYNC){
    const raw=localStorage.getItem(lsKey(YM));
    if(raw){try{state=JSON.parse(raw);migrate();}catch(e){state=blankState();}}
    else{state=blankState();}
    showLoadingOverlay(true);
    const br=schedBranch();
    loadMonthFromDB(YM,br).then(ok=>{
      showLoadingOverlay(false);
      if(ok){migrate();refreshAll();}
      else{
        // DB failed: fall back to localStorage data already in state
        if(!state.drivers||!state.drivers.length){
          if(YM==='2026-06'){state.drivers=JSON.parse(JSON.stringify(SEED_DRIVERS));for(const[id,arr]of Object.entries(SEED_SCHED)){state.schedule[id]={};arr.forEach((c,i)=>{if(c)state.schedule[id][i+1]=c;});}for(const[k,arr]of Object.entries(SEED_FC)){state.forecast[k]={};arr.forEach((v,i)=>state.forecast[k][i+1]=v);}}
        }
        migrate();refreshAll();
        toast('Database non raggiungibile — dati locali','warn');
      }
    });
    return;
  }
  // OFFLINE: no JWT auth, use localStorage as sole source
  const raw=localStorage.getItem(lsKey(YM));
  if(raw){try{state=JSON.parse(raw);migrate();return;}catch(e){}}
  state=blankState();
  if(YM==='2026-06'){state.drivers=JSON.parse(JSON.stringify(SEED_DRIVERS));for(const[id,arr]of Object.entries(SEED_SCHED)){state.schedule[id]={};arr.forEach((c,i)=>{if(c)state.schedule[id][i+1]=c;});}for(const[k,arr]of Object.entries(SEED_FC)){state.forecast[k]={};arr.forEach((v,i)=>state.forecast[k][i+1]=v);}}
  saveAll();
}
function migrate(){if(!state.meta)state.meta={};if(!state.log)state.log=[];if(!state.config)state.config=loadGlobalConfig();if(!state.config.filDetails)state.config.filDetails={};["groups","codes","contracts","services","counters","filiali","users","serviceTypes","customCounters"].forEach(k=>{if(!state.config[k])state.config[k]=defaultConfig()[k];});state.config.services.forEach(s=>{if(!Array.isArray(s.filiali))s.filiali=[];});(state.config.users||[]).forEach(u=>{if(!Array.isArray(u.filiali))u.filiali=u.filiale?[u.filiale]:(filiali().length?[filiali()[0]]:[]);});state.drivers.forEach(d=>{if(!d.status)d.status="active";if(!("ctrType"in d))d.ctrType="indeterminato";if(!("expiry"in d))d.expiry=null;if(!Array.isArray(d.workDays))d.workDays=(contracts().find(c=>c.code===d.contratto)||{}).defDays||[1,2,3,4,5];if(!d.defaultCode)d.defaultCode=defCode(d.service);if(!d.filiale)d.filiale=filiali()[0]||"DLO1";if(!("transporterId"in d))d.transporterId="";if(!("device"in d))d.device="";if(!("hireDate"in d))d.hireDate="";});}
/* ---- DB sync (write-through: localStorage cache + async DB save) ---- */
const DB_SYNC=!!(typeof TurniApi!=="undefined"&&TurniApi.isLoggedIn&&TurniApi.isLoggedIn());let dbSyncTimer=null;
async function loadMonthFromDB(ym,branch){try{const data=await TurniApi.schedulerMonth(ym,branch);if(data&&data.meta&&data.meta.source==="postgresql"){if(Array.isArray(data.drivers))state.drivers=data.drivers.map(d=>({id:d.id,cognome:d.cognome,nome:d.nome,filiale:d.filiale,service:d.service,contratto:d.contratto,ctrType:d.ctr_type||"indeterminato",expiry:d.expiry_date?String(d.expiry_date).slice(0,10):null,workDays:d.work_days||[1,2,3,4,5],defaultCode:d.default_code,status:d.status,transporterId:d.transporter_id||"",device:d.device||"",hireDate:d.hire_date||""}));if(data.schedule)state.schedule=data.schedule;window._cellMetaDB=data.scheduleMeta||{};if(data.forecast&&Object.keys(data.forecast).length)state.forecast=data.forecast;if(data.config&&Object.keys(data.config).length)state.config=Object.assign(state.config||{},data.config);sanitizeExpiredOff();localStorage.setItem(lsKey(YM),JSON.stringify(state));return true;}}catch(e){console.warn("[scheduler] DB load:",e.message);}return false;}
// Refetch the roster from the employees-backed month endpoint (spec §14) so
// employee create/edit/delete reflect in the scheduler without a page refresh.
window.syncSchedulerFromDB=async function(){try{if(typeof state==="undefined"||!state)return;const br=teamFiliale||(filiali()[0]||"DLO1");await loadMonthFromDB(YM,br);if(typeof refreshAll==="function")refreshAll();}catch(e){}};
async function saveMonthToDB(){if(!DB_SYNC)return;const branch=schedBranch()||filiali()[0]||"DLO1";try{const ci=[];for(const[rawId,days]of Object.entries(state.schedule||{})){const d=state.drivers.find(x=>String(x.id)===String(rawId));for(const[day,code]of Object.entries(days||{})){if(code)ci.push({employee_id:d?d.id:+rawId,day:+day,shift_code:code,branch_code:(d&&d.filiale)||branch});}}const fi=[];for(const[svcKey,days]of Object.entries(state.forecast||{})){for(const[day,qty]of Object.entries(days||{})){fi.push({service_key:svcKey,day:+day,qty:+qty||0});}}await Promise.all([ci.length?TurniApi.schedulerBulkEntries(YM,branch,ci):Promise.resolve(),fi.length?TurniApi.schedulerBulkForecasts(YM,branch,fi):Promise.resolve()]);_schedMarkSaved();}catch(e){console.warn("[DB]",e.message);const el=document.getElementById("saveState");if(el)el.textContent="locale (DB offline)";}}
let saveTimer=null;
function saveAll(manual){
  // Write to localStorage as offline cache
  localStorage.setItem(lsKey(YM),JSON.stringify(state));
  const ts=new Date().toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'});
  const el=document.getElementById('saveState');
  if(el) el.textContent='salvato '+ts+(DB_SYNC?' ↑DB':' (locale)');
  if(manual) toast(DB_SYNC?'Salvato in database':'Dati salvati in locale');
  if(DB_SYNC){clearTimeout(dbSyncTimer);dbSyncTimer=setTimeout(saveMonthToDB,1200);}
  // SHARED STATE: immediately refresh the dashboard overview strip
  // so KPI cards always match the live scheduler data (requirement #9)
  if(typeof refreshOverview==='function' && document.getElementById('kpiGrid')){
    clearTimeout(window._overviewSyncTimer);
    window._overviewSyncTimer=setTimeout(()=>{ try{refreshOverview();}catch(e){} },800);
  }
}
function dirty(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>saveAll(),400);}
function actorName(){if(isAdmin())return"Admin";if(teamLocked&&currentUser)return currentUser;return"Team "+(teamFiliale||"");}
function logAction(a){if(!state.log)state.log=[];state.log.push({t:new Date().toISOString(),u:actorName(),a:a});if(state.log.length>800)state.log=state.log.slice(-800);clearTimeout(saveTimer);saveTimer=setTimeout(()=>saveAll(),400);if(document.getElementById("v-log")&&document.getElementById("v-log").classList.contains("on"))renderLog();}

/* ---- Per-cell edit tracking + explicit unsaved state (Scheduler UX #5) ----
   Client-only, session-scoped. Records who/when for cells edited in THIS
   session and which cells are not yet persisted. Reuses actorName() and the
   existing #saveState pill and per-cell marker pattern; no DB/engine change. */
var _cellEdits={};                       // _cellEdits[id][d] = {by, at} (this session)
var _cellUnsaved={};                     // _cellUnsaved["id_d"] = true (pending save)
window._cellMetaDB=window._cellMetaDB||{};  // _cellMetaDB[id][d] = {by, at(ISO)} persisted human edits from DB (/scheduler/month)
function _recordEdit(id,d){
  if(!_cellEdits[id])_cellEdits[id]={};
  _cellEdits[id][d]={by:actorName(),at:Date.now()};
  _cellUnsaved[id+"_"+d]=true;
  if(typeof markCellEdit==="function"){try{markCellEdit(id,d);}catch(e){}}
  _schedPendingBadge();
}
function _schedPendingCount(){return Object.keys(_cellUnsaved).length;}
function _schedPendingBadge(){
  var el=document.getElementById("saveState");if(!el)return;
  var n=_schedPendingCount();
  if(n>0)el.textContent="● "+n+" non salvat"+(n===1?"a":"e");
}
// Called after a successful persist: clears the unsaved flags, refreshes the
// per-cell markers and the pill. The by/when tooltip is kept for the session.
function _schedMarkSaved(){
  var ids=Object.keys(_cellUnsaved);_cellUnsaved={};
  ids.forEach(function(k){var p=k.split("_"),id=+p[0],d=+p[1];if(typeof markCellEdit==="function"){try{markCellEdit(id,d);}catch(e){}}});
  var el=document.getElementById("saveState");
  if(el)el.textContent="✓ salvato "+new Date().toLocaleTimeString("it-IT",{hour:"2-digit",minute:"2-digit"});
}
// Public accessor for the renderer: the tooltip note + saved/unsaved flag.
// A session edit (recorded this session) always wins and carries the live
// saved/unsaved state; otherwise the persisted last human editor from the DB
// snapshot is shown (always saved). Returns null when neither exists.
window._cellEditNote=function(id,d){
  var e=_cellEdits[id]&&_cellEdits[id][d];
  if(e){
    var t=new Date(e.at).toLocaleTimeString("it-IT",{hour:"2-digit",minute:"2-digit"});
    return {by:e.by,at:t,unsaved:!!_cellUnsaved[id+"_"+d]};
  }
  var m=window._cellMetaDB&&window._cellMetaDB[id]&&window._cellMetaDB[id][d];
  if(m){
    var dt=new Date(m.at),at=isNaN(dt.getTime())?String(m.at):dt.toLocaleString("it-IT",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});
    return {by:m.by,at:at,unsaved:false};
  }
  return null;
};

/* ---------- config helper ---------- */
function codeMeta(c){return CFG().codes.find(x=>x.code===c)||{code:c,label:c,cls:"abs"};}
function codeCls(c){return c?codeMeta(c).cls:"";}
function codeLabel(c){return codeMeta(c).label;}
function groupedCodes(){return CFG().groups.map(g=>({cls:g.cls,name:g.name,codes:CFG().codes.filter(c=>c.cls===g.cls).map(c=>c.code)})).filter(g=>g.codes.length);}
const groupName=cls=>(CFG().groups.find(g=>g.cls===cls)||{}).name||cls;

/* ---------- RUOLI & SCOPE ---------- */
function applyRole(){const adm=ROLE==="admin";document.body.classList.toggle("is-admin",adm);document.body.classList.toggle("is-team",!adm);var _rt=document.getElementById("roleTxt");if(_rt)_rt.textContent=adm?"Admin":(currentUser?currentUser:"Team");var _rb=document.getElementById("roleBadge");if(_rb)_rb.classList.toggle("team",!adm);var _lb=document.getElementById("loginBtn");if(_lb)_lb.textContent=(adm||teamLocked)?("Esci"+(currentUser?" ("+currentUser+")":"")):"Accedi";updateFilChip();}
const isAdmin=()=>ROLE==="admin";
function scopeFil(){return isAdmin()?null:teamFiliale;}              /* null = tutte */
function inScope(d){const s=scopeFil();return!s||d.filiale===s;}
function updateFilChip(){const b=document.getElementById("filChip"),t=document.getElementById("filChipTxt");if(t)t.textContent=teamFiliale||"—";if(b){b.title=teamLocked?"Filiale assegnata dall'Admin":"Cambia filiale";b.style.opacity=teamLocked?.85:1;}}
function ensureTeamFiliale(){if(isAdmin())return;const list=acctFiliali();if(teamLocked){if(!list.includes(teamFiliale)&&list.length)teamFiliale=list[0];updateFilChip();return;}const all=filiali();if(!teamFiliale||!all.includes(teamFiliale)){teamFiliale=localStorage.getItem("turniDSP_teamFil");if(!teamFiliale||!all.includes(teamFiliale))teamFiliale=all[0]||"DLO1";localStorage.setItem("turniDSP_teamFil",teamFiliale);}updateFilChip();}
function openFilialePick(){const list=teamLocked?acctFiliali():filiali();if(teamLocked&&list.length<=1){toast("Filiale assegnata: "+teamFiliale);return;}document.getElementById("filPickList").innerHTML=list.map(f=>"<button class='"+(f===teamFiliale?"sel":"")+"' style='background:var(--samea-bg);color:var(--samea)' onclick=\"pickFiliale('"+f+"')\">"+esc(f)+"</button>").join("");document.getElementById("filPick").classList.add("on");}
function pickFiliale(f){teamFiliale=f;localStorage.setItem("turniDSP_teamFil",f);updateFilChip();closeAll();refreshAll();toast("Filiale: "+f);}
function saveSession(){localStorage.setItem("turniDSP_session",JSON.stringify({role:ROLE,user:currentUser,filiale:teamFiliale,locked:teamLocked}));}
function clearSession(){localStorage.removeItem("turniDSP_session");}
function logout(){
  // Always leave the scheduler page on logout — never leave the user stuck
  // here in a half-reset state. If a platform token is present, revoke it
  // (best-effort, in the background) before redirecting; either way the
  // redirect always happens. Use top.location so this also works correctly
  // when the scheduler is embedded inside the dashboard's iframe — otherwise
  // only the iframe would navigate, leaving the dashboard visible behind it.
  logAction("Disconnessione");
  var pTok=localStorage.getItem("turnidsp_token");
  if(pTok && typeof TurniApi!=="undefined" && TurniApi.logout){ TurniApi.logout().catch(function(){}); }
  ROLE="team";teamLocked=false;currentUser=null;clearSession();localStorage.setItem("turniDSP_role","team");
  (window.top||window).location.replace("login.html");
}
function toggleLogin(){if(isAdmin()||teamLocked){logout();return;}document.getElementById("logUser").value="";document.getElementById("pinIn").value="";document.getElementById("login").classList.add("on");setTimeout(()=>document.getElementById("logUser").focus(),50);}
function doLogin(){
  const u=(document.getElementById("logUser").value||"").trim(),pin=document.getElementById("pinIn").value;
  if((!u||u.toLowerCase()==="admin")&&pin===(state.meta.adminPin||"1234")){ROLE="admin";teamLocked=false;currentUser="admin";localStorage.setItem("turniDSP_role","admin");saveSession();applyRole();closeAll();refreshAll();logAction("Accesso Admin");toast("Modalità Admin attiva");return;}
  const acc=users().find(x=>x.username.toLowerCase()===u.toLowerCase());
  if(acc&&acc.disabled){toast("Account disattivato");return;}if(acc&&acc.pin===pin){const af=(acc.filiali&&acc.filiali.length?acc.filiali:[acc.filiale||filiali()[0]]);ROLE="team";teamLocked=true;currentUser=acc.username;teamFiliale=af[0];localStorage.setItem("turniDSP_role","team");localStorage.setItem("turniDSP_teamFil",af[0]);saveSession();applyRole();closeAll();refreshAll();logAction("Accesso team: "+acc.username+" ("+af.join(",")+")");toast("Accesso: "+acc.username+" · "+af.join(", "));return;}
  toast("Credenziali non valide");
}
function changePin(){if(!isAdmin())return;const p=document.getElementById("pinNew").value.trim();if(!p){toast("Inserisci un PIN");return;}state.meta.adminPin=p;localStorage.setItem("turniDSP_pin",p);document.getElementById("pinNew").value="";dirty();logAction("PIN Admin aggiornato");toast("PIN aggiornato");}
function toggleAutoGen(){CFG().autoGen=document.getElementById("autoGenChk").checked;saveConfig();logAction("Auto-generazione mensile "+(CFG().autoGen?"attivata":"disattivata"));toast(CFG().autoGen?"Auto-generazione attiva":"Auto-generazione disattivata");}

/* ---------- CALCOLO ---------- */
const activeDrivers=()=>state.drivers.filter(d=>d.status==="active");
const rosterDrivers=()=>state.drivers.filter(d=>d.status==="active"||d.status==="inactive");
// baseScoped = account scope only (admin sees all branches). scopedActive layers
// the planner "Filiale" filter (fFiliale multi-select) on top, so KPIs, totals,
// forecast and coverage — everything that reads scopedActive() — honour it. The
// few all-branch consumers (DAS/Contract KPIs, auto-gen) use baseScoped().
const baseScoped=()=>activeDrivers().filter(inScope);
function _uiFilOk(d){var a=(typeof _msArr==='function')?_msArr('fFiliale'):[];return !a.length||a.indexOf(d.filiale)>=0;}
const scopedActive=()=>baseScoped().filter(_uiFilOk);
function getCode(id,d){return(state.schedule[id]||{})[d]||"";}
function dayCodes(d,drivers){return drivers.map(dr=>getCode(dr.id,d));}
function cnt(codes,list){let n=0;for(const c of codes)if(list.includes(c))n++;return n;}
function workedDays(dr,visDays){let n=0;for(const d of visDays){const c=getCode(dr.id,d);if(c&&c.toUpperCase()!=="OFF"&&c.toUpperCase()!=="NAV")n++;}return n;}
/* giorni in una sequenza di 7+ consecutivi con codice diverso da OFF (vuoto interrompe) */
function consecutiveFlag(dr){const days=daysInMonth(YM);const flag={};let run=[];const flush=()=>{if(run.length>=7)run.forEach(x=>flag[x]=1);run=[];};for(let d=1;d<=days;d++){const c=getCode(dr.id,d);if(c&&c.toUpperCase()!=="OFF")run.push(d);else flush();}flush();return flag;}
function driverHasViolation(dr){return Object.keys(consecutiveFlag(dr)).length>0;}
function footRows(drivers,visDays){const C=CFG().counters,rotte=[],disp=[],nondisp=[],mal=[];for(const d of visDays){const codes=dayCodes(d,drivers);rotte.push(cnt(codes,C.next));disp.push(codes.filter(c=>!c).length);nondisp.push(cnt(codes,C.unavail));mal.push(cnt(codes,C.sick));}return{rotte,disp,nondisp,mal};}
function harmonyOf(s,d,drivers){return cnt(dayCodes(d,drivers),s.count||[]);}
function forecastOf(s,d){if(s.minOf){const a=+((state.forecast[s.minOf[0]]||{})[d]||0),b=+((state.forecast[s.minOf[1]]||{})[d]||0);return Math.min(a,b);}return+((state.forecast[s.key]||{})[d]||0);}
function deltaOf(s,d,drivers){return harmonyOf(s,d,drivers)-forecastOf(s,d);}

/* ---------- SCADENZE ---------- */
function expiryStatus(dr){if(dr.ctrType!=="determinato"||!dr.expiry)return{cls:"ok",txt:"Indeterminato",days:null};const t=new Date();t.setHours(0,0,0,0);const days=Math.round((new Date(dr.expiry+"T00:00:00")-t)/864e5);if(days<0)return{cls:"bad",txt:"Scaduto da "+(-days)+" gg",days};if(days<=15)return{cls:"bad",txt:"Scade tra "+days+" gg",days};if(days<=60)return{cls:"warn",txt:"Scade tra "+days+" gg",days};return{cls:"ok",txt:"Scade "+fmtDate(dr.expiry),days};}
// A fixed-term (determinato) contract with an expiry date makes every day AFTER
// that date OFF automatically. Central predicate reused by render, commitCell,
// the generator, copy-week and import — so the rule is enforced everywhere with
// no duplicated logic. Empty / indeterminato / no-expiry drivers are never gated.
function afterExpiry(dr,d){if(!dr||dr.ctrType!=="determinato"||!dr.expiry)return false;var e=String(dr.expiry).slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(e))return false;var t=new Date(YM+"-"+String(d).padStart(2,"0")+"T00:00:00");return t>new Date(e+"T00:00:00");}
// Persist OFF into the STORED schedule for every post-expiry day so the saved
// state, the DB, the KPIs / forecast / SEM totals / export AND the render all
// agree — the board no longer just *paints* OFF over a stale working code.
// Idempotent: only rewrites non-OFF codes after a determinato expiry, so once
// the DB reflects OFF a reload finds nothing to change. Returns the fix count.
function sanitizeExpiredOff(){
  if(typeof state==="undefined"||!state)return 0;
  if(!state.schedule)state.schedule={};
  var n=daysInMonth(YM),fixed=0;
  (state.drivers||[]).forEach(function(dr){
    if(dr.ctrType!=="determinato"||!dr.expiry)return;
    for(var d=1;d<=n;d++){
      if(!afterExpiry(dr,d))continue;
      var c=(state.schedule[dr.id]||{})[d];
      if(c!=="OFF"){ if(!state.schedule[dr.id])state.schedule[dr.id]={}; state.schedule[dr.id][d]="OFF"; fixed++; }
    }
  });
  if(fixed&&typeof dirty==="function")dirty();   // persist the correction to DB
  return fixed;
}
const fmtDate=s=>s?s.split("-").reverse().join("/"):"";
const fmtDM=(m,d)=>String(d).padStart(2,"0")+"/"+m.split("-")[1];
const fmtFull=(m,d)=>{const[y,mo]=m.split("-");return String(d).padStart(2,"0")+"/"+mo+"/"+y;};
const DOWFULL=["Domenica","Lunedì","Martedì","Mercoledì","Giovedì","Venerdì","Sabato"];
function dowFull(m,d){const[y,mo]=m.split("-").map(Number);return DOWFULL[new Date(y,mo-1,d).getDay()];}

/* ---------- UI ---------- */
function setView(v){
  if((v==="appr"||v==="data"||v==="cfg"||v==="an"||v==="log")&&!isAdmin()){toast("Sezione riservata all'Admin");return;}
  // Toggle both .view (legacy) and .sch-view (current app.html classes)
  document.querySelectorAll(".view,.sch-view").forEach(s=>s.classList.toggle("on",s.id==="v-"+v));
  ({plan:renderGrid,cov:renderCov,das:renderDas,contr:renderContr,appr:renderAppr,cfg:renderCfg,an:renderAnalysis,log:renderLog,leg:renderLeg}[v]||(()=>{}))();
  if(v==="data"){document.getElementById("apiUrl").value=localStorage.getItem("turniDSP_api")||"";document.getElementById("autoGenChk").checked=!!CFG().autoGen;}
}
function shiftMonth(n){let[y,m]=YM.split("-").map(Number);m+=n;if(m<1){m=12;y--}if(m>12){m=1;y++}YM=y+"-"+String(m).padStart(2,"0");weekIdx=0;loadMonth();refreshAll();}
function setPlanMode(m){planMode=m;document.querySelectorAll("#planModeSeg button").forEach(b=>b.classList.toggle("on",b.dataset.pm===m));renderGrid();}
function refreshFilSelects(){
  const opts=f=>filiali().map(x=>"<option"+(x===f?" selected":"")+">"+esc(x)+"</option>").join("");
  document.getElementById("fFiliale").innerHTML="<option value=''>Tutte le filiali</option>"+filiali().map(x=>"<option>"+esc(x)+"</option>").join("");
  document.getElementById("fService").innerHTML="<option value=''>Tutti i service</option>"+stypeNames().map(s=>"<option>"+esc(s)+"</option>").join("");
  document.getElementById("aFiliale").innerHTML="<option value=''>Tutte</option>"+filiali().map(x=>"<option>"+esc(x)+"</option>").join("");
  if(!isAdmin()){document.getElementById("fFiliale").value="";document.getElementById("fFiliale").disabled=true;}else document.getElementById("fFiliale").disabled=false;
  populateSchedFilters();
  const an=document.getElementById("anFiliale");if(an)an.dataset.init="";
  const cf=document.getElementById("covFil");if(cf)cf.dataset.init="";
}
/* Each renderer targets its own view's DOM, and not every legacy view is
   fully present in the merged app.html (e.g. v-cov has no #covKpis). Running
   them unguarded meant one missing element aborted the whole refresh — which
   silently broke month navigation and ↻ Aggiorna. Isolate each step so a
   half-built view can't take the rest down. */
function _safeRender(name,fn){try{fn();}catch(e){console.warn('[refreshAll] '+name+':',e.message);}}
function refreshAll(){
  const[y,m]=YM.split("-").map(Number);
  const ml=document.getElementById("monthLabel");
  if(ml)ml.textContent=["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"][m-1]+" "+y;
  _safeRender('ensureTeamFiliale',ensureTeamFiliale);
  _safeRender('refreshFilSelects',refreshFilSelects);
  _safeRender('updateApprBadge',updateApprBadge);
  _safeRender('maybeAutoGen',maybeAutoGen);
  _safeRender('maybeOfferAuto',maybeOfferAuto);
  _safeRender('renderGrid',renderGrid);
  _safeRender('renderCov',renderCov);
  _safeRender('renderDas',renderDas);
  _safeRender('renderContr',renderContr);
  _safeRender('renderAppr',renderAppr);
  _safeRender('renderCfg',renderCfg);
  if(isAdmin())_safeRender('renderAnalysis',renderAnalysis);
  _safeRender('renderLeg',renderLeg);
}
/* The approvals badge lived in the old scheduler sub-nav, which the 5-section
   menu replaced. Guard the lookup: without this, refreshAll() throws here and
   every caller (↻ Aggiorna, shiftMonth, loadMonth) dies half-way. */
function updateApprBadge(){const b=document.getElementById("apprBadge");if(!b)return;const n=state.drivers.filter(d=>d.status==="pending").length;b.textContent=n;b.style.display=n?"inline-block":"none";}

function dayStatus(dr,d){const c=getCode(dr.id,d);if(!c)return"dispo";if(c.toUpperCase()==="OFF")return"riposo";if(codeCls(c)==="mal")return"assente";return"turno";}
function _fv(id){const el=document.getElementById(id);return el?(el.value||""):"";}
// Quick-search haystack (spec §7): name, surname, id, transporter/vehicle id,
// branch, route/service, contract, device.
// Search haystack: Name, Surname, Employee ID, Badge/Transporter ID, Phone,
// Branch, Service, Team, Contract, Device. Badge/phone use tolerant field names
// (the scheduler driver model may not store them yet) so search still works if
// the roster gains them — filter(Boolean) drops the absent ones.
function _drvHay(d){return [d.cognome,d.nome,d.id,d.transporterId,d.badge,d.matricola,d.phone,d.telefono,d.filiale,d.service,d.team,d.contratto,d.device].filter(Boolean).join(" ").toLowerCase();}
// Multi-select aware: reads the array chosen in the horizontal filter bar
// (window._schedMS), falling back to the hidden native <select>'s single value
// so the logic still works if the bar isn't built. Empty selection = "all".
function _msArr(key){var ms=window._schedMS;if(ms&&ms[key]&&ms[key].length)return ms[key];var el=document.getElementById(key);return (el&&el.value)?[el.value]:[];}
function _msOk(key,val){var a=_msArr(key);return !a.length||a.indexOf(val==null?"":val)>=0;}
function filteredDrivers(){
  const q=_fv("q").toLowerCase().trim();
  const terms=q?q.split(/\s+/):[];
  return scopedActive()
    .filter(d=>_msOk("fFiliale",d.filiale))
    .filter(d=>_msOk("fService",d.service))
    .filter(d=>_msOk("fContract",d.contratto||""))
    .filter(d=>_msOk("fTeam",d.team||""))
    .filter(d=>_msOk("fManager",d.manager||d.osm||""))
    .filter(d=>_msOk("fStato",dayStatus(d,gridRefDay)))
    .filter(d=>{if(!terms.length)return true;const h=_drvHay(d);return terms.every(t=>h.includes(t));})
    // Excel-style column AutoFilters (AND). Day columns + Employee + Week + SEM.
    .filter(d=>typeof colFilterMatch!=="function"||colFilterMatch(d.id))
    .filter(d=>typeof empFilterMatch!=="function"||empFilterMatch(d.id))
    .filter(d=>typeof weekFilterMatch!=="function"||weekFilterMatch(d.id))
    .filter(d=>typeof semFilterMatch!=="function"||semFilterMatch(d))
    .sort((a,b)=>a.cognome.localeCompare(b.cognome));
}
function maybeOfferAuto(){const b=document.getElementById("autoBanner");if(!b)return;const _ms=baseScoped();const empty=_ms.every(d=>!state.schedule[d.id]||Object.keys(state.schedule[d.id]).length===0);if(_ms.length&&empty){b.style.display="flex";b.innerHTML="<b>Turni del mese vuoti.</b><span class='grow'>Generare automaticamente in base ai contratti dei DAS?</span><button class='btn amber' onclick='openAuto()'>Genera ora</button>";}else b.style.display="none";}

function renderGrid(){
  const allDays=[];for(let d=1;d<=daysInMonth(YM);d++)allDays.push(d);
  const weeks=monthWeeks();if(weekIdx>=weeks.length)weekIdx=weeks.length-1;if(weekIdx<0)weekIdx=0;
  const visDays=planMode==="week"?(weeks[weekIdx]?weeks[weekIdx].days:allDays):allDays;
  /* week nav + scope label */
  const wn=document.getElementById("weekNav");
  if(planMode==="week"&&weeks.length){const w=weeks[weekIdx];wn.style.display="inline-flex";wn.innerHTML="<button onclick='prevWeek()'>‹</button><span>Week "+w.week+" · "+fmtDM(YM,w.days[0])+"–"+fmtDM(YM,w.days[w.days.length-1])+"</span><button onclick='nextWeek()'>›</button>";}
  else wn.style.display="none";
  document.getElementById("planScope").textContent=isAdmin()?"tutte le filiali":("filiale "+(teamFiliale||""));
  const _td=new Date();gridRefDay=(_td.toISOString().slice(0,7)===YM&&visDays.includes(_td.getDate()))?_td.getDate():visDays[0];
  const stSel=(document.getElementById("fStato")||{}).value||"";
  document.getElementById("planScope").textContent=(isAdmin()?"tutte le filiali":("filiale "+(teamFiliale||"")))+(stSel?" · stato del "+fmtDM(YM,gridRefDay):"");
  const drivers=filteredDrivers(),all=scopedActive(),f=footRows(all,visDays),today=new Date(),tIso=today.toISOString().slice(0,7),tDay=today.getDate();
  gridDrivers=drivers;gridDays=visDays;refreshCodeList();
  const heat={};const _hs=scopeServices();for(const d of visDays){let neg=0;for(const s of _hs){const dl=deltaOf(s,d,all);if(dl<0)neg+=dl;}heat[d]=neg;}
  const minNeg=Math.min(...Object.values(heat),-1);
  /* Header on three separate rows — settimana / data / giorno — mirroring the
     source spreadsheet (WEEK 28 · 05/07 · Dom) instead of cramming the weekday
     and the day number into one cell. Weeks run Sunday→Saturday, same as the
     forecast editor and the original file. */
  let h="<thead>";
  /* 1) settimana */
  h+="<tr class='weeks'><th class='stick c-n'></th><th class='stick c-name'></th>";
  {let curKey=null;for(const d of visDays){const wm=sunWeek(YM,d);if(wm.start!==curKey){let span=0;for(const k of visDays)if(sunWeek(YM,k).start===wm.start)span++;h+="<th colspan='"+span+"'>SETT. "+wm.label+"</th>";curKey=wm.start;}}}
  h+="<th></th><th></th></tr>";
  /* 2) data */
  h+="<tr class='dates'><th class='stick c-n'>#</th><th class='stick c-name'>DAS</th>";
  for(const d of visDays){const cls=[isWend(YM,d)?"wend":"",(tIso===YM&&d===tDay)?"today":""].join(" ");h+="<th class='day "+cls+"'>"+fmtDM(YM,d)+"</th>";}
  h+="<th class='day'>"+(planMode==="week"?"SETT.":"TOT")+"</th><th class='day'>CONTR.</th></tr>";
  /* 3) giorno (+ barra delta) */
  h+="<tr class='dows'><th class='stick c-n'></th><th class='stick c-name'></th>";
  for(const d of visDays){const cls=[isWend(YM,d)?"wend":"",(tIso===YM&&d===tDay)?"today":""].join(" "),pct=heat[d]<0?Math.min(1,heat[d]/minNeg):0,col=heat[d]<0?"var(--bad)":"var(--ok)";h+="<th class='day "+cls+"'><span class='dow'>"+dowName(YM,d)+"</span><span class='heat' title='Delta giorno: "+heat[d]+"' style='background:linear-gradient(90deg,"+col+" "+Math.round(pct*100)+"%,var(--line) 0)'></span></th>";}
  h+="<th></th><th></th></tr></thead><tbody>";
  if(!drivers.length){h+="<tr class='empty'><td colspan='"+(visDays.length+4)+"'>Nessun DAS"+(scopeFil()?" per la filiale "+esc(scopeFil()):"")+". Aggiungilo da Anagrafica DAS o importalo.</td></tr>";}
  drivers.forEach((dr,i)=>{const vflag=consecutiveFlag(dr),viol=Object.keys(vflag).length>0;h+="<tr><td class='stick c-n'>"+(i+1)+"</td><td class='stick c-name'>"+(viol?"<span title='7+ giorni consecutivi senza riposo' style='color:var(--bad)'>⚠️ </span>":"")+esc(dr.cognome)+" "+esc(dr.nome)+"<small>"+esc(dr.filiale)+" · "+esc(dr.service)+"</small></td>";for(const d of visDays){const c=getCode(dr.id,d),cls=codeCls(c);h+="<td id='c_"+dr.id+"_"+d+"' class='cell "+(isWend(YM,d)?"wend":"")+(vflag[d]?" viol":"")+"' onclick='openCellEdit("+dr.id+","+d+")' ondblclick='openPicker("+dr.id+","+d+")'>"+(c?"<span class='chip' style='background:var(--"+cls+"-bg);color:var(--"+cls+")'>"+esc(c)+"</span>":"")+"</td>";}h+="<td class='c-tot'>"+workedDays(dr,visDays)+"</td><td class='c-ctr'>"+esc(dr.contratto||"")+"</td></tr>";});
  const foot=(lbl,arr,neg)=>{let r="<tr class='foot'><td class='stick c-n'></td><td class='stick lbl'>"+lbl+"</td>";arr.forEach(v=>{r+="<td class='"+(neg&&v>0?"neg":"")+"'>"+v+"</td>";});return r+"<td>"+arr.reduce((a,b)=>a+b,0)+"</td><td></td></tr>";};
  h+=foot("Totale rotte NEXT",f.rotte)+foot("DAS disponibili",f.disp)+foot("DAS non disponibili",f.nondisp,true)+foot("Malattia / Infortunio",f.mal,true);
  for(const c of customCounters()){const arr=visDays.map(d=>cnt(dayCodes(d,all),c.codes));h+=foot(esc(c.label),arr);}
  if(showFcDelta){const svs=scopeServices();
    h+="<tr class='foot'><td class='stick c-n'></td><td class='stick lbl' style='background:var(--ink);color:#fff'>FORECAST</td>"+visDays.map(()=>"<td style='background:var(--ink)'></td>").join("")+"<td style='background:var(--ink)'></td><td style='background:var(--ink)'></td></tr>";
    for(const s of svs){let tot=0;let r="<tr class='foot'><td class='stick c-n'></td><td class='stick lbl'>"+esc(s.label)+"</td>";for(const d of visDays){const v=forecastOf(s,d);tot+=v;r+="<td>"+(v||"")+"</td>";}h+=r+"<td>"+tot+"</td><td></td></tr>";}
    h+="<tr class='foot'><td class='stick c-n'></td><td class='stick lbl' style='background:var(--ink);color:#fff'>DELTA</td>"+visDays.map(()=>"<td style='background:var(--ink)'></td>").join("")+"<td style='background:var(--ink)'></td><td style='background:var(--ink)'></td></tr>";
    for(const s of svs){let tot=0;let r="<tr class='foot'><td class='stick c-n'></td><td class='stick lbl'>"+esc(s.label)+"</td>";for(const d of visDays){const v=deltaOf(s,d,all);tot+=v;r+="<td style='"+(v<0?"color:var(--bad)":v>0?"color:var(--ok)":"color:var(--muted)")+"'>"+v+"</td>";}h+=r+"<td>"+tot+"</td><td></td></tr>";}
  }
  h+="</tbody>";
  document.getElementById("grid").innerHTML=h;
  const viols=scopedActive().filter(driverHasViolation);const vb=document.getElementById("violBanner");if(vb){if(viols.length){vb.style.display="flex";vb.innerHTML="<b>⚠️ Attenzione riposi:</b><span class='grow'>"+viols.length+" DAS con 7+ giorni consecutivi senza riposo: "+viols.slice(0,6).map(d=>esc(d.cognome)).join(", ")+(viols.length>6?"…":"")+". Inserisci un OFF entro il 7º giorno.</span>";}else vb.style.display="none";}
}
function prevWeek(){if(weekIdx>0){weekIdx--;renderGrid();}}
function nextWeek(){if(weekIdx<monthWeeks().length-1){weekIdx++;renderGrid();}}

function refreshCodeList(){let dl=document.getElementById("codeList");if(!dl){dl=document.createElement("datalist");dl.id="codeList";document.body.appendChild(dl);}dl.innerHTML=CFG().codes.map(c=>"<option value='"+esc(c.code)+"'>"+esc(c.label)+"</option>").join("");}
function resolveCode(v){v=(v||"").trim();if(!v)return"";const codes=CFG().codes.map(c=>c.code);let m=codes.find(c=>c.toLowerCase()===v.toLowerCase());if(m)return m;const pre=codes.filter(c=>c.toLowerCase().startsWith(v.toLowerCase()));if(pre.length===1)return pre[0];return null;}
function commitCell(id,d,v){const r=resolveCode(v);if(r===null)return false;const dr=state.drivers.find(x=>x.id===id);
  // Contract expiry: days after the expiry date are OFF and locked. Any write
  // attempt (manual edit, paint, copy-week, import) is coerced to OFF.
  if(dr&&afterExpiry(dr,d)){if(!state.schedule[id])state.schedule[id]={};if(state.schedule[id][d]!=="OFF"){state.schedule[id][d]="OFF";dirty();_recordEdit(id,d);}return true;}
  // Absence codes follow contract working days on manual entry (paint / brush /
  // inline edit / drag). An absence code (Ferie/Malattia/Permesso/Infortunio/
  // ROL/… — class 'mal') lands only on the employee's contract working days; on
  // a non-working (rest) day it becomes OFF instead — rest days are never given
  // an absence code. Mirrors the server absence rule for board-entered sickness.
  if(dr&&r&&typeof codeCls==="function"&&codeCls(r)==="mal"){
    var _g=new Date(YM+"-"+String(d).padStart(2,"0")+"T00:00:00").getDay();
    var _work=Array.isArray(dr.workDays)&&(dr.workDays.indexOf(_g)>=0||(_g===0&&dr.workDays.indexOf(7)>=0));
    if(!_work){
      if(!state.schedule[id])state.schedule[id]={};
      if(state.schedule[id][d]!=="OFF"){state.schedule[id][d]="OFF";dirty();_recordEdit(id,d);logAction("Riposo (giorno non lavorativo) "+(dr?dr.cognome+" "+dr.nome:id)+" "+fmtDM(YM,d));}
      return true;
    }
  }
  const old=getCode(id,d);if(r===old)return true;if(!state.schedule[id])state.schedule[id]={};if(r)state.schedule[id][d]=r;else delete state.schedule[id][d];dirty();_recordEdit(id,d);logAction("Turno "+(dr?dr.cognome+" "+dr.nome:id)+" "+fmtDM(YM,d)+": "+(r||"vuoto"));if(dr&&driverHasViolation(dr))toast("⚠️ "+dr.cognome+": 7+ giorni consecutivi senza riposo");return true;}
function nextCell(id,d,dir){const di=gridDrivers.findIndex(x=>x.id===id),wi=gridDays.indexOf(d);if(dir==="down"&&di+1<gridDrivers.length)return[gridDrivers[di+1].id,d];if(dir==="up"&&di>0)return[gridDrivers[di-1].id,d];if(dir==="right"){if(wi+1<gridDays.length)return[id,gridDays[wi+1]];if(di+1<gridDrivers.length)return[gridDrivers[di+1].id,gridDays[0]];}if(dir==="left"){if(wi>0)return[id,gridDays[wi-1]];if(di>0)return[gridDrivers[di-1].id,gridDays[gridDays.length-1]];}return null;}
function openCellEdit(id,d){const td=document.getElementById("c_"+id+"_"+d);if(!td)return;const cur=getCode(id,d);td.innerHTML="<div class='cellEdit'><input class='cellInp' list='codeList' value=\""+esc(cur)+"\" autocomplete='off' autocapitalize='off' spellcheck='false'><button class='cellPick' tabindex='-1' onmousedown='event.preventDefault();pickerFromEdit("+id+","+d+")'>▾</button></div>";const inp=td.querySelector(".cellInp");inp.focus();inp.select();
  inp.addEventListener("keydown",e=>cellKey(e,id,d));
  inp.addEventListener("blur",()=>{if(cellNav)return;if(!commitCell(id,d,inp.value)){toast("Codice non valido: "+inp.value);}renderGrid();});}
function cellKey(e,id,d){const inp=e.target;const go=dir=>{cellNav=true;const ok=commitCell(id,d,inp.value);if(!ok){cellNav=false;toast("Codice non valido");inp.focus();inp.select();return;}const nx=nextCell(id,d,dir);renderGrid();if(nx)openCellEdit(nx[0],nx[1]);setTimeout(()=>cellNav=false,0);};
  if(e.key==="Enter"){e.preventDefault();go("down");}
  else if(e.key==="Tab"){e.preventDefault();go(e.shiftKey?"left":"right");}
  else if(e.key==="ArrowDown"){e.preventDefault();go("down");}
  else if(e.key==="ArrowUp"){e.preventDefault();go("up");}
  else if(e.key==="Escape"){e.preventDefault();cellNav=true;renderGrid();setTimeout(()=>cellNav=false,0);}}
function pickerFromEdit(id,d){cellNav=true;renderGrid();setTimeout(()=>cellNav=false,0);openPicker(id,d);}
function openPicker(id,d){pkCtx={id,d};const dr=state.drivers.find(x=>x.id===id);document.getElementById("pkTitle").textContent=dr.cognome+" "+dr.nome;document.getElementById("pkSub").textContent=dowName(YM,d)+" "+d+" · attuale: "+(getCode(id,d)||"disponibile");const cur=getCode(id,d);let h="";for(const g of groupedCodes()){h+="<div class='codegrp'><h4>"+esc(g.name)+"</h4><div class='codegrid'>";for(const c of g.codes)h+="<button class='"+(c===cur?"sel":"")+"' style='background:var(--"+g.cls+"-bg);color:var(--"+g.cls+")' onclick=\"setCell('"+c+"')\">"+esc(c)+"<br><small style='font-weight:400'>"+esc(codeLabel(c))+"</small></button>";h+="</div></div>";}document.getElementById("pkBody").innerHTML=h;document.getElementById("picker").classList.add("on");}
function setCell(code){const{id,d}=pkCtx;const dr=state.drivers.find(x=>x.id===id);if(!state.schedule[id])state.schedule[id]={};if(code)state.schedule[id][d]=code;else delete state.schedule[id][d];dirty();logAction("Turno "+(dr?dr.cognome+" "+dr.nome:id)+" "+fmtDM(YM,d)+": "+(code||"vuoto"));if(dr&&driverHasViolation(dr))toast("⚠️ "+dr.cognome+": 7+ giorni consecutivi senza riposo");closeAll();renderGrid();}

/* ---------- COPERTURA ---------- */
function setCovMode(m){covMode=m;document.querySelectorAll("#covMode button").forEach(b=>b.classList.toggle("on",b.dataset.m===m));renderCov();}
function onCovFil(){window._covFil=document.getElementById("covFil").value;renderCov();renderGrid();}
function setCovRange(r){covRange=r;document.querySelectorAll("#covRangeSeg button").forEach(b=>b.classList.toggle("on",b.dataset.cr===r));renderCov();}
function openHarmony(){const u=(CFG().harmonyUrl||"").trim();if(!u){toast("Imposta prima l'URL di Harmony (⚙ URL Harmony)");return;}window.open(u,"_blank");}
function setHarmonyUrl(){if(!isAdmin())return;const u=prompt("URL della pagina Harmony (Amazon) da aprire:",CFG().harmonyUrl||"https://logistics.amazon.it/");if(u===null)return;CFG().harmonyUrl=u.trim();saveConfig();logAction("URL Harmony impostato");toast("URL Harmony salvato");}
function covPrevWeek(){if(covWeekIdx>0){covWeekIdx--;renderCov();}}
function covNextWeek(){if(covWeekIdx<monthWeeks().length-1){covWeekIdx++;renderCov();}}
function renderCov(){
  if(!document.getElementById("covTbl")||!document.getElementById("covKpis"))return;
  const cf=document.getElementById("covFil");if(cf&&cf.dataset.init!=="1"){cf.innerHTML="<option value=''>Tutte le filiali</option>"+filiali().map(f=>"<option>"+esc(f)+"</option>").join("");cf.dataset.init="1";}
  const fil=isAdmin()?(window._covFil||""):teamFiliale;
  const svs=scopeServices(),weeks=monthWeeks();if(covWeekIdx>=weeks.length)covWeekIdx=weeks.length-1;if(covWeekIdx<0)covWeekIdx=0;
  // Range presets: 1 / 2 / 4 weeks starting at covWeekIdx, or the whole month.
  const nWeeks=covRange==="week"?1:covRange==="2weeks"?2:covRange==="4weeks"?4:0;
  const visWeeks=nWeeks>0?weeks.slice(covWeekIdx,covWeekIdx+nWeeks):weeks;
  const visDays=nWeeks>0?visWeeks.reduce((a,w)=>a.concat(w.days),[]):Array.from({length:daysInMonth(YM)},(_,i)=>i+1);
  const wn=document.getElementById("covWeekNav");
  if(nWeeks>0&&weeks.length>nWeeks){const f=visWeeks[0],l=visWeeks[visWeeks.length-1];wn.style.display="inline-flex";wn.innerHTML="<button onclick='covPrevWeek()'>‹</button><span>"+fmtDM(YM,f.days[0])+"–"+fmtDM(YM,l.days[l.days.length-1])+"</span><button onclick='covNextWeek()'>›</button>";}else wn.style.display="none";
  const drivers=scopedActive().filter(d=>!fil||d.filiale===fil);
  let scopTot=0,giorniCrit=0;for(const d of visDays){let neg=0;for(const s of svs){const dl=deltaOf(s,d,drivers);if(dl<0)neg+=dl;}scopTot+=neg;if(neg<0)giorniCrit++;}
  const fcTot=svs.filter(s=>!s.minOf).reduce((a,s)=>{let t=0;for(const d of visDays)t+=forecastOf(s,d);return a+t;},0);
  const lab=nWeeks===1?"settimana":nWeeks>1?(nWeeks+" settimane"):"mese";
  document.getElementById("covKpis").innerHTML=kpi(drivers.length,"DAS attivi"+(fil?" ("+fil+")":""))+kpi(fcTot,"Forecast rotte "+lab)+kpi(scopTot,"Rotte scoperte ("+lab+")")+kpi(giorniCrit,"Giorni con scoperture");
  const editable=covMode==="forecast";let h="<thead>";
  if(visWeeks.length>1){h+="<tr class='wkrow'><th></th>";for(const w of visWeeks)h+="<th colspan='"+w.days.length+"' style='background:var(--ink);color:#fff;font-size:.7rem'>WK "+w.week+"</th>";h+="<th></th></tr>";}
  h+="<tr><th style='text-align:left;min-width:150px'>Service"+(fil?" · "+esc(fil):"")+"</th>";for(const d of visDays)h+="<th>"+d+"<br><small>"+dowName(YM,d)+"</small></th>";h+="<th>TOT</th></tr></thead><tbody>";h+="<tr class='sec'><td colspan='"+(visDays.length+2)+"'>"+(covMode==="delta"?"Delta = in turno − forecast":covMode==="harmony"?"Harmony — in turno":"Forecast"+(editable?" (modificabile)":" (sola lettura)"))+" · "+lab+"</td></tr>";
  if(!svs.length)h+="<tr><td colspan='"+(visDays.length+2)+"' style='padding:14px;color:var(--muted)'>Nessun servizio assegnato"+(fil?" alla filiale "+esc(fil):"")+". Aggiungilo in ⚙ Configurazione → Servizi &amp; Forecast.</td></tr>";
  for(const s of svs){h+="<tr><td class='svc'>"+esc(s.label)+(s.minOf?" <small style='color:var(--muted)'>(auto MIN)</small>":"")+"</td>";let tot=0;for(const d of visDays){if(covMode==="forecast"){const v=forecastOf(s,d);tot+=v;h+=(s.minOf||!editable)?"<td class='d-zero'>"+v+"</td>":"<td><input type='number' min='0' value='"+v+"' onchange='setFc(\""+s.key+"\","+d+",this.value)'></td>";}else if(covMode==="harmony"){const v=harmonyOf(s,d,drivers);tot+=v;h+="<td>"+(v||"<span class='d-zero'>0</span>")+"</td>";}else{const v=deltaOf(s,d,drivers);tot+=v;h+="<td class='"+(v<0?"d-neg":v>0?"d-pos":"d-zero")+"'>"+v+"</td>";}}h+="<td><b>"+tot+"</b></td></tr>";}h+="</tbody>";document.getElementById("covTbl").innerHTML=h;}
function setFc(key,d,val){if(!state.forecast[key])state.forecast[key]={};state.forecast[key][d]=+val||0;dirty();logAction("Forecast "+key+" g"+d+" = "+(+val||0));renderCov();}
const kpi=(v,l)=>"<div class='kpi'><b>"+v+"</b><span>"+l+"</span></div>";

/* ---------- DAS ---------- */
function renderDas(){const q=(document.getElementById("qDas").value||"").toLowerCase(),list=rosterDrivers().filter(inScope).filter(d=>!q||(d.cognome+" "+d.nome).toLowerCase().includes(q)).sort((a,b)=>(a.status==="inactive"?1:0)-(b.status==="inactive"?1:0)||a.cognome.localeCompare(b.cognome));const pend=state.drivers.filter(d=>d.status==="pending"&&inScope(d)).length;const inact=rosterDrivers().filter(d=>d.status==="inactive"&&inScope(d)).length;
  const byFil=filiali().map(f=>kpi(baseScoped().filter(d=>d.filiale===f).length,f)).join("");
  document.getElementById("dasKpis").innerHTML=kpi(baseScoped().length,"DAS attivi")+(scopeFil()?"":byFil)+(inact?kpi(inact,"Inattivi"):"")+(pend?kpi(pend,"In attesa"):"");
  document.getElementById("dasList").innerHTML=list.map(dasCard).join("")||"<p class='note'>Nessun DAS"+(scopeFil()?" per la filiale "+esc(scopeFil()):"")+".</p>";}
function dasCard(d){const ctr=contracts().find(c=>c.code===d.contratto),ex=expiryStatus(d),wd=d.workDays.map(n=>(WEEKDAYS.find(w=>w.n===n)||{}).l).join(" ");const extra=(d.transporterId?" · ID: "+esc(d.transporterId):"")+(d.device?" · 📱 "+esc(d.device):"")+(d.hireDate?" · assunto "+fmtDate(d.hireDate):"");const inactive=d.status==="inactive";const stTag=inactive?"<span class='tag bad'>Inattivo</span>":"<span class='tag ok'>Attivo</span>";return "<div class='dcard'"+(inactive?" style='opacity:.6'":"")+"><div class='av'>"+esc((d.cognome[0]||"")+(d.nome[0]||""))+"</div><div style='flex:1'><div class='nm'>"+esc(d.cognome)+" "+esc(d.nome)+"</div><div class='meta'>"+esc(d.service)+" · "+esc(d.contratto||"—")+""+"<br>Giorni: "+esc(wd||"—")+" · cod. "+esc(d.defaultCode)+extra+"</div><div class='tags'><span class='tag fil'>"+esc(d.filiale)+"</span>"+stTag+"<span class='tag "+ex.cls+"'>"+ex.txt+"</span></div></div><div class='acts'><button onclick='openDriver("+d.id+")'>✏️ Modifica</button>"+(isAdmin()?"<button class='"+(inactive?"ap":"rj")+"' onclick='delDriver("+d.id+")'>"+(inactive?"↺ Riattiva":"⊘ Disattiva")+"</button>":"")+"</div></div>";}

function buildDayPicker(elId,sel){document.getElementById(elId).innerHTML=WEEKDAYS.map(w=>"<button type='button' data-d='"+w.n+"' class='"+(sel.includes(w.n)?"on":"")+"' onclick='this.classList.toggle(\"on\")'>"+w.l+"</button>").join("");}
function getDays(elId){return[...document.querySelectorAll("#"+elId+" button.on")].map(b=>+b.dataset.d);}
function fillSelect(id,opts,val){const s=document.getElementById(id);s.innerHTML=opts.map(o=>"<option"+(o===val?" selected":"")+">"+esc(o)+"</option>").join("");}
function openDriver(id){drvEditId=id;const d=id?state.drivers.find(x=>x.id===id):null;
  fillSelect("dFiliale",filiali(),d?d.filiale:(scopeFil()||filiali()[0]));
  document.getElementById("dFiliale").disabled=!isAdmin();
  fillSelect("dService",stypeNames(),d?d.service:(stypeNames()[0]||"NEXT"));
  document.getElementById("dService").disabled=!isAdmin();
  fillSelect("dContratto",contracts().map(c=>c.code),d?d.contratto:contracts()[0].code);
  fillSelect("dDefault",groupedCodes().flatMap(g=>g.codes),d?d.defaultCode:"X");
  document.getElementById("dCognome").value=d?d.cognome:"";document.getElementById("dNome").value=d?d.nome:"";
  document.getElementById("dTransporter").value=d&&d.transporterId?d.transporterId:"";document.getElementById("dDevice").value=d&&d.device?d.device:"";document.getElementById("dHire").value=d&&d.hireDate?d.hireDate:"";
  document.getElementById("dCtrType").value=d?d.ctrType:"indeterminato";document.getElementById("dExpiry").value=d&&d.expiry?d.expiry:"";document.getElementById("dAutofill").checked=true;
  buildDayPicker("dDays",d?d.workDays:(contracts()[0].defDays||[1,2,3,4,5]));toggleExpiry();
  document.getElementById("drvTitle").textContent=d?"Modifica DAS":"Nuovo DAS";
  document.getElementById("drvSub").textContent=isAdmin()?"Le modifiche sono immediate.":"La proposta sarà inviata all'Admin per approvazione.";
  document.getElementById("drvSave").textContent=isAdmin()?"Salva":(id?"Salva":"Invia per approvazione");
  document.getElementById("drv").classList.add("on");}
function toggleExpiry(){document.getElementById("expiryField").style.display=document.getElementById("dCtrType").value==="determinato"?"flex":"none";}
function onContractChange(){const c=contracts().find(x=>x.code===document.getElementById("dContratto").value);if(c&&c.defDays)buildDayPicker("dDays",c.defDays);}
function onServiceChange(){const sc=defCode(document.getElementById("dService").value);if(sc)document.getElementById("dDefault").value=sc;}
// Map a client driver object → the DB field names used by POST/PUT /scheduler/drivers.
function _drvToDb(o){return {cognome:o.cognome,nome:o.nome,filiale:o.filiale,service:o.service,contratto:o.contratto,ctr_type:o.ctrType,expiry_date:o.expiry||null,work_days:o.workDays,default_code:o.defaultCode,status:o.status,transporter_id:o.transporterId||null,device:o.device||null,hire_date:o.hireDate||null};}
async function saveDriver(){const c=document.getElementById("dCognome").value.trim();if(!c){toast("Inserisci il cognome");return;}const ctrType=document.getElementById("dCtrType").value;const fil=isAdmin()?document.getElementById("dFiliale").value:(scopeFil()||document.getElementById("dFiliale").value);
  const obj={cognome:c,nome:document.getElementById("dNome").value.trim(),filiale:fil,service:document.getElementById("dService").value,contratto:document.getElementById("dContratto").value,ctrType,expiry:ctrType==="determinato"?(document.getElementById("dExpiry").value||null):null,defaultCode:document.getElementById("dDefault").value,workDays:getDays("dDays"),transporterId:document.getElementById("dTransporter").value.trim(),device:document.getElementById("dDevice").value.trim(),hireDate:document.getElementById("dHire").value||""};
  let targetId;
  if(drvEditId){const d=state.drivers.find(x=>x.id===drvEditId);Object.assign(d,obj);targetId=d.id;logAction("DAS modificato: "+obj.cognome+" "+obj.nome);toast("DAS aggiornato");
    // Persist the single edit (no blanket roster re-import → no duplication).
    if(typeof DB_SYNC!=="undefined"&&DB_SYNC){try{await TurniApi.schedulerUpdateDriver(targetId,_drvToDb(d));}catch(e){console.warn("[DB] update driver",e.message);}}}
  else{obj.status=isAdmin()?"active":"pending";obj.addedBy=actorName();
    let created=null;
    // Create in DB first so we adopt the real DB id (schedule keys off it).
    if(typeof DB_SYNC!=="undefined"&&DB_SYNC){try{created=await TurniApi.schedulerCreateDriver(_drvToDb(obj));}catch(e){console.warn("[DB] create driver",e.message);}}
    targetId=(created&&created.id)?created.id:((state.drivers.reduce((m,d)=>Math.max(m,d.id),0)||0)+1);obj.id=targetId;state.drivers.push(obj);logAction((isAdmin()?"DAS aggiunto":"DAS proposto")+": "+obj.cognome+" "+obj.nome+" ("+obj.filiale+")");toast(isAdmin()?"DAS aggiunto al roster":"Proposta inviata: in attesa di approvazione");}
  if(document.getElementById("dAutofill").checked)autofillDriver(targetId,obj.workDays,obj.defaultCode,"OFF","empty");
  dirty();closeAll();updateApprBadge();renderDas();renderAppr();renderGrid();renderContr();}
async function delDriver(id){if(!isAdmin())return;const d=state.drivers.find(x=>x.id===id);const dis=d.status!=="inactive";if(!confirm((dis?"Disattivare":"Riattivare")+" "+d.cognome+" "+d.nome+"?"))return;d.status=dis?"inactive":"active";
  if(typeof DB_SYNC!=="undefined"&&DB_SYNC){try{await TurniApi.schedulerUpdateDriver(id,{status:d.status});}catch(e){console.warn("[DB] status",e.message);}}
  dirty();logAction("DAS "+(dis?"disattivato":"riattivato")+": "+d.cognome+" "+d.nome);updateApprBadge();renderDas();renderGrid();renderContr();}
function autofillDriver(id,workDays,code,offCode,mode){if(!Array.isArray(workDays))workDays=[];const days=daysInMonth(YM);if(!state.schedule[id])state.schedule[id]={};for(let d=1;d<=days;d++){const has=state.schedule[id][d];if(mode==="empty"&&has)continue;const cc=workDays.includes(dow(YM,d))?(code||"X"):offCode;if(cc)state.schedule[id][d]=cc;else delete state.schedule[id][d];}}

/* ---------- APPROVAZIONI ---------- */
function renderAppr(){const list=state.drivers.filter(d=>d.status==="pending");document.getElementById("apprList").innerHTML=list.length?list.map(d=>{const ctr=contracts().find(c=>c.code===d.contratto),wd=d.workDays.map(n=>(WEEKDAYS.find(w=>w.n===n)||{}).l).join(" ");return "<div class='dcard pending'><div class='av'>"+esc((d.cognome[0]||"")+(d.nome[0]||""))+"</div><div style='flex:1'><div class='nm'>"+esc(d.cognome)+" "+esc(d.nome)+" <span class='tag pend'>in attesa</span> <span class='tag fil'>"+esc(d.filiale)+"</span></div><div class='meta'>"+esc(d.service)+" · "+esc(d.contratto)+""+" · "+(d.ctrType==="determinato"?"det. "+fmtDate(d.expiry):"indet.")+"<br>Giorni: "+esc(wd)+" · cod. "+esc(d.defaultCode)+" · proposto da "+esc(d.addedBy||"team")+"</div></div><div class='acts'><button class='ap' onclick='approve("+d.id+")'>✓ Approva</button><button onclick='openDriver("+d.id+")'>✏️ Modifica</button><button class='rj' onclick='reject("+d.id+")'>✗ Rifiuta</button></div></div>";}).join(""):"<p class='note'>Nessuna proposta in attesa.</p>";}
function approve(id){if(!isAdmin())return;const d=state.drivers.find(x=>x.id===id);d.status="active";dirty();logAction("DAS approvato: "+d.cognome+" "+d.nome+" (proposto da "+(d.addedBy||"team")+")");updateApprBadge();renderAppr();renderDas();renderGrid();toast("DAS approvato");}
function reject(id){if(!isAdmin())return;const d=state.drivers.find(x=>x.id===id);if(!confirm("Rifiutare "+d.cognome+" "+d.nome+"?"))return;state.drivers=state.drivers.filter(x=>x.id!==id);delete state.schedule[id];dirty();logAction("DAS rifiutato: "+d.cognome+" "+d.nome);updateApprBadge();renderAppr();toast("Proposta rifiutata");}

/* ---------- CONTRATTI & SCADENZE ---------- */
function renderContr(){const drv=baseScoped(),dets=drv.filter(d=>d.ctrType==="determinato"),scaduti=dets.filter(d=>{const s=expiryStatus(d);return s.days!==null&&s.days<0;}).length,inScad=dets.filter(d=>{const s=expiryStatus(d);return s.days!==null&&s.days>=0&&s.days<=60;}).length;
  document.getElementById("contrKpis").innerHTML=kpi(drv.filter(d=>d.ctrType==="indeterminato").length,"Indeterminati")+kpi(dets.length,"Determinati")+kpi(inScad,"In scadenza (60gg)")+kpi(scaduti,"Scaduti");
  const rows=drv.map(d=>({d,s:expiryStatus(d)})).sort((a,b)=>{const x=a.s.days,y=b.s.days;if(x===null)return 1;if(y===null)return -1;return x-y;});
  let h="<thead><tr><th>DAS</th><th>Filiale</th><th>Contratto</th><th>Tipo</th><th>Scadenza</th><th>Stato</th></tr></thead><tbody>";for(const{d,s}of rows){const ctr=contracts().find(c=>c.code===d.contratto);h+="<tr><td><b>"+esc(d.cognome)+" "+esc(d.nome)+"</b></td><td>"+esc(d.filiale)+"</td><td>"+esc(d.contratto)+"</td><td>"+(d.ctrType==="determinato"?"Determinato":"Indeterminato")+"</td><td>"+(d.expiry?fmtDate(d.expiry):"—")+"</td><td><span class='tag "+s.cls+"'>"+s.txt+"</span></td></tr>";}h+="</tbody>";document.getElementById("contrTbl").innerHTML=h;}

/* ---------- AUTO-GEN ---------- */
function openAuto(){previewAuto();if(!isAdmin()){document.getElementById("aFiliale").value=teamFiliale||"";document.getElementById("aFiliale").disabled=true;}else document.getElementById("aFiliale").disabled=false;document.getElementById("auto").classList.add("on");}
function previewAuto(){const fil=isAdmin()?document.getElementById("aFiliale").value:(teamFiliale||"");const n=activeDrivers().filter(d=>(!fil||d.filiale===fil)&&inScope(d)).length;document.getElementById("autoPrev").innerHTML="Verranno generati i turni per <b>"+n+" DAS</b> nel mese di "+document.getElementById("monthLabel").textContent+".";}
function runAuto(){closeAll();try{const fil=isAdmin()?document.getElementById("aFiliale").value:(teamFiliale||""),offCode=document.getElementById("aOff").value,mode=document.getElementById("aMode").value;let c=0;for(const dr of activeDrivers()){if(!inScope(dr))continue;if(fil&&dr.filiale!==fil)continue;autofillDriver(dr.id,dr.workDays,dr.defaultCode||defCode(dr.service),offCode,mode);c++;}dirty();logAction("Turni generati automaticamente ("+c+" DAS)");setView("plan");refreshAll();toast("Turni generati per "+c+" DAS");}catch(e){toast("Errore generazione: "+e.message);}}
function toggleFcDelta(){showFcDelta=!showFcDelta;const b=document.getElementById("fdToggle");if(b){b.classList.toggle("on",showFcDelta);b.textContent=(showFcDelta?"− ":"＋ ")+"Forecast/Delta";}renderGrid();}
/* auto-generazione automatica sui mesi vuoti */
function maybeAutoGen(){if(!CFG().autoGen)return;const drv=baseScoped();if(!drv.length)return;const empty=drv.every(d=>!state.schedule[d.id]||Object.keys(state.schedule[d.id]).length===0);if(!empty)return;let c=0;for(const dr of drv){autofillDriver(dr.id,dr.workDays,dr.defaultCode||defCode(dr.service),"OFF","empty");c++;}dirty();logAction("Auto-generazione mensile ("+c+" DAS)");toast("Turni del mese generati automaticamente");}
/* ---------- TURNAZIONE PDF ---------- */
function openTurnPdf(){const weeks=monthWeeks(),days=daysInMonth(YM);
  fillSelect("tpFil",isAdmin()?filiali():[teamFiliale||filiali()[0]]);
  let dopt="";for(let d=1;d<=days;d++)dopt+="<option value='"+d+"'>"+cap(dowName(YM,d))+" "+fmtDM(YM,d)+"</option>";document.getElementById("tpDay").innerHTML=dopt;
  document.getElementById("tpWeek").innerHTML=weeks.map((w,i)=>"<option value='"+i+"'"+(i===weekIdx?" selected":"")+">Week "+w.week+" · "+fmtDM(YM,w.days[0])+"–"+fmtDM(YM,w.days[w.days.length-1])+"</option>").join("");
  const today=new Date();if(today.toISOString().slice(0,7)===YM)document.getElementById("tpDay").value=today.getDate();
  tpToggle();document.getElementById("turnPdf").classList.add("on");}
function tpToggle(){const v=document.getElementById("tpView").value;document.getElementById("tpDayWrap").style.display=v==="day"?"flex":"none";document.getElementById("tpWeekWrap").style.display=v==="week"?"flex":"none";}
function tpCell(id,d){const c=getCode(id,d);if(!c||c.toUpperCase()==="OFF")return"RIPOSO";return codeLabel(c)+" ["+c+"]";}
function printTurnazione(){
  const view=document.getElementById("tpView").value,fil=document.getElementById("tpFil").value,wantPark=document.getElementById("tpPark").checked,wantRip=document.getElementById("tpRiposi").checked;
  const dt=filDetail(fil),[y,mo]=YM.split("-").map(Number),mn=["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"][mo-1];
  const drv=activeDrivers().filter(d=>d.filiale===fil).sort((a,b)=>a.cognome.localeCompare(b.cognome));
  const head="<div class='hd'><div class='co'>Turni Global One S.p.A. — "+esc(fil)+"</div>"+(wantPark&&(dt.park||dt.addr||dt.conv)?"<div class='pk'>"+[dt.park?"Parcheggio: <b>"+esc(dt.park)+"</b>":"",dt.addr?"Indirizzo: <b>"+esc(dt.addr)+"</b>":"",dt.conv?"Convocazione: <b>"+esc(dt.conv)+"</b>":""].filter(Boolean).join(" · ")+"</div>":"")+"</div>";
  let title="",body="";
  if(view==="day"){const d=+document.getElementById("tpDay").value;title="Turnazione "+esc(fil)+" — "+cap(dowName(YM,d))+" "+fmtDM(YM,d)+" "+mn+" "+y;
    const inturno=[];const riposi=[];
    for(const dr of drv){const c=getCode(dr.id,d),rip=!c||c.toUpperCase()==="OFF";if(rip)riposi.push(dr);else inturno.push({dr,c});}
    inturno.sort((a,b)=>a.dr.service.localeCompare(b.dr.service)||a.dr.cognome.localeCompare(b.dr.cognome));
    let rows="",n=0;for(const {dr,c} of inturno){n++;const ci=convInfo(dr);rows+="<tr><td class='ctr'>"+n+"</td><td>"+esc(dr.cognome)+"</td><td>"+esc(dr.nome)+"</td><td class='turno'>"+esc(codeLabel(c))+"</td><td class='ctr'>"+esc(ci.orario)+"</td><td class='conv'>"+esc(ci.luogo)+"</td><td class='carico'>"+esc(fil)+"</td></tr>";}
    body="<table class='sheet'><thead><tr><th>Num</th><th>Cognome</th><th>Nome</th><th>Turno</th><th>Orario</th><th>Luogo Convocazione</th><th>Luogo di carico</th></tr></thead><tbody>"+(rows||"<tr><td colspan='7'>Nessun DAS in turno</td></tr>")+"</tbody></table>";
    if(wantRip&&riposi.length)body+="<h3 class='svc'>Riposo <span class='cnt'>("+riposi.length+")</span></h3><div class='rip'>"+riposi.map(dr=>esc(dr.cognome+" "+dr.nome)).join(" · ")+"</div>";
  }
  else{const days=view==="week"?monthWeeks()[+document.getElementById("tpWeek").value].days:Array.from({length:daysInMonth(YM)},(_,i)=>i+1);
    const PKCOL={next:["#FDEDC8","#7a5500"],samea:["#DCE9FB","#1F5FBF"],sameb:["#ECDFF9","#5b2e8c"],mm:["#D6F1EE","#0E7E74"],abs:["#EDEFF3","#475066"],mal:["#F9DEDC","#9b2620"],off:["#DDE1E9","#475066"]};
    const wkNo=view==="week"?isoWeek(YM,days[0]):0;
    title=(view==="week"?"WEEK "+wkNo:"Turnazione mensile — "+mn+" "+y);
    let th1="<th rowspan='2' class='nmH'>COGNOME</th><th rowspan='2' class='nmH'>NOME</th>";let th2="";
    for(const d of days){th1+="<th>"+fmtFull(YM,d)+"</th>";th2+="<th class='wd'>"+cap(dowFull(YM,d))+"</th>";}
    let rows="";for(const dr of drv){let r="<td class='cg'>"+esc(dr.cognome)+"</td><td class='cg'>"+esc(dr.nome)+"</td>";for(const d of days){const c=getCode(dr.id,d),rip=!c||c.toUpperCase()==="OFF";if(rip){r+="<td></td>";continue;}const col=PKCOL[codeCls(c)]||["#fff","#111"];r+="<td style='background:"+col[0]+";color:"+col[1]+";font-weight:600'>"+esc(codeLabel(c))+"</td>";}rows+="<tr>"+r+"</tr>";}
    body="<table class='wk'><thead><tr>"+th1+"</tr><tr>"+th2+"</tr></thead><tbody>"+(rows||"<tr><td colspan='"+(days.length+2)+"'>Nessun DAS</td></tr>")+"</tbody></table>";}
  const html="<!doctype html><html lang='it'><head><meta charset='utf-8'><title>"+title+"</title><style>"+
    "body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:18px}"+
    ".hd{border-bottom:2px solid #16233B;padding-bottom:8px;margin-bottom:10px}.co{font-size:18px;font-weight:700;color:#16233B}.pk{font-size:12px;color:#444;margin-top:3px}"+
    "h2{font-size:16px;margin:8px 0 12px;font-weight:800;letter-spacing:.04em}"+
    "table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #bbb;padding:5px 7px;text-align:left}th{background:#EEF1F6}"+
    "table.grid td,table.grid th{text-align:center;padding:3px}table.grid td.nm{text-align:left;white-space:nowrap}.rip{color:#777;font-size:12px;margin:4px 0 12px}.lg{font-size:11px;color:#666;margin-top:6px}"+
    "h3.svc{font-size:13px;margin:14px 0 6px;background:#EEF1F6;padding:5px 8px;border-left:4px solid #16233B}h3.svc .cnt{color:#666;font-weight:400}"+
    "table.sheet th{background:#16233B;color:#fff}table.sheet td.ctr{text-align:center}table.sheet td.turno{background:#FBE2E6;font-weight:700;text-align:center}table.sheet td.conv{background:#FFF6B0;font-weight:600}table.sheet td.carico{background:#CDE7CE;font-weight:600;text-align:center}"+
    "table.wk{font-size:11px}table.wk th{text-align:center;background:#fff}table.wk th.nmH{background:#7CB342;color:#fff;font-size:12px}table.wk th.wd{font-style:italic;color:#333;font-weight:600}table.wk td{text-align:center}table.wk td.cg{background:#EDEDED;font-weight:700;text-align:left;white-space:nowrap}"+
    "@media print{body{margin:6mm}@page{size:landscape}}</style></head><body>"+head+"<h2>"+title+"</h2>"+body+
    "<script>window.onload=function(){window.print();}<\/script></body></html>";
  const w=window.open("","_blank");if(!w){toast("Consenti i popup per la stampa");return;}w.document.open();w.document.write(html);w.document.close();logAction("Turnazione "+view+" stampata ("+fil+")");}

/* ---------- IMPORT DAS ---------- */
function openImport(){document.getElementById("impText").value="";document.getElementById("impDas").classList.add("on");}
function loadCsvFile(ev){const f=ev.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{document.getElementById("impText").value=r.result;};r.readAsText(f);ev.target.value="";}
function downloadTemplate(){const t="Cognome;Nome;Filiale;Service;Contratto;Tipo;Scadenza;GiorniLavorativi;CodicePredefinito;TransporterID;Device;DataAssunzione\nRossi;Mario;"+(filiali()[0]||"DLO1")+";SAME A;21;indeterminato;;12345;SameA;A1B2C3D4E5;Samsung A14 #042;2024-03-01\nBianchi;Luca;"+(filiali()[0]||"DLO1")+";NEXT;13;determinato;2026-12-31;123456;X;F6G7H8I9J0;iPhone SE #11;2025-06-15";const b=new Blob([t],{type:"text/csv"});const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download="modello_DAS.csv";a.click();URL.revokeObjectURL(a.href);}
function parseDays(s){if(!s)return null;s=String(s).trim();if(s.includes(",")||s.includes(" ")){return s.split(/[, ]+/).map(x=>+x===7?0:+x).filter(x=>!isNaN(x));}return s.split("").map(ch=>ch==="7"?0:+ch).filter(x=>!isNaN(x));}
async function runImport(){const txt=document.getElementById("impText").value.trim();if(!txt){toast("Incolla i dati");return;}const lines=txt.split(/\r?\n/).filter(l=>l.trim());let added=0,skipped=0;const validFil=filiali();
  for(let li=0;li<lines.length;li++){let line=lines[li];const delim=line.includes(";")?";":",";const f=line.split(delim).map(x=>x.trim());if(li===0&&/cognome/i.test(f[0])){continue;}if(!f[0]){skipped++;continue;}
    let fil=f[2]||(scopeFil()||validFil[0]);if(!isAdmin())fil=teamFiliale;if(!validFil.includes(fil))fil=validFil[0];
    const service=f[3]&&stypeNames().includes(f[3])?f[3]:(stypeNames()[0]||"NEXT");const ctr=f[4]&&contracts().some(c=>c.code===f[4])?f[4]:contracts()[0].code;const ctrType=/det/i.test(f[5]||"")?"determinato":"indeterminato";const expiry=ctrType==="determinato"&&/^\d{4}-\d{2}-\d{2}$/.test(f[6]||"")?f[6]:null;const wd=parseDays(f[7])||(contracts().find(c=>c.code===ctr)||{}).defDays||[1,2,3,4,5];const def=f[8]&&CFG().codes.some(c=>c.code===f[8])?f[8]:(defCode(service));
    const id=(state.drivers.reduce((m,d)=>Math.max(m,d.id),0)||0)+1+added;
    state.drivers.push({id,cognome:f[0],nome:f[1]||"",filiale:fil,service,contratto:ctr,ctrType,expiry,workDays:wd,defaultCode:def,transporterId:(f[9]||"").trim(),device:(f[10]||"").trim(),hireDate:(/^\d{4}-\d{2}-\d{2}$/.test(f[11]||"")?f[11]:""),status:isAdmin()?"active":"pending",addedBy:actorName()});added++;}
  // Persist the imported batch once (explicit — autosave no longer bulk-imports).
  if(typeof DB_SYNC!=="undefined"&&DB_SYNC&&added){try{await TurniApi.schedulerImportDrivers(state.drivers.slice(-added));}catch(e){console.warn("[DB] import",e.message);}}
  dirty();logAction(added+" DAS importati");closeAll();updateApprBadge();refreshAll();toast(added+" DAS importati"+(skipped?" · "+skipped+" righe saltate":"")+(isAdmin()?"":" (in attesa di approvazione)"));}
function exportDasCsv(){const rows=["Cognome;Nome;Filiale;Service;Contratto;Tipo;Scadenza;GiorniLavorativi;CodicePredefinito;TransporterID;Device;DataAssunzione"];for(const d of scopedActive())rows.push([d.cognome,d.nome,d.filiale,d.service,d.contratto,d.ctrType,d.expiry||"",d.workDays.map(n=>n===0?7:n).sort().join(""),d.defaultCode,d.transporterId||"",d.device||"",d.hireDate||""].join(";"));const b=new Blob([rows.join("\n")],{type:"text/csv"});const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download="DAS_"+(scopeFil()||"tutte")+".csv";a.click();URL.revokeObjectURL(a.href);}

/* ---------- EXPORT SETTIMANA PER DRIVER ---------- */
function openExportWeek(){const weeks=monthWeeks();fillSelect("ewFiliale",isAdmin()?["Tutte"].concat(filiali()):[teamFiliale]);if(!isAdmin())document.getElementById("ewFiliale").value=teamFiliale;document.getElementById("ewWeek").innerHTML=weeks.map((w,i)=>"<option value='"+i+"'"+(i===weekIdx?" selected":"")+">Week "+w.week+" · "+fmtDM(YM,w.days[0])+"–"+fmtDM(YM,w.days[w.days.length-1])+"</option>").join("");document.getElementById("ewFiliale").onchange=buildWeekExport;document.getElementById("ewWeek").onchange=buildWeekExport;buildWeekExport();document.getElementById("expWeek").classList.add("on");}
function buildWeekExport(){const weeks=monthWeeks();const wi=+document.getElementById("ewWeek").value||0;const w=weeks[wi];const filSel=document.getElementById("ewFiliale").value;const fil=(filSel==="Tutte")?null:filSel;
  const drv=activeDrivers().filter(d=>(!fil||d.filiale===fil)).sort((a,b)=>a.cognome.localeCompare(b.cognome));
  const[y,m]=YM.split("-").map(Number);const mn=["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"][m-1];
  let out="TURNI Global One S.p.A."+(fil?" — "+fil:"")+"\nSettimana "+fmtDM(YM,w.days[0])+"–"+fmtDM(YM,w.days[w.days.length-1])+" "+mn+" "+y+"\n"+"=".repeat(40)+"\n\n";
  for(const dr of drv){out+=dr.cognome+" "+dr.nome+" ("+dr.filiale+")"+(dr.transporterId?" · ID "+dr.transporterId:"")+(dr.device?" · "+dr.device:"")+"\n";for(const d of w.days){const c=getCode(dr.id,d);const isRest=!c||c.toUpperCase()==="OFF";const lbl=isRest?"RIPOSO":(codeLabel(c)+" ["+c+"]");out+="  "+cap(dowName(YM,d))+" "+fmtDM(YM,d)+":  "+lbl+"\n";}out+="\n";}
  if(!drv.length)out+="(nessun DAS)\n";
  ewText=out;document.getElementById("ewPrev").value=out;}
const cap=s=>s.charAt(0).toUpperCase()+s.slice(1);
function copyWeek(){navigator.clipboard&&navigator.clipboard.writeText(ewText).then(()=>toast("Copiato negli appunti"),()=>toast("Copia non riuscita"));}
function downloadWeek(){const b=new Blob([ewText],{type:"text/plain"});const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download="turni_settimana.txt";a.click();URL.revokeObjectURL(a.href);}

/* ---------- CONFIGURAZIONE ---------- */
function setCfg(t){cfgTab=t;document.querySelectorAll("#v-cfg .subtabs button").forEach(b=>b.classList.toggle("on",b.dataset.c===t));document.querySelectorAll(".cfgsec").forEach(s=>s.classList.toggle("on",s.id==="cfg-"+t));renderCfg();}
function renderCfg(){if(!isAdmin())return;
  document.getElementById("filList").innerHTML=filiali().map((f)=>{const dt=filDetail(f);const info=dt.parks.length?dt.parks.map(p=>p.name+(p.time?" ("+p.time+")":"")).join(" · "):"";return "<div class='dcard' style='align-items:center'><div class='av'>"+esc(f)+"</div><div style='flex:1'><div class='nm'>"+esc(f)+"</div><div class='meta'>"+(info?esc(info):"<i>nessun parcheggio impostato</i>")+"</div></div><div class='acts'><button onclick='openFilDetail(\""+esc(f)+"\")'>🅿️ Parcheggi / Convocazione</button></div></div>";}).join("")||"<span class='note'>Nessuna filiale.</span>";
  fillSelect("uFil",filiali(),filiali()[0]);
  /* Servizi & Forecast */
  let hs="<thead><tr><th>Servizio</th><th>Tipo forecast</th><th>Codici Harmony</th><th>Filiali</th><th></th></tr></thead><tbody>";
  services().forEach((s,i)=>{hs+="<tr><td><b>"+esc(s.label)+"</b><br><small style='color:var(--muted)'>"+esc(s.key)+"</small></td><td>"+(s.minOf?"Derivato MIN("+s.minOf.join(", ")+")":"Editabile")+"</td><td style='font-size:.75rem'>"+(s.count||[]).map(esc).join(", ")+"</td><td>"+((s.filiali&&s.filiali.length)?s.filiali.map(esc).join(", "):"<i style='color:var(--muted)'>tutte</i>")+"</td><td><button class='btn ghost sm' onclick='openSvc("+i+")'>✏️</button> <button class='btn warn sm' onclick='delSvc("+i+")'>🗑</button></td></tr>";});
  document.getElementById("svcsTbl").innerHTML=hs+"</tbody>";
  fillSelect("stCode",groupedCodes().flatMap(g=>g.codes),"X");
  document.getElementById("stypeList").innerHTML=serviceTypes().map((t,i)=>"<span class='pill'>"+esc(t.name)+" <small style='color:var(--muted)'>("+esc(t.defaultCode)+(t.conv?" · "+esc(t.conv):"")+(t.park?" · "+esc(t.park):"")+")</small> <button onclick='editStypeConv("+i+")' style='color:var(--ink)'>🕑</button> <button onclick='editStypePark("+i+")' style='color:var(--ink)'>🅿️</button> <button onclick='delStype("+i+")'>✕</button></span>").join("")||"<span class='note'>Nessun tipo.</span>";
  const pl=document.getElementById("parkList");if(pl)pl.innerHTML=allParkNames().map(n=>"<option value='"+esc(n)+"'>").join("");
  let hu="<thead><tr><th>Username</th><th>Filiale assegnata</th><th>Forecast assegnati</th><th>PIN</th><th></th></tr></thead><tbody>";
  users().forEach((u,i)=>{const sv=u.services&&u.services.length?(u.services.length+" service"):"tutti (filiale)";const fl=(u.filiali&&u.filiali.length?u.filiali.join(", "):(u.filiale||"—"));hu+="<tr style='"+(u.disabled?"opacity:.55":"")+"'><td><b>"+esc(u.username)+"</b>"+(u.disabled?" <span class='tag bad'>disattivo</span>":"")+"</td><td><span class='tag fil'>"+esc(fl)+"</span> <button class='btn ghost sm' onclick='openUserFil("+i+")'>filiali</button></td><td><span class='tag"+(u.services&&u.services.length?" fil":"")+"'>"+sv+"</span> <button class='btn ghost sm' onclick='openUserSvc("+i+")'>scegli</button></td><td>"+("•".repeat(Math.max(3,(u.pin||"").length)))+" <button class='btn ghost sm' onclick='resetUserPin("+i+")'>cambia PIN</button></td><td><button class='btn "+(u.disabled?"ok":"warn")+" sm' onclick='delUser("+i+")'>"+(u.disabled?"Riattiva":"Disattiva")+"</button></td></tr>";});
  if(!users().length)hu+="<tr><td colspan='5' style='color:var(--muted)'>Nessun account team. Creane uno qui sopra.</td></tr>";
  document.getElementById("usersTbl").innerHTML=hu+"</tbody>";
  let h="<thead><tr><th>Codice</th><th>Descrizione</th><th>Giorni/sett.</th><th>Giorni consentiti</th><th></th></tr></thead><tbody>";contracts().forEach((c,i)=>{h+="<tr><td><b>"+esc(c.code)+"</b></td><td>"+esc(c.label)+"</td><td>"+((c.workDays!=null?c.workDays:(c.defDays?c.defDays.length:0)))+"</td><td>"+(c.defDays||[]).map(n=>(WEEKDAYS.find(w=>w.n===n)||{}).l).join(" ")+"</td><td><button class='btn ghost sm' onclick='openContract("+i+")'>✏️</button> <button class='btn warn sm' onclick='delContract("+i+")'>🗑</button></td></tr>";});document.getElementById("cfgContrTbl").innerHTML=h+"</tbody>";
  h="<thead><tr><th>Codice</th><th>Descrizione</th><th>Categoria</th><th></th></tr></thead><tbody>";CFG().codes.forEach((c,i)=>{h+="<tr><td><span class='chip' style='background:var(--"+c.cls+"-bg);color:var(--"+c.cls+")'>"+esc(c.code)+"</span></td><td>"+esc(c.label)+"</td><td style='font-size:.78rem;color:var(--muted)'>"+esc(groupName(c.cls))+"</td><td><button class='btn ghost sm' onclick='openCode("+i+")'>✏️</button> <button class='btn warn sm' onclick='delCode("+i+")'>🗑</button></td></tr>";});document.getElementById("cfgCodesTbl").innerHTML=h+"</tbody>";
  const allCodes=groupedCodes().flatMap(g=>g.codes);
  document.getElementById("cfgCounters").innerHTML=COUNTER_META.map(m=>"<div class='fcard'><h4>"+esc(m.label)+"</h4><p>"+esc(m.hint)+"</p>"+chipSel(allCodes,CFG().counters[m.key],"toggleCounter('"+m.key+"',")+"</div>").join("");
  const cc=document.getElementById("cfgCustom");if(cc)cc.innerHTML=customCounters().map((c,i)=>"<div class='fcard'><h4>"+esc(c.label)+" <button class='btn warn sm' style='float:right' onclick='delCustomCounter("+i+")'>🗑</button></h4><p>Codici conteggiati in questa formula.</p>"+chipSel(allCodes,c.codes,"toggleCustom("+i+",")+"</div>").join("")||"<p class='note'>Nessuna formula personalizzata.</p>";
  document.getElementById("cfgServices").innerHTML=services().map(s=>"<div class='fcard'><h4>"+esc(s.label)+(s.minOf?" <span class='tag'>forecast = MIN("+s.minOf.join(", ")+")</span>":"")+"</h4><p>Codici conteggiati in Harmony (e nel Delta).</p>"+chipSel(allCodes,s.count||[],"toggleHarmony('"+s.key+"',")+"</div>").join("");}
function chipSel(allCodes,sel,onclkPrefix){return "<div class='chipsel'>"+allCodes.map(c=>"<button class='"+(sel.includes(c)?"on":"")+"' onclick=\""+onclkPrefix+"'"+c+"')\">"+esc(c)+"</button>").join("")+"</div>";}
function toggleCounter(key,code){const a=CFG().counters[key],i=a.indexOf(code);if(i<0)a.push(code);else a.splice(i,1);saveConfig();renderCfg();renderGrid();renderCov();}
const customCounters=()=>{if(!CFG().customCounters)CFG().customCounters=[];return CFG().customCounters;};
function addCustomCounter(){const n=document.getElementById("ccName").value.trim();if(!n){toast("Inserisci un nome");return;}customCounters().push({id:"cc"+Date.now(),label:n,codes:[]});saveConfig();logAction("Formula aggiunta: "+n);document.getElementById("ccName").value="";renderCfg();renderGrid();toast("Formula aggiunta");}
function delCustomCounter(i){const c=customCounters()[i];if(!confirm("Eliminare la formula '"+c.label+"'?"))return;customCounters().splice(i,1);saveConfig();logAction("Formula eliminata: "+c.label);renderCfg();renderGrid();}
function toggleCustom(i,code){const a=customCounters()[i].codes,k=a.indexOf(code);if(k<0)a.push(code);else a.splice(k,1);saveConfig();renderCfg();renderGrid();}
function toggleHarmony(svcKey,code){const s=services().find(x=>x.key===svcKey);if(!s.count)s.count=[];const i=s.count.indexOf(code);if(i<0)s.count.push(code);else s.count.splice(i,1);saveConfig();renderCfg();renderGrid();renderCov();}
function addFiliale(){const v=document.getElementById("newFil").value.trim().toUpperCase();if(!v){toast("Inserisci il nome");return;}if(filiali().includes(v)){toast("Filiale già presente");return;}filiali().push(v);saveConfig();logAction("Filiale aggiunta: "+v);document.getElementById("newFil").value="";refreshFilSelects();renderCfg();toast("Filiale "+v+" aggiunta");}
let filDetEdit=null;
function parkRowHtml(p){p=p||{name:"",addr:"",time:""};return "<div class='formrow' style='gap:6px;margin-bottom:6px'><input class='pkName' placeholder='Nome (es. Parcheggio Via Salomone 1)' value=\""+esc(p.name||"")+"\" style='flex:2;min-width:160px'><input class='pkAddr' placeholder='Indirizzo' value=\""+esc(p.addr||"")+"\" style='flex:2;min-width:120px'><input class='pkTime' placeholder='Orario' value=\""+esc(p.time||"")+"\" style='flex:0 0 80px;min-width:70px'><button class='btn warn sm' onclick='this.parentNode.remove()'>✕</button></div>";}
function addParkRow(){document.getElementById("fdParks").insertAdjacentHTML("beforeend",parkRowHtml());}
function openFilDetail(f){if(!isAdmin()&&!acctFiliali().includes(f)){toast("Filiale non assegnata");return;}filDetEdit=f;const dt=filDetail(f);document.getElementById("fdTitle").textContent="Filiale "+f;
  document.getElementById("fdParks").innerHTML=(dt.parks.length?dt.parks:[{name:"",addr:"",time:""}]).map(parkRowHtml).join("");
  const svcWrap=document.getElementById("fdSvcWrap");if(svcWrap)svcWrap.style.display=isAdmin()?"block":"none";
  document.getElementById("fdSvc").innerHTML=services().map(s=>"<button type='button' data-k=\""+esc(s.key)+"\" class='"+(svcInFiliale(s,f)?"on":"")+"' onclick='this.classList.toggle(\"on\")'>"+esc(s.label)+"</button>").join("")||"<span class='note'>Nessun servizio. Creane in Servizi & Forecast.</span>";
  document.getElementById("filDet").classList.add("on");}
function saveFilDetail(){if(!filDetEdit)return;if(!isAdmin()&&!acctFiliali().includes(filDetEdit)){toast("Filiale non assegnata");return;}const dt=filDetail(filDetEdit);
  const parks=[];document.querySelectorAll("#fdParks .formrow").forEach(r=>{const name=r.querySelector(".pkName").value.trim(),addr=r.querySelector(".pkAddr").value.trim(),time=r.querySelector(".pkTime").value.trim();if(name||addr||time)parks.push({name:name||"Parcheggio",addr,time});});
  dt.parks=parks;if(parks[0]){dt.park=parks[0].name;dt.addr=parks[0].addr;dt.conv=parks[0].time;}
  if(isAdmin()){const sel=[...document.querySelectorAll("#fdSvc button.on")].map(b=>b.dataset.k);services().forEach(s=>{if(!Array.isArray(s.filiali))s.filiali=[];const has=s.filiali.includes(filDetEdit),want=sel.includes(s.key);if(want&&!has)s.filiali.push(filDetEdit);if(!want&&has)s.filiali=s.filiali.filter(x=>x!==filDetEdit);});}
  saveConfig();logAction("Filiale "+filDetEdit+": parcheggi aggiornati");closeAll();if(isAdmin())renderCfg();toast("Salvato");}
function addUser(){const u=document.getElementById("uName").value.trim(),p=document.getElementById("uPin").value.trim(),f=document.getElementById("uFil").value;if(!u||!p){toast("Inserisci username e PIN");return;}if(u.toLowerCase()==="admin"){toast("'admin' è riservato");return;}if(users().some(x=>x.username.toLowerCase()===u.toLowerCase())){toast("Username già esistente");return;}users().push({id:Date.now(),username:u,pin:p,filiali:[f],services:[]});saveConfig();logAction("Account creato: "+u+" ("+f+")");document.getElementById("uName").value="";document.getElementById("uPin").value="";renderCfg();toast("Account creato: "+u+" · "+f);}
let userFilIdx=null;
function openUserFil(i){userFilIdx=i;const u=users()[i];document.getElementById("ufTitle").textContent="Filiali di "+u.username;document.getElementById("ufList").innerHTML=filiali().map(f=>"<button type='button' data-f=\""+esc(f)+"\" class='"+((u.filiali||[]).includes(f)?"on":"")+"' onclick='this.classList.toggle(\"on\")'>"+esc(f)+"</button>").join("");document.getElementById("userFil").classList.add("on");}
function saveUserFil(){if(userFilIdx==null)return;const sel=[...document.querySelectorAll("#ufList button.on")].map(b=>b.dataset.f);if(!sel.length){toast("Assegna almeno una filiale");return;}const u=users()[userFilIdx];u.filiali=sel;if(u.services&&u.services.length)u.services=u.services.filter(k=>{const s=services().find(x=>x.key===k);return s&&sel.some(f=>svcInFiliale(s,f));});saveConfig();logAction("Filiali account "+u.username+": "+sel.join(", "));closeAll();renderCfg();toast("Filiali aggiornate");}
function resetUserPin(i){const p=prompt("Nuovo PIN per "+users()[i].username+":");if(p===null)return;if(!p.trim()){toast("PIN non valido");return;}users()[i].pin=p.trim();saveConfig();toast("PIN aggiornato");}
function delUser(i){const u=users()[i];const dis=!u.disabled;if(!confirm((dis?"Disattivare":"Riattivare")+" l'account "+u.username+"?"))return;u.disabled=dis;saveConfig();logAction("Account "+(dis?"disattivato":"riattivato")+": "+u.username);renderCfg();}
let userSvcIdx=null;
function openUserSvc(i){userSvcIdx=i;const u=users()[i];const fls=(u.filiali&&u.filiali.length?u.filiali:[u.filiale]);const avail=services().filter(s=>fls.some(f=>svcInFiliale(s,f)));document.getElementById("usFor").innerHTML=avail.length?avail.map(s=>"<button type='button' data-v=\""+esc(s.key)+"\" class='"+((u.services||[]).includes(s.key)?"on":"")+"' onclick='this.classList.toggle(\"on\")'>"+esc(s.label)+"</button>").join(""):"<span class='note'>Nessun servizio per le filiali assegnate.</span>";document.getElementById("usTitle").textContent="Forecast per "+u.username;document.getElementById("userSvc").classList.add("on");}
function saveUserSvc(){if(userSvcIdx==null)return;const sel=[...document.querySelectorAll("#usFor button.on")].map(b=>b.dataset.v);users()[userSvcIdx].services=sel;saveConfig();logAction("Forecast assegnati a "+users()[userSvcIdx].username);closeAll();renderCfg();toast(sel.length?(sel.length+" forecast assegnati"):"Tutti i forecast della filiale");}
function clearUserSvc(){if(userSvcIdx==null)return;users()[userSvcIdx].services=[];saveConfig();closeAll();renderCfg();toast("Assegnati tutti i forecast della filiale");}
/* --- Servizi (forecast) --- */
function svcChip(containerId,all,sel,fn){document.getElementById(containerId).innerHTML=all.map(c=>"<button type='button' data-v=\""+esc(c)+"\" class='"+(sel.includes(c)?"on":"")+"' onclick='this.classList.toggle(\"on\")'>"+esc(c)+"</button>").join("");}
function svcChipGet(containerId){return[...document.querySelectorAll("#"+containerId+" button.on")].map(b=>b.dataset.v);}
function onSvcType(){document.getElementById("sMinRow").style.display=document.getElementById("sType").value==="min"?"grid":"none";}
function openSvc(i){cfgEditId=i;const s=i!=null?services()[i]:null;
  document.getElementById("svcEdTitle").textContent=s?"Modifica servizio":"Nuovo servizio (forecast)";
  document.getElementById("sLabel").value=s?s.label:"";document.getElementById("sKey").value=s?s.key:"";document.getElementById("sKey").readOnly=!!s;
  document.getElementById("sType").value=s&&s.minOf?"min":"edit";onSvcType();
  const others=services().filter(x=>!s||x.key!==s.key).map(x=>x.key);
  fillSelect("sMinA",others,s&&s.minOf?s.minOf[0]:others[0]);fillSelect("sMinB",others,s&&s.minOf?s.minOf[1]:others[1]||others[0]);
  svcChip("sCodes",groupedCodes().flatMap(g=>g.codes),s?(s.count||[]):[]);
  svcChip("sFiliali",filiali(),s?(s.filiali||[]):[]);
  document.getElementById("svcEd").classList.add("on");}
function saveSvc(){const label=document.getElementById("sLabel").value.trim();if(!label){toast("Inserisci il nome");return;}
  let key=document.getElementById("sKey").value.trim()||label.toUpperCase().replace(/[^A-Z0-9]+/g,"_").replace(/^_|_$/g,"");
  const type=document.getElementById("sType").value;
  const obj={key,label,count:svcChipGet("sCodes"),filiali:svcChipGet("sFiliali")};
  if(type==="min")obj.minOf=[document.getElementById("sMinA").value,document.getElementById("sMinB").value];
  if(cfgEditId!=null){obj.key=services()[cfgEditId].key;services()[cfgEditId]=obj;}
  else{if(services().some(x=>x.key===key)){toast("Chiave già esistente");return;}services().push(obj);}
  saveConfig();closeAll();renderCfg();renderCov();renderGrid();toast("Servizio salvato");}
function delSvc(i){const s=services()[i];if(!confirm("Eliminare il servizio "+s.label+" e il suo forecast?"))return;delete state.forecast[s.key];services().splice(i,1);saveConfig();renderCfg();renderCov();renderGrid();}
/* --- Tipi di servizio DAS --- */
function addStype(){const n=document.getElementById("stName").value.trim();if(!n){toast("Inserisci il nome");return;}if(serviceTypes().some(t=>t.name===n)){toast("Tipo già presente");return;}serviceTypes().push({name:n,defaultCode:document.getElementById("stCode").value,conv:document.getElementById("stConv").value.trim(),park:document.getElementById("stPark").value.trim()});saveConfig();logAction("Tipo service aggiunto: "+n);document.getElementById("stName").value="";document.getElementById("stConv").value="";document.getElementById("stPark").value="";refreshFilSelects();renderCfg();toast("Tipo di servizio aggiunto");}
function editStypeConv(i){const t=serviceTypes()[i];const v=prompt("Orario convocazione per "+t.name+" (vuoto = nessuno):",t.conv||"");if(v===null)return;t.conv=v.trim();saveConfig();logAction("Orario "+t.name+" = "+(t.conv||"—"));renderCfg();toast("Orario aggiornato");}
function editStypePark(i){const t=serviceTypes()[i];const v=prompt("Parcheggio / Luogo Convocazione per "+t.name+":",t.park||"");if(v===null)return;t.park=v.trim();saveConfig();logAction("Parcheggio "+t.name+" = "+(t.park||"—"));renderCfg();toast("Parcheggio aggiornato");}
function stypeConv(name){const t=serviceTypes().find(s=>s.name===name);return t&&t.conv?t.conv:"";}
function stypePark(name){const t=serviceTypes().find(s=>s.name===name);return t&&t.park?t.park:"";}
/* risolve il luogo convocazione/orario per un driver in base al suo service type e ai parcheggi della filiale */
function convInfo(dr){const stName=dr.service,pkName=stypePark(stName),dt=filDetail(dr.filiale);let pk=null;if(pkName)pk=dt.parks.find(p=>p.name===pkName);if(!pk&&dt.parks.length)pk=dt.parks[0];const luogo=pkName||(pk?pk.name:"");const addr=pk?pk.addr:"";const orario=stypeConv(stName)||(pk?pk.time:"")||dt.conv||"";return{luogo:luogo+(addr?" — "+addr:""),orario};}
function delStype(i){if(!confirm("Eliminare il tipo "+serviceTypes()[i].name+"?"))return;serviceTypes().splice(i,1);saveConfig();refreshFilSelects();renderCfg();}
function delFiliale(i){const f=filiali()[i];const used=state.drivers.filter(d=>d.filiale===f).length;if(used&&!confirm("La filiale "+f+" ha "+used+" DAS. Eliminarla comunque? I DAS resteranno ma senza filiale valida."))return;if(!used&&!confirm("Eliminare la filiale "+f+"?"))return;filiali().splice(i,1);saveConfig();refreshFilSelects();renderCfg();}
function openContract(i){cfgEditId=i;const c=i!=null?contracts()[i]:null;document.getElementById("ctrEdTitle").textContent=c?"Modifica contratto":"Nuovo contratto";document.getElementById("cCode").value=c?c.code:"";document.getElementById("cLabel").value=c?c.label:"";buildDayPicker("cDays",c?c.defDays:[1,2,3,4,5]);document.getElementById("ctrEd").classList.add("on");}
function saveContract(){const code=document.getElementById("cCode").value.trim();if(!code){toast("Inserisci il codice");return;}const obj={code,label:document.getElementById("cLabel").value.trim()||code,ore:+document.getElementById("cOre").value||0,defDays:getDays("cDays")};if(cfgEditId!=null)contracts()[cfgEditId]=obj;else contracts().push(obj);saveConfig();logAction("Contratto salvato: "+obj.code);closeAll();renderCfg();renderLeg();toast("Contratto salvato");}
function delContract(i){if(!confirm("Eliminare il contratto "+contracts()[i].code+"?"))return;contracts().splice(i,1);saveConfig();renderCfg();renderLeg();}
function openCode(i){cfgEditId=i;const c=i!=null?CFG().codes[i]:null;document.getElementById("codeEdTitle").textContent=c?"Modifica codice":"Nuovo codice";document.getElementById("kCode").value=c?c.code:"";document.getElementById("kLabel").value=c?c.label:"";fillSelect("kCls",CFG().groups.map(g=>g.cls),c?c.cls:"abs");[...document.getElementById("kCls").options].forEach(o=>o.textContent=groupName(o.value));document.getElementById("codeEd").classList.add("on");}
function saveCode(){const code=document.getElementById("kCode").value.trim();if(!code){toast("Inserisci il codice");return;}const obj={code,label:document.getElementById("kLabel").value.trim()||code,cls:document.getElementById("kCls").value};if(cfgEditId!=null)CFG().codes[cfgEditId]=obj;else{if(CFG().codes.some(x=>x.code===code)){toast("Codice già esistente");return;}CFG().codes.push(obj);}saveConfig();logAction("Codice salvato: "+obj.code);renderCfg();renderLeg();renderGrid();closeAll();if(cameFromLegQuick){cameFromLegQuick=false;openLegendQuick();}toast("Codice salvato");}
function closeCodeEd(){closeAll();if(cameFromLegQuick){cameFromLegQuick=false;openLegendQuick();}}
function openLegendQuick(){let h="";for(const g of groupedCodes()){h+="<div class='legq-grp'><h4>"+esc(g.name)+"</h4><div class='legq-grid'>";const idxOf=c=>CFG().codes.findIndex(x=>x.code===c);for(const c of g.codes)h+="<button style='background:var(--"+g.cls+"-bg);color:var(--"+g.cls+")' onclick='legChipEdit("+idxOf(c)+")'>"+esc(c)+"<small>"+esc(codeLabel(c))+"</small></button>";h+="</div></div>";}document.getElementById("legQuickBody").innerHTML=h;document.getElementById("legQuick").classList.add("on");}
function legChipEdit(i){cameFromLegQuick=true;closeAll();openCode(i);}
function legAddNew(){cameFromLegQuick=true;closeAll();openCode(null);}
function delCode(i){const c=CFG().codes[i];if(!confirm("Eliminare il codice "+c.code+"?"))return;CFG().codes.splice(i,1);saveConfig();renderCfg();renderLeg();}
function restoreDefaults(which){if(!confirm("Ripristinare i default per: "+which+"?"))return;const def=defaultConfig();if(which==="contracts")state.config.contracts=def.contracts;if(which==="codes"){state.config.codes=def.codes;state.config.groups=def.groups;}if(which==="formulas"){state.config.services=def.services;state.config.counters=def.counters;}if(which==="services"){state.config.services=def.services;state.config.serviceTypes=def.serviceTypes;}saveConfig();refreshAll();toast("Default ripristinati");}

/* ---------- ANALISI ---------- */
const PALETTE=["#1F5FBF","#F5A623","#2E9E5B","#7A3FB8","#D6453D","#0E7E74","#C77700","#475066","#B97E10","#6FA8FF"];
function chartBars(items,opts){opts=opts||{};const w=opts.w||560,rowH=26,lw=opts.labelW||140,pad=6;const max=Math.max(1,...items.map(i=>i.value));const barW=w-lw-54;const h=items.length*rowH+pad*2;let s="<svg viewBox='0 0 "+w+" "+h+"' xmlns='http://www.w3.org/2000/svg' font-family=\"inherit\">";let y=pad;items.forEach((it,k)=>{const bw=Math.max(it.value>0?2:0,Math.round(it.value/max*barW));const col=it.color||PALETTE[k%PALETTE.length];s+="<text x='0' y='"+(y+rowH/2+4)+"' font-size='12' fill='#1C2433'>"+esc(String(it.label).slice(0,22))+"</text>";s+="<rect x='"+lw+"' y='"+(y+4)+"' width='"+bw+"' height='"+(rowH-10)+"' rx='3' fill='"+col+"'/>";s+="<text x='"+(lw+bw+6)+"' y='"+(y+rowH/2+4)+"' font-size='12' font-weight='700' fill='#1C2433'>"+it.value+"</text>";y+=rowH;});if(!items.length)s+="<text x='0' y='20' font-size='12' fill='#6B7689'>Nessun dato</text>";return s+"</svg>";}
function chartDonut(segs){const total=segs.reduce((a,s)=>a+s.value,0)||1,R=54,C=2*Math.PI*R,cx=70,cy=70;let off=0,s="<svg viewBox='0 0 140 140' xmlns='http://www.w3.org/2000/svg'>";s+="<circle cx='"+cx+"' cy='"+cy+"' r='"+R+"' fill='none' stroke='#EEF1F6' stroke-width='20'/>";segs.forEach((sg,k)=>{const frac=sg.value/total,len=frac*C;s+="<circle cx='"+cx+"' cy='"+cy+"' r='"+R+"' fill='none' stroke='"+(sg.color||PALETTE[k%PALETTE.length])+"' stroke-width='20' stroke-dasharray='"+len+" "+(C-len)+"' stroke-dashoffset='"+(-off)+"' transform='rotate(-90 "+cx+" "+cy+")'/>";off+=len;});s+="<text x='70' y='66' text-anchor='middle' font-size='20' font-weight='700' fill='#16233B'>"+total+"</text><text x='70' y='84' text-anchor='middle' font-size='10' fill='#6B7689'>totale</text></svg>";return s;}
function donutLegend(segs){return "<div class='donutleg'>"+segs.map((s,k)=>"<span><i style='background:"+(s.color||PALETTE[k%PALETTE.length])+"'></i>"+esc(s.label)+" · "+s.value+"</span>").join("")+"</div>";}
function anScope(){const f=document.getElementById("anFiliale").value;return activeDrivers().filter(d=>!f||d.filiale===f);}
function renderAnalysis(){if(!isAdmin())return;
  const sel=document.getElementById("anFiliale");if(sel.dataset.init!=="1"){sel.innerHTML="<option value=''>Tutte le filiali</option>"+filiali().map(f=>"<option>"+esc(f)+"</option>").join("");sel.dataset.init="1";}
  const drv=anScope(),days=daysInMonth(YM);
  /* KPI */
  const det=drv.filter(d=>d.ctrType==="determinato").length;
  let scop=0;for(let d=1;d<=days;d++)for(const s of services()){const dl=deltaOf(s,d,drv);if(dl<0)scop+=dl;}
  document.getElementById("anKpis").innerHTML=kpi(drv.length,"DAS attivi")+kpi(det,"Contratti determinati")+kpi(scop,"Rotte scoperte (mese)");
  /* contratti per tipo (donut) */
  const ind=drv.length-det;const segs=[{label:"Indeterminato",value:ind,color:PALETTE[2]},{label:"Determinato",value:det,color:PALETTE[1]}];
  /* contratti per inquadramento (bar) */
  const byCtr={};drv.forEach(d=>byCtr[d.contratto]=(byCtr[d.contratto]||0)+1);const ctrItems=Object.entries(byCtr).map(([k,v])=>({label:k,value:v})).sort((a,b)=>b.value-a.value);
  /* assenze per tipo (bar) */
  const absCnt={};for(const d of drv)for(let dd=1;dd<=days;dd++){const c=getCode(d.id,dd);if(c&&codeCls(c)==="mal")absCnt[c]=(absCnt[c]||0)+1;}
  const absItems=Object.entries(absCnt).map(([k,v])=>({label:codeLabel(k)+" ("+k+")",value:v})).sort((a,b)=>b.value-a.value);
  /* DAS per filiale (bar) */
  const byFil={};activeDrivers().forEach(d=>byFil[d.filiale]=(byFil[d.filiale]||0)+1);const filItems=filiali().map(f=>({label:f,value:byFil[f]||0}));
  /* scoperture per service (bar, top) */
  const scopBy=services().map(s=>{let neg=0;for(let d=1;d<=days;d++){const dl=deltaOf(s,d,drv);if(dl<0)neg+=dl;}return{label:s.label,value:-neg};}).filter(i=>i.value>0).sort((a,b)=>b.value-a.value).slice(0,12);
  const card=(title,sub,body,span)=>"<div class='chartcard"+(span?" span2":"")+"'><h3>"+title+"</h3><p class='sub'>"+sub+"</p>"+body+"</div>";
  document.getElementById("anCharts").innerHTML=
    card("Contratti per tipo","Indeterminato vs determinato",chartDonut(segs)+donutLegend(segs))+
    card("Contratti per inquadramento","Numero di DAS per tipo di contratto",chartBars(ctrItems,{labelW:90}))+
    card("Assenze per tipo","Occorrenze nel mese",chartBars(absItems,{labelW:160}))+
    card("DAS per filiale","Distribuzione del personale",chartBars(filItems,{labelW:90}))+
    card("Scoperture per service","Somma delta negativi nel mese (top 12)",chartBars(scopBy,{labelW:130}),true);
}
function exportAnalysis(){const drv=anScope(),days=daysInMonth(YM);const rows=["Sezione;Voce;Valore"];const det=drv.filter(d=>d.ctrType==="determinato").length;rows.push("Contratti;Indeterminato;"+(drv.length-det));rows.push("Contratti;Determinato;"+det);const byCtr={};drv.forEach(d=>byCtr[d.contratto]=(byCtr[d.contratto]||0)+1);Object.entries(byCtr).forEach(([k,v])=>rows.push("Inquadramento;"+k+";"+v));const absCnt={};for(const d of drv)for(let dd=1;dd<=days;dd++){const c=getCode(d.id,dd);if(c&&codeCls(c)==="mal")absCnt[c]=(absCnt[c]||0)+1;}Object.entries(absCnt).forEach(([k,v])=>rows.push("Assenze;"+codeLabel(k)+" ("+k+");"+v));const byFil={};activeDrivers().forEach(d=>byFil[d.filiale]=(byFil[d.filiale]||0)+1);Object.entries(byFil).forEach(([k,v])=>rows.push("Filiale;"+k+";"+v));dl(rows.join("\n"),"analisi_"+YM+".csv");}
function dl(txt,name){const b=new Blob([txt],{type:"text/csv"});const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=name;a.click();URL.revokeObjectURL(a.href);}

/* ---------- REGISTRO (audit log) ---------- */
function renderLog(){if(!isAdmin())return;const q=(document.getElementById("qLog")?document.getElementById("qLog").value:"").toLowerCase();const log=(state.log||[]).slice().reverse().filter(e=>!q||((e.u+" "+e.a).toLowerCase().includes(q)));let h="<thead><tr><th style='width:150px'>Data / ora</th><th style='width:140px'>Utente</th><th>Azione</th></tr></thead><tbody>";if(!log.length)h+="<tr><td colspan='3' style='color:var(--muted)'>Nessuna voce nel registro.</td></tr>";for(const e of log){const dt=new Date(e.t);h+="<tr><td>"+dt.toLocaleString("it-IT",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})+"</td><td><b>"+esc(e.u)+"</b></td><td>"+esc(e.a)+"</td></tr>";}document.getElementById("logTbl").innerHTML=h+"</tbody>";}
function exportLog(){const rows=["DataOra;Utente;Azione"];for(const e of(state.log||[]))rows.push([new Date(e.t).toLocaleString("it-IT"),e.u,String(e.a).replace(/;/g,",")].join(";"));dl(rows.join("\n"),"registro_"+YM+".csv");}
function clearLog(){if(!isAdmin())return;if(!confirm("Svuotare il registro del mese "+YM+"?"))return;state.log=[];dirty();renderLog();toast("Registro svuotato");}

/* ---------- LEGENDA ---------- */
function renderLeg(){document.getElementById("legTbl").innerHTML="<tr><th>Codice</th><th>Descrizione</th><th>Categoria</th></tr>"+groupedCodes().map(g=>g.codes.map(c=>"<tr><td style='width:110px'><span class='chip' style='background:var(--"+g.cls+"-bg);color:var(--"+g.cls+")'>"+esc(c)+"</span></td><td>"+esc(codeLabel(c))+"</td><td style='color:var(--muted);font-size:.75rem'>"+esc(g.name)+"</td></tr>").join("")).join("");document.getElementById("ctrTbl").innerHTML="<tr><th>Codice</th><th>Inquadramento</th><th>Giorni/sett.</th><th>Giorni lavorativi</th></tr>"+contracts().map(c=>"<tr><td style='width:100px'><b>"+esc(c.code)+"</b></td><td>"+esc(c.label)+"</td><td>"+((c.workDays!=null?c.workDays:(c.defDays?c.defDays.length:0)))+"</td><td>"+(c.defDays||[]).map(n=>(WEEKDAYS.find(w=>w.n===n)||{}).l).join(" ")+"</td></tr>").join("");}

/* ---------- DATI & SYNC ---------- */
function exportJson(){const blob=new Blob([JSON.stringify(state,null,1)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="turni_"+YM+".json";a.click();URL.revokeObjectURL(a.href);}
function importJson(ev){const f=ev.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{try{const j=JSON.parse(r.result);if(!j.drivers||!j.schedule)throw 0;state=j;if(j.meta&&j.meta.month)YM=j.meta.month;migrate();if(state.config)localStorage.setItem("turniDSP_config",JSON.stringify(state.config));saveAll();refreshAll();toast("Importazione completata");}catch(e){toast("File non valido");}};r.readAsText(f);ev.target.value="";}
function resetMonth(){if(!isAdmin())return;if(!confirm("Azzerare turni e forecast di "+YM+"?"))return;state.schedule={};state.forecast={};dirty();logAction("Turni e forecast del mese azzerati");refreshAll();}
async function syncPush(){const url=apiUrl();if(!url)return;try{const r=await fetch(url+"?month="+YM,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(state)});const j=await r.json();document.getElementById("syncMsg").textContent=j.ok?"Salvato sul server ("+new Date().toLocaleTimeString("it-IT")+")":"Errore: "+(j.error||"sconosciuto");}catch(e){document.getElementById("syncMsg").textContent="Connessione fallita: "+e.message;}}
async function syncPull(){const url=apiUrl();if(!url)return;try{const r=await fetch(url+"?month="+YM);const j=await r.json();if(j&&j.drivers){state=j;migrate();if(state.config)localStorage.setItem("turniDSP_config",JSON.stringify(state.config));saveAll();refreshAll();document.getElementById("syncMsg").textContent="Dati scaricati dal server.";}else document.getElementById("syncMsg").textContent="Nessun dato sul server per "+YM+".";}catch(e){document.getElementById("syncMsg").textContent="Connessione fallita: "+e.message;}}
function apiUrl(){const u=document.getElementById("apiUrl").value.trim();if(u)localStorage.setItem("turniDSP_api",u);else toast("Inserisci l'URL dell'endpoint");return u;}

/* ---------- util ---------- */
