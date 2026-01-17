export function nowIso() {
  return new Date().toISOString();
}

export function uuid() {
  // Good enough for local ids.
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

export function nowMs() {
  return performance.now();
}
