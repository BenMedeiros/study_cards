/**
 * Backend detection and time utilities
 */

/**
 * Detect backend availability
 */
export async function detectBackend() {
  const url = './api/health';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 600);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return { connected: false, label: 'Backend: not connected' };
    const json = await res.json().catch(() => null);
    const mode = json?.mode ?? 'local';
    return { connected: true, label: `Backend: connected (${mode})` };
  } catch {
    return { connected: false, label: 'Backend: not connected' };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Get current time as ISO string
 */
export function nowIso() {
  return new Date().toISOString();
}

/**
 * Generate UUID (good enough for local IDs)
 */
export function uuid() {
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Get high-resolution timestamp in milliseconds
 */
export function nowMs() {
  return performance.now();
}

/**
 * Format a duration in milliseconds into a compact human-readable string.
 * Examples: 65000 -> "1m 5s", 3723000 -> "1h 2m".
 */
export function formatDurationMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '0s';

  const totalSec = Math.floor(n / 1000);
  const sec = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const min = totalMin % 60;
  const hr = Math.floor(totalMin / 60);

  const parts = [];
  if (hr) parts.push(`${hr}h`);
  if (min || (hr && sec)) parts.push(`${min}m`);
  if (!hr && sec) parts.push(`${sec}s`);
  return parts.join(' ');
}

/**
 * Format an ISO datetime as a short local string.
 */
export function formatIsoShort(iso) {
  const s = String(iso || '').trim();
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * Relative time from an ISO datetime, e.g. "5m ago", "2d ago".
 */
export function formatRelativeFromIso(iso, now = Date.now()) {
  const s = String(iso || '').trim();
  if (!s) return '';
  const d = new Date(s);
  const t = d.getTime();
  if (Number.isNaN(t)) return '';
  const deltaMs = Math.max(0, Number(now) - t);
  const sec = Math.floor(deltaMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}


/**
 * Navigation + path helpers
 */

// Canonical hash-route parsing/building used across router, shell, and store.
export function parseHashRoute(hash = location.hash) {
  const raw = String(hash || '').startsWith('#') ? String(hash).slice(1) : String(hash || '');
  const path = raw.startsWith('/') ? raw : '/';
  const [pathname, search = ''] = path.split('?');
  return { pathname, query: new URLSearchParams(search) };
}

export function buildHashRoute({ pathname = '/', query } = {}) {
  const p = String(pathname || '/');
  const qp = query instanceof URLSearchParams
    ? query
    : new URLSearchParams(query || '');
  const search = qp.toString();
  return search ? `#${p}?${search}` : `#${p}`;
}

// Shared path utilities for collection keys and folder paths.
export function normalizeFolderPath(folderPath) {
  return String(folderPath || '').replace(/^\/+/, '').replace(/\/+$/, '');
}

export function dirname(path) {
  const parts = String(path || '').split('/').filter(Boolean);
  if (parts.length <= 1) return '';
  parts.pop();
  return parts.join('/');
}

export function basename(path) {
  const parts = String(path || '').split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

export function titleFromFilename(filename) {
  return String(filename || '')
    .replace(/\.json$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
}

/* Namespaced localStorage helpers ------------------------------------------------- */

export function lsGetJson(key, fallback = null) {
  try {
    const raw = localStorage.getItem(String(key));
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function lsSetJson(key, value) {
  try { localStorage.setItem(String(key), JSON.stringify(value)); } catch (e) {}
}



