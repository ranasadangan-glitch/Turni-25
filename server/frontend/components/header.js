/* TurniDSP — Header (saluto)
   Estratto dal monolite app.html: stesso scope globale, stesso comportamento.
   Ordine di caricamento definito in app.html (vedi fondo pagina). */
// ── Greeting ──────────────────────────────────────────────────────
function setGreeting() {
  const h = new Date().getHours();
  const g = h<12?'Buongiorno':h<18?'Buon pomeriggio':'Buonasera';
  $d('pageTitle').textContent = g + ', ' + (USER.full_name||USER.username);
  $d('pageSub').textContent = new Date().toLocaleDateString('it-IT',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
}

