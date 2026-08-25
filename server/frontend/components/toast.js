/* TurniDSP — Toast notifications
   Estratto dal monolite app.html: stesso scope globale, stesso comportamento.
   Ordine di caricamento definito in app.html (vedi fondo pagina). */
// toast(message, severity) — severity is optional: 'ok' | 'warn' | 'bad' (default: neutral)
// Fixed regression: previously targeted a single static #toast element that
// doesn't exist in this DOM (only #toast-container does), so every call
// silently threw and did nothing. Now creates one toast per call and queues
// it into #toast-container, matching platform.css's .toast/.toast.ok/.warn/.bad.
function toast(m, severity) {
  var container = document.getElementById('toast-container');
  if (!container) return;
  var el = document.createElement('div');
  el.className = 'toast' + (severity ? ' ' + severity : '');
  el.textContent = m;
  container.appendChild(el);
  setTimeout(function () { el.remove(); }, 2400);
}
