/* TurniDSP — Cross-module wiring
   The one place that connects domain events to the existing per-module
   refreshers. Because every write now emits `data:changed` from the API client
   (see api.js), a change made in ANY module automatically refreshes the others
   that depend on it — the Scheduler, the Home overview/KPIs and the Reports —
   without those modules calling each other directly.

   Loaded after the modules so their refresh functions exist. Everything is
   guarded + booted-checked, so it never touches a screen the user hasn't opened. */
(function (global) {
  'use strict';
  if (!global.AppBus) return;
  var B = global.AppBus;
  function safe(fn) { try { if (typeof fn === 'function') fn(); } catch (e) {} }

  // ── Auto-refresh dependent views when data changes anywhere ──────
  B.on('data:changed', function (e) {
    var r = (e && e.resource) || '';
    var touchesPeople = ['absences', 'employees', 'schedules', 'scheduler'].indexOf(r) >= 0;

    // Scheduler board reads employees + absences + schedules from the DB.
    if (touchesPeople && global._workspaceInited) safe(global.syncSchedulerFromDB);

    // Home overview + KPI strip (only while the scheduler section is open).
    if (global._workspaceInited && global._currentSection === 'scheduler') safe(global.refreshOverview);

    // Reports / analytics (only once that section has been opened).
    if (global._reportsInited && global._currentSection === 'reports') safe(global.renderReportCharts);
  });

  // ── Consistent, centralized API-error notifications ──────────────
  // Single throttled toast for network/API failures. Session-expiry and login
  // errors are handled by the auth layer, so they're skipped to avoid noise.
  var _lastErr = 0;
  B.on('api:error', function (e) {
    var msg = (e && e.error && e.error.message) || '';
    if (!msg || /Sessione scaduta|Credenziali/i.test(msg)) return;
    var now = Date.now();
    if (now - _lastErr < 1200) return;         // throttle error bursts into one toast
    _lastErr = now;
    if (typeof global.toast === 'function') global.toast(msg, 'bad');
  });
})(window);
