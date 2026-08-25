/* TurniDSP — Loading overlay
   Estratto dal monolite app.html: stesso scope globale, stesso comportamento.
   Ordine di caricamento definito in app.html (vedi fondo pagina). */
function showLoadingOverlay(show) {
  var ov = document.getElementById('dbLoadOverlay');
  if (show && !ov) {
    ov = document.createElement('div'); ov.id = 'dbLoadOverlay';
    ov.style.cssText = 'position:fixed;top:65px;left:50%;transform:translateX(-50%);background:var(--card);border:1px solid var(--line);border-radius:10px;padding:9px 18px;font-size:.8rem;font-weight:600;color:var(--brand);box-shadow:var(--shadow-lg);z-index:400;display:flex;align-items:center;gap:7px';
    ov.innerHTML = '<span style="animation:spin 1s linear infinite;display:inline-block">⟳</span> Caricamento da database…';
    document.body.appendChild(ov);
  } else if (!show && ov) ov.remove();
}

var _hintTimer = null;
