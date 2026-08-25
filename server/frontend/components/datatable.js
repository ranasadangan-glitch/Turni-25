/* TurniDSP — DataTable
   ONE reusable table for every module (Absences, Employees, Documents, Audit,
   Reports…). Gives every list the same behaviour for free: sortable headers,
   client-side pagination (fast for 1000+ rows — only one page is in the DOM),
   optional row selection with a select-all, per-row action cells, a skeleton
   loading state and an empty state. Sort + page can be persisted per module via
   AppStore so they survive navigation.

   All interaction is wired with event delegation on the mount element, so the
   component is self-contained — no globals to define per table. Row-action
   buttons may still use inline onclick to call the owning module's handlers
   (that stays the module's business, DataTable just renders the cell).

   Usage:
     var dt = DataTable({
       mount: 'absTbl',                       // container id or element
       scope: 'absences',                     // optional: persist sort+page
       columns: [
         { key:'name', label:'Dipendente', sortable:true,
           sortValue:function(r){return name(r).toLowerCase();},
           render:function(r){return '<b>'+esc(name(r))+'</b>';} },
         ...
       ],
       rowId: function(r){ return r.id; },
       pageSize: 25,
       selectable: true,
       onSelect: function(ids){ ... },
       rowActions: function(r){ return '<button ...>✏️</button>'; },
       rowClass: function(r){ return r.flagged ? 'is-flag' : ''; },
       onRowClick: function(r,ev){ ... },
       empty: 'Nessun dato',
     });
     dt.setData(rows); dt.setLoading(true); dt.getSelected(); dt.clearSelection();
*/
(function (global) {
  'use strict';

  function injectCss() {
    if (document.getElementById('dt-css')) return;
    var s = document.createElement('style'); s.id = 'dt-css';
    s.textContent =
      '.dt-wrap{overflow-x:auto}' +
      '.dt-foot{display:flex;align-items:center;gap:10px;justify-content:flex-end;padding:10px 4px;font-size:12px;color:var(--text-muted);flex-wrap:wrap}' +
      '.dt-foot .dt-page-info{margin-right:auto}' +
      '.dt-foot button{border:1px solid var(--border);background:transparent;color:var(--text);border-radius:6px;padding:4px 10px;cursor:pointer}' +
      '.dt-foot button:disabled{opacity:.4;cursor:default}' +
      'th.dt-sortable{cursor:pointer;user-select:none;white-space:nowrap}' +
      'th.dt-sortable:hover{color:var(--brand)}' +
      'th.dt-sortable .dt-arrow{opacity:.5;font-size:10px}' +
      'tr.dt-selrow{background:color-mix(in srgb,var(--brand) 10%,transparent)}';
    document.head.appendChild(s);
  }

  function DataTable(opts) {
    injectCss();
    var el = typeof opts.mount === 'string' ? document.getElementById(opts.mount) : opts.mount;
    if (!el) throw new Error('DataTable: mount not found');

    var cols = opts.columns || [];
    var rowId = opts.rowId || function (r) { return r.id; };
    var pageSize = opts.pageSize == null ? 25 : opts.pageSize;
    var scope = opts.scope || null;
    var saved = scope && global.AppStore ? AppStore.view('dt:' + scope) : {};

    var state = {
      data: opts.data || [],
      loading: !!opts.loading,
      sortKey: saved.sortKey || opts.sortKey || null,
      sortDir: saved.sortDir || opts.sortDir || 1,
      page: saved.page || 1,
      sel: Object.create(null),
    };

    function persist() { if (scope && global.AppStore) AppStore.setView('dt:' + scope, { sortKey: state.sortKey, sortDir: state.sortDir, page: state.page }); }

    function sorted() {
      if (!state.sortKey) return state.data.slice();
      var col = cols.filter(function (c) { return c.key === state.sortKey; })[0];
      var val = (col && col.sortValue) || function (r) { return r[state.sortKey]; };
      return state.data.slice().sort(function (a, b) {
        var x = val(a), y = val(b);
        return (x > y ? 1 : x < y ? -1 : 0) * state.sortDir;
      });
    }
    function pageCount(n) { return pageSize ? Math.max(1, Math.ceil(n / pageSize)) : 1; }

    function render() {
      var colspan = cols.length + (opts.selectable ? 1 : 0) + (opts.rowActions ? 1 : 0);
      if (state.loading) {
        el.innerHTML = '<div class="dt-wrap">' + (global.Skeleton ? Skeleton.table(Math.min(pageSize || 8, 8), colspan) : 'Caricamento…') + '</div>';
        return;
      }
      var rows = sorted();
      var pc = pageCount(rows.length);
      if (state.page > pc) state.page = pc;
      var start = pageSize ? (state.page - 1) * pageSize : 0;
      var pageRows = pageSize ? rows.slice(start, start + pageSize) : rows;

      var allOnPageSel = pageRows.length && pageRows.every(function (r) { return state.sel[rowId(r)]; });
      var head = '<div class="dt-wrap"><table class="tbl"><thead><tr>';
      if (opts.selectable) head += '<th style="width:28px"><input type="checkbox" data-dt="all" ' + (allOnPageSel ? 'checked' : '') + '></th>';
      cols.forEach(function (c) {
        var arrow = '';
        if (c.sortable) arrow = '<span class="dt-arrow"> ' + (state.sortKey === c.key ? (state.sortDir > 0 ? '▲' : '▼') : '⇅') + '</span>';
        head += '<th' + (c.sortable ? ' class="dt-sortable" data-dt="sort" data-key="' + c.key + '"' : '') +
                (c.width ? ' style="width:' + c.width + '"' : '') +
                (c.align ? ' style="text-align:' + c.align + '"' : '') + '>' + (c.label || '') + arrow + '</th>';
      });
      if (opts.rowActions) head += '<th></th>';
      head += '</tr></thead><tbody>';

      var bodyHtml;
      if (!rows.length) {
        bodyHtml = '<tr><td colspan="' + colspan + '" class="text-muted" style="padding:28px;text-align:center">' + (opts.empty || 'Nessun dato') + '</td></tr>';
      } else {
        bodyHtml = pageRows.map(function (r) {
          var id = rowId(r), extra = opts.rowClass ? (opts.rowClass(r) || '') : '';
          var tr = '<tr data-id="' + id + '" class="' + (state.sel[id] ? 'dt-selrow ' : '') + extra + '">';
          if (opts.selectable) tr += '<td><input type="checkbox" data-dt="row" data-id="' + id + '" ' + (state.sel[id] ? 'checked' : '') + '></td>';
          cols.forEach(function (c) {
            var content = c.render ? c.render(r) : (r[c.key] == null ? '' : String(r[c.key]));
            tr += '<td' + (c.cls ? ' class="' + c.cls + '"' : '') + (c.align ? ' style="text-align:' + c.align + '"' : '') + '>' + content + '</td>';
          });
          if (opts.rowActions) tr += '<td style="white-space:nowrap;text-align:right">' + (opts.rowActions(r) || '') + '</td>';
          return tr + '</tr>';
        }).join('');
      }

      var foot = '';
      if (pageSize && rows.length > pageSize) {
        foot = '<div class="dt-foot"><span class="dt-page-info">' + (start + 1) + '–' + Math.min(start + pageSize, rows.length) + ' di ' + rows.length + '</span>' +
          '<button data-dt="first" ' + (state.page <= 1 ? 'disabled' : '') + '>«</button>' +
          '<button data-dt="prev" ' + (state.page <= 1 ? 'disabled' : '') + '>‹</button>' +
          '<span>Pag. ' + state.page + ' / ' + pc + '</span>' +
          '<button data-dt="next" ' + (state.page >= pc ? 'disabled' : '') + '>›</button>' +
          '<button data-dt="last" ' + (state.page >= pc ? 'disabled' : '') + '>»</button></div>';
      } else if (rows.length) {
        foot = '<div class="dt-foot"><span class="dt-page-info">' + rows.length + ' element' + (rows.length === 1 ? 'o' : 'i') + '</span></div>';
      }

      el.innerHTML = head + bodyHtml + '</tbody></table>' + foot + '</div>';
    }

    function fireSelect() { if (opts.onSelect) opts.onSelect(getSelected()); }
    function getSelected() { return Object.keys(state.sel).filter(function (k) { return state.sel[k]; }); }

    // ── Event delegation (wired once) ──────────────────────────────
    el.addEventListener('click', function (e) {
      var th = e.target.closest && e.target.closest('[data-dt="sort"]');
      if (th && el.contains(th)) {
        var key = th.getAttribute('data-key');
        if (state.sortKey === key) state.sortDir = -state.sortDir; else { state.sortKey = key; state.sortDir = 1; }
        persist(); render(); return;
      }
      var pg = e.target.closest && e.target.closest('[data-dt="first"],[data-dt="prev"],[data-dt="next"],[data-dt="last"]');
      if (pg && el.contains(pg)) {
        var act = pg.getAttribute('data-dt'), pc = pageCount(sorted().length);
        if (act === 'first') state.page = 1; else if (act === 'prev') state.page = Math.max(1, state.page - 1);
        else if (act === 'next') state.page = Math.min(pc, state.page + 1); else state.page = pc;
        persist(); render(); return;
      }
      if (opts.onRowClick) {
        var tr = e.target.closest && e.target.closest('tr[data-id]');
        if (tr && el.contains(tr) && !e.target.closest('input,button,a,[data-dt]')) {
          var row = state.data.filter(function (r) { return String(rowId(r)) === tr.getAttribute('data-id'); })[0];
          if (row) opts.onRowClick(row, e);
        }
      }
    });
    el.addEventListener('change', function (e) {
      var t = e.target;
      if (t.getAttribute && t.getAttribute('data-dt') === 'row') {
        state.sel[t.getAttribute('data-id')] = t.checked; render(); fireSelect(); return;
      }
      if (t.getAttribute && t.getAttribute('data-dt') === 'all') {
        var rows = sorted();
        var start = pageSize ? (state.page - 1) * pageSize : 0;
        var pageRows = pageSize ? rows.slice(start, start + pageSize) : rows;
        pageRows.forEach(function (r) { state.sel[rowId(r)] = t.checked; });
        render(); fireSelect(); return;
      }
    });

    // ── Public instance API ────────────────────────────────────────
    var api = {
      setData: function (rows) { state.data = rows || []; render(); return api; },
      render: render,
      setLoading: function (b) { state.loading = !!b; render(); return api; },
      getSelected: getSelected,
      clearSelection: function () { state.sel = Object.create(null); render(); fireSelect(); return api; },
      selectAll: function (on) { (on ? state.data : []).forEach(function (r) { state.sel[rowId(r)] = true; }); if (!on) state.sel = Object.create(null); render(); fireSelect(); return api; },
      getState: function () { return { sortKey: state.sortKey, sortDir: state.sortDir, page: state.page }; },
    };
    render();
    return api;
  }

  global.DataTable = DataTable;
})(window);
