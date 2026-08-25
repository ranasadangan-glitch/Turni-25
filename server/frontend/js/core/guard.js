/* TurniDSP — AppGuard
   Unsaved-changes protection. Any module with a form/editor that holds unsaved
   edits registers a checker under its scope; the guard then warns the user
   before they lose that work — both when closing the tab (beforeunload) and when
   switching modules inside the SPA (the router calls confirmLeave()).

   Modules opt IN. The scheduler board is intentionally NOT registered here: it
   autosaves to PostgreSQL, so there is nothing to lose. */
(function (global) {
  'use strict';
  var checkers = [];   // [{ scope, fn }]

  function register(scope, fn) {
    unregister(scope);
    checkers.push({ scope: scope, fn: fn });
    return function () { unregister(scope); };
  }
  function unregister(scope) { checkers = checkers.filter(function (c) { return c.scope !== scope; }); }

  function isDirty() { return checkers.some(function (c) { try { return !!c.fn(); } catch (e) { return false; } }); }
  function dirtyScopes() {
    return checkers.filter(function (c) { try { return !!c.fn(); } catch (e) { return false; } })
                   .map(function (c) { return c.scope; });
  }
  // True when it is safe to leave: either nothing is dirty, or the user confirms.
  function confirmLeave(msg) {
    if (!isDirty()) return true;
    return global.confirm(msg || 'Ci sono modifiche non salvate. Vuoi uscire senza salvarle?');
  }

  window.addEventListener('beforeunload', function (e) {
    if (isDirty()) { e.preventDefault(); e.returnValue = ''; return ''; }
  });

  global.AppGuard = { register: register, unregister: unregister, isDirty: isDirty, dirtyScopes: dirtyScopes, confirmLeave: confirmLeave };
})(window);
