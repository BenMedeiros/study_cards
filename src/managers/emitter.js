export function createEmitter() {
  const subs = new Set();

  function subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    subs.add(fn);
    return () => subs.delete(fn);
  }

  function emit() {
    for (const fn of subs) {
      try {
        fn();
      } catch (e) {
        console.error('[Emitter] subscriber error', e);
      }
    }
  }

  return { subscribe, emit };
}
