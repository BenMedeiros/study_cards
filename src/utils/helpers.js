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
