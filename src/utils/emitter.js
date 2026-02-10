export function createEmitter() {
  const subs = new Set();

  function subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    subs.add(fn);
    return () => subs.delete(fn);
  }

  function emit() {
    try {
      if (typeof window !== 'undefined' && window.__LOG_EMITS__) {
        try {
          const stack = (new Error()).stack || '';
          const lines = stack.split('\n').map(l => l.trim()).filter(Boolean);
          // Find first stack line outside this file (skip emit and wrapper frames)
          let callerLine = lines.find(l => !/emitter\.js/.test(l) && !/new Error/.test(l)) || lines[2] || lines[1] || lines[0] || '';
          // Attempt to extract function and location
          let caller = callerLine;
          try {
            const m = callerLine.match(/at\s+(.*?)\s+\((.*?):(\d+):(\d+)\)/) || callerLine.match(/at\s+(.*?):(\d+):(\d+)/);
            if (m) {
              if (m.length >= 5) caller = `${m[1]} @ ${m[2]}:${m[3]}`;
              else if (m.length >= 4) caller = `${m[1]}:${m[2]}`;
            }
          } catch (e) {}

          const time = Date.now();
          const subNames = Array.from(subs).slice(0, 10).map(fn => (fn && fn.name) ? fn.name : '<anonymous>');
          console.debug(`[Emitter] emit from ${caller} subscribers=${subs.size} time=${time}`);
          if (subNames.length) console.debug('[Emitter] subscribers sample', subNames);
          // Also print a short stack for context
          const short = lines.slice(2, 7).join('\n');
          if (short) console.debug(short);
        } catch (e) {}
      }
    } catch (e) {}

    for (const fn of subs) {
      try {
        fn();
      } catch (e) {
        console.error('[Emitter] subscriber error', e);
      }
    }
  }

  // Debug wrapper for DOM CustomEvent dispatches. When window.__LOG_EMITS__
  // is truthy, this will log dispatched event types + a short stack snippet.
  try {
    if (typeof window !== 'undefined' && typeof Document !== 'undefined' && Document.prototype && !Document.prototype.__emitWrapInstalled__) {
      const _origDispatch = Document.prototype.dispatchEvent;
      if (typeof _origDispatch === 'function') {
        Document.prototype.dispatchEvent = function (ev) {
          try {
            if (typeof window !== 'undefined' && window.__LOG_EMITS__) {
              try {
                const s = (new Error()).stack || '';
                const short = s.split('\n').slice(2, 7).join('\n');
                try { console.debug('[DOM emit]', String(ev?.type || ''), ev?.detail ?? null); } catch (e) {}
                try { console.debug(short); } catch (e) {}
              } catch (e) {}
            }
          } catch (e) {}
          return _origDispatch.call(this, ev);
        };
        Document.prototype.__emitWrapInstalled__ = true;
      }
    }
  } catch (e) {
    // ignore debug wrapper failures
  }

  return { subscribe, emit };
}
