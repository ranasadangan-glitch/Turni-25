/* TurniDSP — Sidebar utente
   Estratto dal monolite app.html: stesso scope globale, stesso comportamento.
   Ordine di caricamento definito in app.html (vedi fondo pagina). */
// ── Init sidebar user info ────────────────────────────────────────
function initSidebarUser() {
  const name = USER.full_name || USER.username || '—';
  const initials = name.split(' ').map(w=>w[0]||'').join('').slice(0,2).toUpperCase();
  $d('navAvatar').textContent = initials;
  $d('navUname').textContent  = name;
  $d('navRole').textContent   = { admin:'Amministratore', osm:'OSM', hr_manager:'HR Manager', team_leader:'Team Leader' }[USER.role] || USER.role;
  if(USER.role==='admin') document.body.classList.add('is-admin');
}

