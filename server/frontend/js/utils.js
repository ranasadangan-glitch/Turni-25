/* TurniDSP — Utils condivise (esc, $d, fmt, animateCount)
   Estratto dal monolite app.html: stesso scope globale, stesso comportamento.
   Ordine di caricamento definito in app.html (vedi fondo pagina). */
function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));}

// ── Helpers ───────────────────────────────────────────────────────
const $d = id => document.getElementById(id);
// esc() reused from scheduler core
const fmt = d => d ? new Date(d).toLocaleDateString('it-IT') : '—';
const fmtTs = d => d ? new Date(d).toLocaleString('it-IT',{dateStyle:'short',timeStyle:'short'}) : '—';
const today = () => new Date().toISOString().slice(0,10);

// toast() and _toastTimer are defined in scheduler core

function animateCount(el, target) {
  const dur=600, t0=performance.now();
  const step=t=>{ const p=Math.min((t-t0)/dur,1); el.textContent=Math.round(target*p); if(p<1)requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

// ── animateCount: used by KPI cards to count up to their value ────
