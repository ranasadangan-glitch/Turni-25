/* TurniDSP — Autocomplete
   A reusable, keyboard-navigable "type-ahead" picker to replace big <select>
   dropdowns (starts with the employee picker in Absences, reusable elsewhere).
   You type immediately; results filter live; ↑/↓ move, Enter selects, Esc closes.

   Usage:
     var ac = Autocomplete({
       mount: 'absEmpAc',                       // container id or element
       items: employees,
       placeholder: 'Cerca…',
       getId:      function(e){ return e.id; },
       getLabel:   function(e){ return e.last_name+' '+e.first_name; },   // main line
       getSublabel:function(e){ return '#'+e.employee_code+' · '+e.branch_code; }, // 2nd line
       filterFn:   function(e,q){ return hay(e).indexOf(q)>=0; },         // q is lowercased
       onSelect:   function(e){ ... },          // e is null when the field is cleared
       max: 50,
     });
     ac.setItems(list); ac.setValue(id); ac.getValue(); ac.getItem(); ac.clear(); ac.focus();
*/
(function (global) {
  'use strict';

  function injectCss() {
    if (document.getElementById('ac-css')) return;
    var s = document.createElement('style'); s.id = 'ac-css';
    s.textContent =
      '.ac-wrap{position:relative}' +
      '.ac-menu{position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:60;background:var(--surface-1);border:1px solid var(--border);border-radius:10px;box-shadow:var(--shadow-lg,0 8px 24px rgba(0,0,0,.18));max-height:264px;overflow-y:auto;padding:4px}' +
      '.ac-item{display:flex;flex-direction:column;gap:1px;padding:7px 10px;border-radius:7px;cursor:pointer}' +
      '.ac-item:hover,.ac-item.active{background:color-mix(in srgb,var(--brand) 14%,transparent)}' +
      '.ac-lbl{font-size:.86rem;font-weight:600}' +
      '.ac-sub{font-size:.72rem;color:var(--text-muted)}' +
      '.ac-empty{padding:12px;text-align:center;font-size:.8rem;color:var(--text-muted)}';
    document.head.appendChild(s);
  }

  function Autocomplete(opts) {
    injectCss();
    var mount = typeof opts.mount === 'string' ? document.getElementById(opts.mount) : opts.mount;
    if (!mount) throw new Error('Autocomplete: mount not found');

    var getId = opts.getId || function (it) { return it.id; };
    var getLabel = opts.getLabel || function (it) { return String(it); };
    var getSub = opts.getSublabel || function () { return ''; };
    var filterFn = opts.filterFn || function (it, q) { return (getLabel(it) || '').toLowerCase().indexOf(q) >= 0; };
    var onSelect = opts.onSelect || function () {};
    var max = opts.max || 50;
    // topLayer: render the menu in the browser top layer (Popover API) so it is
    // never clipped by a scrollable modal / overflow container. Default (false)
    // keeps the original in-flow absolute menu — callers like Absences are unchanged.
    var topLayer = !!opts.topLayer, _pv = false;

    var wrap = document.createElement('div'); wrap.className = 'ac-wrap';
    var input = document.createElement('input');
    input.className = 'inp'; input.type = 'text'; input.autocomplete = 'off';
    input.placeholder = opts.placeholder || '';
    var menu = document.createElement('div'); menu.className = 'ac-menu'; menu.style.display = 'none';
    wrap.appendChild(input);
    mount.innerHTML = ''; mount.appendChild(wrap);
    if (topLayer) {
      document.body.appendChild(menu);
      _pv = (typeof menu.showPopover === 'function');
      if (_pv) menu.setAttribute('popover', 'manual');
    } else {
      wrap.appendChild(menu);
    }

    var items = opts.items || [];
    var results = [], active = -1, selected = null;

    function _placeFixed() {
      var r = input.getBoundingClientRect();
      // inset/margin FIRST — inset is the shorthand for top/right/bottom/left, so
      // setting it after left/top would wipe them (that caused a left:0 menu).
      menu.style.position = 'fixed'; menu.style.inset = 'auto'; menu.style.margin = '0'; menu.style.zIndex = '2147483647';
      menu.style.left = r.left + 'px'; menu.style.right = 'auto'; menu.style.width = r.width + 'px';
      var h = menu.offsetHeight || 264, below = window.innerHeight - r.bottom - 6;
      if (h <= below || r.top < h) { menu.style.top = (r.bottom + 4) + 'px'; menu.style.bottom = 'auto'; }
      else { menu.style.top = 'auto'; menu.style.bottom = (window.innerHeight - r.top + 4) + 'px'; }
    }
    var _repos = null;
    function _bindRepos() { if (_repos) return; _repos = function () { if (menu.style.display !== 'none') _placeFixed(); }; window.addEventListener('scroll', _repos, true); window.addEventListener('resize', _repos); }
    function _unbindRepos() { if (!_repos) return; window.removeEventListener('scroll', _repos, true); window.removeEventListener('resize', _repos); _repos = null; }

    function open(q) {
      results = (q ? items.filter(function (it) { return filterFn(it, q); }) : items).slice(0, max);
      active = -1; renderMenu(); menu.style.display = 'block';
      if (topLayer) { if (_pv) { try { menu.showPopover(); } catch (e) { _pv = false; } } _placeFixed(); _bindRepos(); }
    }
    function close() {
      if (topLayer) { if (_pv) { try { if (menu.matches(':popover-open')) menu.hidePopover(); } catch (e) {} } _unbindRepos(); }
      menu.style.display = 'none'; active = -1;
    }
    function renderMenu() {
      if (!results.length) { menu.innerHTML = '<div class="ac-empty">Nessun risultato</div>'; return; }
      menu.innerHTML = results.map(function (it, i) {
        return '<div class="ac-item' + (i === active ? ' active' : '') + '" data-i="' + i + '">' +
          '<span class="ac-lbl">' + esc(getLabel(it)) + '</span>' +
          '<span class="ac-sub">' + esc(getSub(it) || '') + '</span></div>';
      }).join('');
    }
    function ensureVisible() {
      var node = menu.querySelector('.ac-item.active'); if (!node) return;
      var nt = node.offsetTop, nb = nt + node.offsetHeight;
      if (nt < menu.scrollTop) menu.scrollTop = nt;
      else if (nb > menu.scrollTop + menu.clientHeight) menu.scrollTop = nb - menu.clientHeight;
    }
    function choose(i) {
      var it = results[i]; if (!it) return;
      selected = it; input.value = getLabel(it); close(); onSelect(it);
    }

    input.addEventListener('input', function () {
      var q = input.value.trim().toLowerCase();
      selected = null;                          // typing clears the previous pick
      open(q); onSelect(null);
    });
    input.addEventListener('focus', function () { open(input.value.trim().toLowerCase()); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') {
        e.preventDefault(); if (menu.style.display === 'none') open(input.value.trim().toLowerCase());
        active = Math.min(results.length - 1, active + 1); renderMenu(); ensureVisible();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault(); active = Math.max(0, active - 1); renderMenu(); ensureVisible();
      } else if (e.key === 'Enter') {
        if (active >= 0) { e.preventDefault(); choose(active); }
      } else if (e.key === 'Escape') { close(); }
    });
    // mousedown (not click) so it fires before the input's blur.
    menu.addEventListener('mousedown', function (e) {
      var it = e.target.closest ? e.target.closest('.ac-item') : null;
      if (it) { e.preventDefault(); choose(+it.getAttribute('data-i')); }
    });
    document.addEventListener('click', function (e) { if (!wrap.contains(e.target) && !menu.contains(e.target)) close(); });

    return {
      setItems: function (a) { items = a || []; },
      setValue: function (id) {
        var it = items.filter(function (x) { return String(getId(x)) === String(id); })[0];
        selected = it || null; input.value = it ? getLabel(it) : ''; close();
      },
      getValue: function () { return selected ? getId(selected) : ''; },
      getItem: function () { return selected; },
      clear: function () { selected = null; input.value = ''; close(); },
      focus: function () { input.focus(); },
      input: input,
    };
  }

  global.Autocomplete = Autocomplete;
})(window);
