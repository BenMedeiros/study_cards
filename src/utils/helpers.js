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

/* Namespaced localStorage helpers and migration ------------------------------------------------- */

function _parseBoolish(v) {
  try {
    const s = String(v).trim().toLowerCase();
    if (s === '' || s === '1' || s === 'true' || s === 'on' || s === 'yes') return true;
    if (s === '0' || s === 'false' || s === 'off' || s === 'no') return false;
  } catch {
    // ignore
  }
  return null;
}

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

// Migrate legacy localStorage keys into the single `shell` JSON blob used by
// the app persistence layer. This runs at startup before persistence.load()
// so migrated values become part of the persisted UI state.
export function migrateLegacyLocalSettings() {
  try {
    // Build or load the namespaced blob. We'll populate `.shell` and `.apps`.
    const blobRaw = localStorage.getItem('study_cards:v1');
    let blob = {};
    if (blobRaw) {
      try { blob = JSON.parse(blobRaw) || {}; } catch { blob = {}; }
    }

    // Merge legacy `shell` and `apps` keys if present.
    try {
      const legacyShellRaw = localStorage.getItem('shell');
      if (legacyShellRaw) {
        try {
          const parsed = JSON.parse(legacyShellRaw);
          if (parsed && typeof parsed === 'object') blob.shell = { ...(blob.shell || {}), ...parsed };
        } catch {
          // ignore parse
        }
      }
    } catch {}

    try {
      const legacyAppsRaw = localStorage.getItem('apps');
      if (legacyAppsRaw) {
        try {
          const parsed = JSON.parse(legacyAppsRaw);
          if (parsed && typeof parsed === 'object') blob.apps = { ...(blob.apps || {}), ...parsed };
        } catch {
          // ignore parse
        }
      }
    } catch {}

    // Map of legacy keys -> [targetKeyInShell, parserFn]
    const map = {
      'study_cards_timing': ['timingEnabled', _parseBoolish],
      'show_footer_controls': ['showFooterCaptions', _parseBoolish],
      'showFooterControls': ['showFooterCaptions', _parseBoolish],
      'show_footer_captions': ['showFooterCaptions', _parseBoolish],
      'showFooterCaptions': ['showFooterCaptions', _parseBoolish],
    };

    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
      const [target, parser] = map[k];

      // Ensure shell object exists under blob
      blob.shell = blob.shell || {};
      if (Object.prototype.hasOwnProperty.call(blob.shell, target)) {
        toRemove.push(k);
        continue;
      }

      try {
        const raw = localStorage.getItem(k);
        const parsed = (typeof parser === 'function') ? parser(raw) : raw;
        if (parsed !== null) {
          blob.shell[target] = parsed;
        }
        toRemove.push(k);
      } catch {
        // ignore per-key errors
      }
    }

    // Write back merged namespaced blob
    if (Object.keys(blob).length) {
      try { localStorage.setItem('study_cards:v1', JSON.stringify(blob)); } catch (e) {}
    }

    // Remove legacy `shell` and `apps` keys if present
    try { localStorage.removeItem('shell'); } catch (e) {}
    try { localStorage.removeItem('apps'); } catch (e) {}

    // Remove migrated legacy keys
    for (const k of toRemove) {
      try { localStorage.removeItem(k); } catch (e) {}
    }
  } catch {
    // ignore migration errors
  }
}

// ---------------------------------------------------------------------------
// Query parsing helpers shared by table and collections manager
// ---------------------------------------------------------------------------

export function parseFieldQuery(q) {
  const s = String(q || '').trim();
  if (!s) return { field: null, term: '' };

  // Match explicit double-brace `{ {field} : term }` form
  const m1 = s.match(/^\{\{\s*([^}\s]+)\s*\}\s*:\s*(.*)\}$/);
  if (m1) {
    const field = String(m1[1] || '').trim();
    let term = String(m1[2] || '').trim();
    if (term === '') term = '%';
    return { field, term };
  }

  // Match comparator/equals or simple `{field:term}` forms
  // comparator form: {field>value}, {field>=value}, {field<value}, {field<=value}
  // equals-list form: {field=val1,val2}
  const compMatch = s.match(/^\{\s*([^:\s{}><=]+)\s*([<>]=?|=)\s*(.*)\}$/);
  if (compMatch) {
    const field = String(compMatch[1] || '').trim();
    const op = String(compMatch[2] || '').trim();
    let rhs = String(compMatch[3] || '').trim();
    if (op === '=') {
      // support CSV lists on right-hand side
      const list = rhs === '' ? [] : rhs.split(',').map(x => String(x || '').trim()).filter(Boolean);
      return { field, term: rhs, op: '=', list };
    }
    // numeric comparator
    return { field, term: rhs, op };
  }

  // Match single-brace field: {field:term}
  const m2 = s.match(/^\{\s*([^:\s}]+)\s*:\s*(.*)\}$/);
  if (m2) {
    const field = String(m2[1] || '').trim();
    let term = String(m2[2] || '').trim();
    if (term === '') term = '%';
    return { field, term };
  }

  // Fallback: no field specified
  return { field: null, term: s };
}

export function splitTopLevel(s, sep) {
  const out = [];
  if (typeof s !== 'string') return out;
  let cur = '';
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    // treat braces, parentheses, and brackets as grouping
    if (ch === '{' || ch === '(' || ch === '[') { depth++; cur += ch; continue; }
    if (ch === '}' || ch === ')' || ch === ']') { depth = Math.max(0, depth - 1); cur += ch; continue; }
    if (ch === sep && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function _stripOuterParens(s) {
  if (typeof s !== 'string') return s;
  let str = s.trim();
  if (str.length >= 2 && str[0] === '(' && str[str.length - 1] === ')') {
    let depth = 0;
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0 && i === str.length - 1) return str.slice(1, -1).trim();
      }
    }
  }
  return str;
}

export function escapeRegexForWildcard(term) {
  return String(term || '').replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

export function buildRegexFromWildcard(term) {
  const esc = escapeRegexForWildcard(term).replace(/%/g, '.*');
  return new RegExp(`^${esc}$`, 'i');
}

export function isNumericType(t) {
  if (!t && t !== 0) return false;
  const s = String(t || '').toLowerCase();
  return /int|float|number|numeric|double/.test(s);
}

export function evalComparators(valueNum, comps) {
  for (const c of comps) {
    const v = c.val;
    switch (c.op) {
      case '<': if (!(valueNum < v)) return false; break;
      case '<=': if (!(valueNum <= v)) return false; break;
      case '>': if (!(valueNum > v)) return false; break;
      case '>=': if (!(valueNum >= v)) return false; break;
      case '=': if (!(valueNum === v)) return false; break;
      default: return false;
    }
  }
  return true;
}

// Parse a table-style query into an object useful for evaluation.
// Returns { parts: [ { raw, field, term, comps, alts } ] }
export function parseTableQuery(query) {
  const q = String(query || '').trim();
  if (!q) return { parts: [] };
  const parts = String(q).split(';').map(s => String(s || '').trim()).filter(Boolean);
  const out = [];

  for (const p of parts) {
    const parsed = parseFieldQuery(p);
    const term = parsed.term ?? '';

    // Build alternatives split by top-level '|'
    const rawAlts = splitTopLevel(term, '|').map(a => String(a || '').trim()).filter(Boolean);
    const alts = rawAlts.map(a => {
      // Each alt may contain top-level '&' (AND). Split into AND-parts and strip outer parentheses
      const ands = splitTopLevel(a, '&').map(x => _stripOuterParens(String(x || '').trim())).filter(Boolean);
      return { raw: a, ands };
    });

    out.push({ raw: p, field: parsed.field, term, op: parsed.op ?? null, list: parsed.list ?? null, alts });
  }
  return { parts: out };
}

// Normalize a user-entered table query string.
// - Removes empty alternatives and duplicate pipes
// - Trims and collapses repeated whitespace outside of brace groups
// - Ensures single-space padding around top-level pipes
export function cleanSearchQuery(q) {
  const s = String(q || '');
  console.debug('cleanSearchQuery input:', s);
  if (!s.trim()) return '';
  // Split into top-level AND parts (respecting braces), then clean each part's OR-list
  const andParts = splitTopLevel(s, ';').map(x => String(x || '').trim()).filter(Boolean);
  const outParts = [];

  for (const part of andParts) {
    const rawOrs = splitTopLevel(part, '|').map(a => String(a || '').trim()).filter(Boolean);
    const seenOr = new Set();
    const cleanedOrs = [];

    for (let orItem of rawOrs) {
      if (!orItem) continue;
      // Normalize whitespace while respecting braces
      let norm = '';
      let depth = 0;
      for (let i = 0; i < orItem.length; i++) {
        const ch = orItem[i];
        if (ch === '{') { depth++; norm += ch; continue; }
        if (ch === '}') { depth = Math.max(0, depth - 1); norm += ch; continue; }
        if (depth === 0) {
          if (/\s/.test(ch)) {
            if (norm.endsWith(' ')) continue; // collapse runs
            norm += ' ';
          } else {
            norm += ch;
          }
        } else {
          norm += ch;
        }
      }

      // If no explicit '&' but there are spaces, treat spaces as AND
      const hasExplicitAnd = splitTopLevel(norm, '&').length > 1;
      if (!hasExplicitAnd && /\s/.test(norm)) {
        // replace top-level runs of spaces with ' & '
        let rebuilt = '';
        depth = 0;
        for (let i = 0; i < norm.length; i++) {
          const ch = norm[i];
          if (ch === '{') { depth++; rebuilt += ch; continue; }
          if (ch === '}') { depth = Math.max(0, depth - 1); rebuilt += ch; continue; }
          if (depth === 0) {
            if (/\s/.test(ch)) {
              let j = i + 1;
              while (j < norm.length && /\s/.test(norm[j])) j++;
              rebuilt += ' & ';
              i = j - 1;
              continue;
            }
            rebuilt += ch;
          } else {
            rebuilt += ch;
          }
        }
        norm = rebuilt.trim();
      }

      // Split top-level on '&', remove empty operands, and rejoin with single ' & '
      const andPartsLocal = splitTopLevel(norm, '&').map(x => String(x || '').trim()).filter(Boolean);
      if (!andPartsLocal.length) continue;
      let finalAlt = andPartsLocal.join(' & ');
      // Collapse any repeated ampersands (e.g. "& & &") into a single ' & ' to ensure idempotence
      finalAlt = finalAlt.replace(/(?:\s*&\s*){2,}/g, ' & ');

      const key = finalAlt.toLowerCase();
      if (seenOr.has(key)) continue;
      seenOr.add(key);
      cleanedOrs.push(finalAlt);
    }

    if (cleanedOrs.length) {
      // Parenthesize any alternative that contains '&' when there is more than one OR
      const processed = cleanedOrs.map(item => {
        // also collapse repeated ampersands inside the displayed item just in case
        const collapsed = String(item || '').replace(/(?:\s*&\s*){2,}/g, ' & ');
        if (cleanedOrs.length > 1 && collapsed.includes('&') && !/^\(.+\)$/.test(collapsed.trim())) return `(${collapsed})`;
        return collapsed;
      });
      outParts.push(processed.join(' | '));
    }
  }
  let result = outParts.join('; ');
  // Final pass: collapse any accidental repeated ampersands at the top-level
  result = result.replace(/(?:\s*&\s*){2,}/g, ' & ');
  console.debug('cleanSearchQuery output:', result);
  return result;
}
