/* TurniDSP — Bootloader
   Estratto dal monolite app.html: stesso scope globale, stesso comportamento.
   Ordine di caricamento definito in app.html (vedi fondo pagina). */
document.addEventListener('DOMContentLoaded', function() {
  // The workspace (scheduler + overview strip) is the single home screen.
  // Wire tools after a tick (TurniApi is available)
  setTimeout(function() {
    try {
      var ym = new Date().toISOString().slice(0,7);
      var addDays = function(iso,n){var d=new Date(iso);d.setDate(d.getDate()+n);return d.toISOString().slice(0,10);};
      var tplEmp=document.getElementById('tplEmp');if(tplEmp) tplEmp.href=TurniApi.xlsxTemplateUrl('employees');
    } catch(e) {}
  }, 100);

  // Deep-link support. #dashboard is kept as a legacy alias that now
  // simply resolves to the scheduler workspace, since Dashboard lives
  // inside it as the overview strip rather than as its own route.
  // #employees/123 (e.g. from the retired employees.html#123 bookmarks)
  // opens the People section and, once loaded, that specific profile.
  var hashParts = location.hash.replace('#','').split('/');
  var hash = hashParts[0];
  if (hash === 'dashboard') hash = 'scheduler';
  // Default landing is the Dashboard (Home). #planning opens the planner.
  if (hash === 'planning') { go('scheduler'); }
  else if (hash === 'employees') { go('dipendenti'); }
  else if (hash === 'reports') { go('report'); }
  else if (hash === 'settings') { go('impostazioni'); }
  else { go('home'); }

  // Refresh notifications periodically
  loadNotifPanel();
  TurniApi.refreshNotifications && TurniApi.refreshNotifications().catch(function(){});
  setInterval(loadNotifPanel, 5*60*1000);

  // Set navSync
  document.getElementById('navSync').textContent = '🟢 PostgreSQL';
});


