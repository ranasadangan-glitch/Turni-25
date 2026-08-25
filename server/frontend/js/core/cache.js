/* TurniDSP — AppCache
   A small in-memory TTL cache used by the API client for slow-changing
   REFERENCE data (branches, service types, shift codes, contract types, roles).
   Switching between modules no longer re-hits the API for the same dropdown
   lists. Volatile business data (schedules, absences, employees) is deliberately
   NOT cached here — those go straight to the DB and are refreshed via events.

   Writes invalidate by key-prefix (a "tag"), so editing anything under /meta or
   a branch/service/config clears the stale reference lists automatically. */
(function (global) {
  'use strict';
  var store = Object.create(null);   // key -> { val, exp }

  function get(key) {
    var e = store[key];
    if (!e) return undefined;
    if (e.exp && e.exp < Date.now()) { delete store[key]; return undefined; }
    return e.val;
  }
  function set(key, val, ttlMs) { store[key] = { val: val, exp: ttlMs ? Date.now() + ttlMs : 0 }; return val; }
  function has(key) { return get(key) !== undefined; }
  function invalidate(prefix) {
    if (!prefix) { store = Object.create(null); return; }
    Object.keys(store).forEach(function (k) { if (k.indexOf(prefix) === 0) delete store[k]; });
  }
  // Return the cached value, or run producer() (a Promise) and cache its result.
  async function wrap(key, ttlMs, producer) {
    var hit = get(key);
    if (hit !== undefined) return hit;
    var val = await producer();
    set(key, val, ttlMs);
    return val;
  }

  global.AppCache = { get: get, set: set, has: has, invalidate: invalidate, wrap: wrap };
})(window);
