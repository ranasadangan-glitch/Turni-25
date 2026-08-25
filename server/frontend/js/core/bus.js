/* TurniDSP — AppBus
   The application-wide event bus: the single backbone that lets every module
   react to what happens elsewhere WITHOUT importing or calling each other
   directly. A module that changes data emits an event; interested modules
   subscribe. This replaces the old ad-hoc pattern of one module reaching into
   another (e.g. absences calling syncSchedulerFromDB()).

   Synchronous, tiny, dependency-free. Loaded before api.js so it's available
   the moment the first request completes. */
(function (global) {
  'use strict';
  var listeners = Object.create(null);   // event name -> [fn]

  function on(evt, fn) {
    (listeners[evt] || (listeners[evt] = [])).push(fn);
    return function off() { remove(evt, fn); };     // returns an unsubscribe handle
  }
  function remove(evt, fn) {
    var a = listeners[evt]; if (!a) return;
    listeners[evt] = a.filter(function (f) { return f !== fn; });
  }
  function once(evt, fn) {
    var un = on(evt, function (p, e) { un(); fn(p, e); });
    return un;
  }
  function emit(evt, payload) {
    var a = listeners[evt] ? listeners[evt].slice() : [];
    for (var i = 0; i < a.length; i++) {
      try { a[i](payload, evt); }
      catch (e) { if (global.console) console.error('[AppBus] "' + evt + '" listener failed:', e); }
    }
    // "*" listeners receive every event (used by the notification center / logs).
    var w = listeners['*'] ? listeners['*'].slice() : [];
    for (var j = 0; j < w.length; j++) { try { w[j](payload, evt); } catch (e) {} }
  }

  var AppBus = { on: on, off: remove, once: once, emit: emit, _listeners: listeners };

  // Canonical event names — reference these instead of raw strings to avoid typos.
  AppBus.EVT = {
    ROUTE_CHANGE:    'route:change',     // { section, prev }
    DATA_CHANGED:    'data:changed',     // { resource, action, path }  (+ data:<resource>:changed)
    API_ERROR:       'api:error',        // { method, path, error }
    BRANCH_CHANGED:  'store:branch',     // string
    MONTH_CHANGED:   'store:month',      // string
    SEARCH_CHANGED:  'store:search',     // string
  };

  global.AppBus = AppBus;
})(window);
