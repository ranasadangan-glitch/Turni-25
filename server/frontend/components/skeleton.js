/* TurniDSP — Skeleton
   Shimmer placeholders shown while data loads, so the UI feels instant instead
   of flashing empty. Pure HTML-string builders + one injected stylesheet
   (theme-aware, uses the app's --border / --surface variables). */
(function (global) {
  'use strict';
  function css() {
    if (document.getElementById('skl-css')) return;
    var s = document.createElement('style');
    s.id = 'skl-css';
    s.textContent =
      '@keyframes skl-sh{0%{background-position:-420px 0}100%{background-position:420px 0}}' +
      '.skl{display:block;border-radius:6px;background:linear-gradient(90deg,var(--border) 25%,var(--surface-2,rgba(125,125,125,.12)) 37%,var(--border) 63%);background-size:840px 100%;animation:skl-sh 1.3s ease-in-out infinite}' +
      '.skl-row{display:flex;gap:12px;align-items:center;padding:11px 4px;border-bottom:1px solid var(--border)}' +
      '.skl-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}';
    document.head.appendChild(s);
  }
  function line(w, h) { return '<span class="skl" style="width:' + (w || '100%') + ';height:' + (h || 12) + 'px"></span>'; }
  function table(rows, cols) {
    css(); rows = rows || 8; cols = cols || 5;
    var out = '';
    for (var r = 0; r < rows; r++) {
      out += '<div class="skl-row">';
      for (var c = 0; c < cols; c++) out += line(c === 0 ? '22px' : (55 + (c % 3) * 22) + '%', 12);
      out += '</div>';
    }
    return out;
  }
  function cards(n) {
    css(); n = n || 5;
    var o = '<div class="skl-cards">';
    for (var i = 0; i < n; i++) o += '<div class="card card-pad">' + line('45%', 10) + '<div style="height:8px"></div>' + line('65%', 22) + '</div>';
    return o + '</div>';
  }
  global.Skeleton = { css: css, line: line, table: table, cards: cards };
})(window);
