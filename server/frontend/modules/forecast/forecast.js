/* TurniDSP — Forecast card
   Estratto dal monolite app.html: stesso scope globale, stesso comportamento.
   Ordine di caricamento definito in app.html (vedi fondo pagina). */
function renderForecastCard(d) {
  const fc = d.forecast||{};
  const ok = fc.delta>=0;
  const pct = fc.forecast ? Math.min(100, Math.round(fc.planned/fc.forecast*100)) : 0;
  $d('fcContent').innerHTML = `
    <div class="flex gap-4" style="margin-bottom:10px">
      <div><div class="text-xs text-muted">Forecast</div><div style="font-size:1.6rem;font-weight:800">${fc.forecast||0}</div></div>
      <div><div class="text-xs text-muted">Pianificati</div><div style="font-size:1.6rem;font-weight:800">${fc.planned||0}</div></div>
      <div><div class="text-xs text-muted">Delta</div><div style="font-size:1.6rem;font-weight:800;color:${ok?'var(--ok)':'var(--bad)'}">${fc.delta>0?'+':''}${fc.delta||0}</div></div>
    </div>
    <div class="prog-wrap" style="height:7px"><div class="prog-bar" style="width:${pct}%;background:${ok?'var(--ok)':'var(--bad)'}"></div></div>
    <div class="text-xs text-muted mt-2">${pct}% rispetto al forecast</div>`;
}

