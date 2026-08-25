/* TurniDSP — Ricerca globale + ricerca dashboard
   Estratto dal monolite app.html: stesso scope globale, stesso comportamento.
   Ordine di caricamento definito in app.html (vedi fondo pagina). */
// NOTE: the legacy debouncedSearch()/doSearch() pair (an older dashboard search
// bound to a removed #searchDd element) was removed — it was unreferenced and
// would have thrown on the missing element. The live global search below
// (debouncedGlobalSearch/doGlobalSearch → #searchDropdown) is the only one used.

// ── Users management ──────────────────────────────────────────────
// loadUsers() defined in SPA layer below
// createUser() defined in SPA layer below
// toggleUser() defined in SPA layer below
// resetPw() defined in SPA layer below

// ── Excel/PDF links ───────────────────────────────────────────────

function debouncedGlobalSearch(q) {
  clearTimeout(_gSearchTimer);
  if(!q||q.length<2){document.getElementById('searchDropdown').style.display='none';return;}
  _gSearchTimer = setTimeout(function(){doGlobalSearch(q);}, 280);
}
async function doGlobalSearch(q) {
  var dd = document.getElementById('searchDropdown');
  dd.style.display = 'block';
  dd.innerHTML = '<div class="sd-item" style="pointer-events:none;color:var(--text-muted)">Ricerca…</div>';
  try {
    var r = await TurniApi.search(q, 12);
    var icons = {employee:'👤',document:'📄',absence:'🏥'};
    dd.innerHTML = r.results.length
      ? r.results.map(function(x){
          var u = esc(x.url||'#');
          return '<a href="'+u+'" class="sd-item" onclick="return spaSearchGo(event,\''+u+'\')">'+
            '<span class="sd-icon">'+(icons[x.type]||'📌')+'</span>'+
            '<div class="flex-1"><div class="sd-title">'+esc(x.title)+'</div><div class="sd-sub">'+esc(x.subtitle||'')+'</div></div>'+
            '<span class="sd-type">'+x.type+'</span></a>';
        }).join('')
      : '<div class="sd-item" style="pointer-events:none;color:var(--text-muted)">Nessun risultato</div>';
  } catch {
    dd.innerHTML = '<div class="sd-item" style="pointer-events:none;color:var(--bad)">Errore ricerca</div>';
  }
}

// Route a global-search result IN-APP (no page reload), so search honours the
// single-shell SPA. navFromUrl() (notifications.js) maps the result URL to a
// section + profile; we only fall back to a hash if that ever fails.
window.spaSearchGo = function (ev, url) {
  if (ev && ev.preventDefault) ev.preventDefault();
  ['searchDropdown', 'searchDd'].forEach(function (id) { var d = document.getElementById(id); if (d) d.style.display = 'none'; });
  var box = document.getElementById('globalSearch') || document.getElementById('gSearch');
  if (box) box.value = '';
  if (!(typeof navFromUrl === 'function' && navFromUrl(url))) {
    try { location.hash = (url && url.charAt(0) === '#') ? url.slice(1) : (url || ''); } catch (e) {}
  }
  return false;
};

// ── Notifications ─────────────────────────────────────────────────
_notifOpen = false;
