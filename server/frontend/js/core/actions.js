/* TurniDSP — delegated event dispatch (CSP Phase 2).
   Replaces inline on*= handlers without changing behavior. Elements carry
   data-act-<event>="name" plus plain data-* args; one document-level listener
   per event type walks up from the target to the nearest element bearing that
   attribute and calls the registered handler.

   The matched element is presented as BOTH `this` and `event.currentTarget`,
   so handlers that read either (e.g. popup positioning off currentTarget, or
   `boardDrop` using currentTarget.classList) behave exactly as the inline
   attribute did — where `this`/currentTarget were the element the handler was
   attached to, not the deepest clicked node. `event.target` is untouched.

   Registration is lazy-resolved at dispatch time, so handlers may reference
   globals defined by modules that load after this core. */
(function () {
  var reg = Object.create(null);   // event type -> { actionName -> fn(event, el) }

  function dispatch(type) {
    return function (e) {
      var start = e.target;
      if (!start || !start.closest) return;
      var el = start.closest('[data-act-' + type + ']');
      if (!el) return;
      var fn = reg[type] && reg[type][el.getAttribute('data-act-' + type)];
      if (!fn) return;
      // Shadow the (prototype) currentTarget getter with an own property so it
      // reports the matched element for the duration of the call, then remove it.
      var had = Object.prototype.hasOwnProperty.call(e, 'currentTarget');
      var prev = had ? e.currentTarget : undefined;
      try { Object.defineProperty(e, 'currentTarget', { configurable: true, value: el }); } catch (_) {}
      try {
        fn.call(el, e, el);
      } finally {
        try {
          if (had) Object.defineProperty(e, 'currentTarget', { configurable: true, value: prev });
          else delete e.currentTarget;
        } catch (_) {}
      }
    };
  }

  // Every event type the app delegates. Bubbling handlers only (all inline
  // on*= handlers are bubble-phase); focusout stands in for non-bubbling blur.
  var EVENTS = ['click', 'dblclick', 'contextmenu', 'change', 'input', 'keydown',
                'mousedown', 'paste', 'dragstart', 'dragend', 'dragover',
                'dragleave', 'drop', 'focusout'];
  EVENTS.forEach(function (t) { document.addEventListener(t, dispatch(t), false); });

  // Register a delegated handler. fn is called as fn.call(el, event, el).
  window.TurniActions = {
    on: function (type, name, fn) {
      (reg[type] || (reg[type] = Object.create(null)))[name] = fn;
    },
  };

  // ── Generic type-preserving call action ────────────────────────────────
  // Most former inline handlers were a single call `fn(a, b, …)`. Such an
  // element carries data-act-<event>="call", data-call="fn", and (optionally)
  // data-args as a JSON array — so numbers stay numbers and strings stay
  // strings, exactly as the literal args in the old attribute. These sentinels
  // reproduce the values the inline handler read from `this`/`event`:
  //   "@value"  -> el.value      "@checked" -> el.checked
  //   "@event"  -> the event     "@this"    -> el
  // The function is invoked with `this` = el (dispatcher also sets
  // event.currentTarget = el), matching the inline handler's `this`.
  function invoke(e, el) {
    var fn = el.getAttribute('data-call');
    if (!fn || typeof window[fn] !== 'function') return;
    var raw = el.getAttribute('data-args');
    var args = raw ? JSON.parse(raw) : [];
    for (var i = 0; i < args.length; i++) {
      var a = args[i];
      if (a === '@value') args[i] = el.value;
      else if (a === '@checked') args[i] = el.checked;
      else if (a === '@event') args[i] = e;
      else if (a === '@this') args[i] = el;
    }
    return window[fn].apply(el, args);
  }
  // Register the generic call for every delegated event type. Named actions
  // (e.g. board's "cell") coexist — dispatch keys off the data-act-<event>
  // VALUE, so "call" and "cell" never collide on the same event.
  EVENTS.forEach(function (t) { window.TurniActions.on(t, 'call', invoke); });

  // Self-contained toggle used by a few buttons that were onclick="this.classList.toggle('on')".
  window._toggleOn = function () { this.classList.toggle('on'); };

  // Build the delegation attributes for a single-call handler, HTML-attribute
  // safe. type is the event ('click', 'change', …); fn the global name; args an
  // optional array (JSON-encoded, so types survive; use the @-sentinels above
  // for value/checked/event/this).
  function ea(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;').replace(/</g, '&lt;');
  }
  window.actAttr = function (type, fn, args) {
    var s = ' data-act-' + type + '="call" data-call="' + fn + '"';
    if (args && args.length) s += ' data-args="' + ea(JSON.stringify(args)) + '"';
    return s;
  };
})();
