import { nowMs, parseHashRoute } from './helpers.js';

// Keep a simple nesting stack so logs show call structure.
const _stack = [];

function _readHashFlag() {
  try {
    const route = parseHashRoute(location.hash);
    const v = route?.query?.get('timing');
    if (v === null) return null;
    const s = String(v).trim().toLowerCase();
    if (s === '' || s === '1' || s === 'true' || s === 'on' || s === 'yes') return true;
    if (s === '0' || s === 'false' || s === 'off' || s === 'no') return false;
    return null;
  } catch {
    return null;
  }
}

export function isTimingEnabled() {
  try {
    // Allow a one-off override from devtools: window.__TIMING_ENABLED__ = true/false
    if (typeof window !== 'undefined' && typeof window.__TIMING_ENABLED__ === 'boolean') {
      return window.__TIMING_ENABLED__;
    }
  } catch {
    // ignore
  }

  // If a store is exposed on window, read the persisted setting.
  try {
    const sm = (typeof window !== 'undefined' && window.__STORE__ && window.__STORE__.settings) ? window.__STORE__.settings : null;
    if (sm && typeof sm.isReady === 'function' && sm.isReady() && typeof sm.get === 'function') {
      return !!sm.get('shell.timingEnabled', { consumerId: 'timing' });
    }
  } catch {
    // ignore
  }

  const hash = _readHashFlag();
  if (hash !== null) return hash;

  return false;
}

export function setTimingEnabled(enabled) {
  const val = !!enabled;
  try {
    const sm = (typeof window !== 'undefined' && window.__STORE__ && window.__STORE__.settings) ? window.__STORE__.settings : null;
    if (sm && typeof sm.set === 'function') {
      sm.set('shell.timingEnabled', val, { consumerId: 'timing', immediate: true });
    }
  } catch {
    // ignore
  }
  try {
    // Also set a non-persisted override for current session.
    window.__TIMING_ENABLED__ = val;
  } catch {
    // ignore
  }
  return val;
}

function _indent() {
  return '  '.repeat(Math.max(0, _stack.length));
}

function _fmtMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return 'NaNms';
  if (n >= 1000) return `${(n / 1000).toFixed(2)}s`;
  return `${n.toFixed(1)}ms`;
}

/**
 * Time a sync or async operation.
 *
 * When enabled, logs:
 * - "X started"
 * - "X finished in Yms"
 */
export function timed(label, fn, opts = {}) {
  const enabled = (typeof opts.enabled === 'boolean') ? opts.enabled : isTimingEnabled();
  if (!enabled || typeof fn !== 'function') {
    return (typeof fn === 'function') ? fn() : undefined;
  }

  const name = String(label || 'operation');
  const prefix = _indent();
  const start = nowMs();

  try {
    console.info(`${prefix}${name} started`);
  } catch {
    // ignore
  }

  _stack.push(name);

  const finishOk = () => {
    const dur = nowMs() - start;
    _stack.pop();
    const endPrefix = _indent();
    try {
      console.info(`${endPrefix}${name} finished in ${_fmtMs(dur)}`);
    } catch {
      // ignore
    }
  };

  const finishErr = (err) => {
    const dur = nowMs() - start;
    _stack.pop();
    const endPrefix = _indent();
    try {
      console.info(`${endPrefix}${name} failed in ${_fmtMs(dur)}`);
    } catch {
      // ignore
    }
    throw err;
  };

  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(
        (v) => {
          finishOk();
          return v;
        },
        (e) => finishErr(e)
      );
    }
    finishOk();
    return result;
  } catch (err) {
    return finishErr(err);
  }
}

// Convenience aliases when you want explicit intent in call sites.
export const timedAsync = timed;
export const timedSync = timed;
