/* TurniDSP — Autenticazione JWT + bridge ruoli scheduler
   Estratto dal monolite app.html: stesso scope globale, stesso comportamento.
   Ordine di caricamento definito in app.html (vedi fondo pagina). */
/* ---------- init ---------- */

/* ════════════════════════════════════════════════════════════════
   TurniDSP SPA — Unified Single-Page Application
   Scheduler core + Dashboard + Router + Shared state
   ════════════════════════════════════════════════════════════════ */

// ── Auth guard ────────────────────────────────────────────────────
(function() {
  var tok = localStorage.getItem('turnidsp_token');
  var u = null; try { u = JSON.parse(localStorage.getItem('turnidsp_user')); } catch(e) {}
  if (!tok || !u) { location.replace('login.html'); return; }

  // Set user in globals
  var name = u.full_name || u.username || '—';
  var initials = name.split(' ').map(function(w){return w[0]||'';}).join('').slice(0,2).toUpperCase();
  document.getElementById('navAvatar').textContent = initials;
  document.getElementById('navUname').textContent = name;
  document.getElementById('navRole').textContent = {
    admin:'Amministratore', osm:'OSM', hr_manager:'HR Manager', team_leader:'Team Leader'
  }[u.role] || u.role;

  if (u.role === 'admin') {
    document.body.classList.add('is-admin');
  }

  // ── Init scheduler auth (mimics the IIFE from original scheduler) ──
  var platformAdmin = u.role === 'admin';
  loadMonth();
  if (platformAdmin) {
    ROLE = 'admin'; teamLocked = false; currentUser = u.full_name || u.username || 'admin';
    localStorage.setItem('turniDSP_role', 'admin'); saveSession();
  } else {
    var sess = null; try { sess = JSON.parse(localStorage.getItem('turniDSP_session')); } catch(e) {}
    if (sess && sess.role === 'team' && sess.locked && users().some(function(usr){ return usr.username === sess.user; })) {
      ROLE = 'team'; teamLocked = true; currentUser = sess.user; teamFiliale = sess.filiale;
    } else {
      ROLE = 'team'; teamLocked = false; currentUser = u.full_name || u.username || 'team';
    }
  }
  ensureTeamFiliale(); applyRole(); refreshFilSelects();
  // Don't call refreshAll() here — boot() below renders once the DOM is ready
})();

// ── Logout ────────────────────────────────────────────────────────
// doLogout() defined in SPA layer below


/* ─────────────────────────────────────────────────────────────────
   TurniDSP Dashboard — unified with platform.css
   ───────────────────────────────────────────────────────────────── */

// ── Auth guard ────────────────────────────────────────────────────
if (!(TurniApi.isLoggedIn && TurniApi.isLoggedIn() && TurniApi.user())) {
  location.replace('login.html');
}
TurniApi.startIdleTimeout && TurniApi.startIdleTimeout(30, () => {
  toast('Sessione scaduta', 'warn'); location.replace('login.html');
});
const USER = TurniApi.user();


function doLogout() { TurniApi.logout().catch(()=>{}); location.replace('login.html'); }
