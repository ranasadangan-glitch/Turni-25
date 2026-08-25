/* TurniDSP — Stato applicativo centralizzato
   Estratto dal monolite app.html: stesso scope globale, stesso comportamento.
   Ordine di caricamento definito in app.html (vedi fondo pagina). */

/* AppState: UNICO punto di lettura dello stato. I getter fanno da proxy
   alle variabili vive dei moduli — nessuna duplicazione di stato. */
var AppState = {
  get currentWorkspace() { return (typeof _currentSection !== 'undefined') ? _currentSection : null; },
  get currentUser()      { return (typeof USER !== 'undefined') ? USER : null; },
  get month()            { return (typeof YM !== 'undefined') ? YM : null; },
  get scheduler()        { return (typeof state !== 'undefined') ? state : null; },
  get schedules()        { return (typeof state !== 'undefined' && state) ? state.schedule : null; },
  get forecast()         { return (typeof state !== 'undefined' && state) ? state.forecast : null; },
  get employees()        { return (typeof _employees !== 'undefined') ? _employees : []; },
  get branches()         { return (typeof _branches  !== 'undefined') ? _branches  : []; },
  get kpi()              { return (typeof _kpiData   !== 'undefined') ? _kpiData   : null; },
  get filters()          { var g=function(id){var e=document.getElementById(id);return e?e.value:'';}; return { search:g('q'), branch:g('fFiliale'), service:g('fService'), status:g('fStato') }; },
  get permissions()      { return { platformRole:(this.currentUser||{}).role||null, schedulerRole:(typeof ROLE!=='undefined')?ROLE:null, isAdmin:(typeof isAdmin==='function')?isAdmin():false }; },
};
