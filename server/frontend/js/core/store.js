/* TurniDSP — AppStore
   Centralized, PERSISTED UI state shared across modules. Two layers:

     1. Global context   — the dimensions every module cares about: the selected
        branch (filiale), the month, and the global search text. Changing one
        broadcasts on AppBus so all open modules re-align.
     2. Per-module view  — each module's own filters / sort / page, stored under
        its scope name. This is what makes filters, sorting and search survive
        when you switch modules and come back (a core enterprise-UX expectation).

   Persisted to localStorage (debounced) so it also survives a reload. Reads go
   through AppState (the live proxy in state.js) for engine data; AppStore owns
   only the user's VIEW preferences, never business data. */
(function (global) {
  'use strict';
  var LS = 'turniDSP_ui';
  var data = load();

  function load() { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch (e) { return {}; } }
  var _t = null;
  function persist() {
    clearTimeout(_t);
    _t = setTimeout(function () { try { localStorage.setItem(LS, JSON.stringify(data)); } catch (e) {} }, 150);
  }

  // ── Global context ───────────────────────────────────────────────
  function get(key, dflt) { return (key in data) ? data[key] : dflt; }
  function set(key, val) {
    if (data[key] === val) return val;                 // no-op keeps events quiet
    data[key] = val; persist();
    if (global.AppBus) AppBus.emit('store:' + key, val);
    return val;
  }
  // Subscribe to one global key. Returns an unsubscribe handle.
  function subscribe(key, fn) { return global.AppBus ? AppBus.on('store:' + key, fn) : function () {}; }

  // ── Per-module view state ────────────────────────────────────────
  function view(scope) {
    var k = 'view:' + scope;
    return data[k] || (data[k] = {});
  }
  function setView(scope, patch) {
    var v = view(scope), changed = false;
    Object.keys(patch || {}).forEach(function (k) { if (v[k] !== patch[k]) { v[k] = patch[k]; changed = true; } });
    if (changed) { persist(); if (global.AppBus) AppBus.emit('view:' + scope, v); }
    return v;
  }

  global.AppStore = {
    get: get, set: set, subscribe: subscribe, view: view, setView: setView, _data: data,
    // The three cross-module dimensions, as convenience accessors.
    get branch() { return get('branch', null); }, set branch(v) { set('branch', v); },
    get month()  { return get('month', null);  }, set month(v)  { set('month', v); },
    get search() { return get('search', '');   }, set search(v) { set('search', v); },
  };
})(window);
