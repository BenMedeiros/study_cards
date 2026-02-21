import { getGlobalSettingsManager } from '../managers/settingsManager.js';

// --- Table-query parsing utilities (moved from helpers.js so table search
// logic is colocated) ----------------------------------------------------
export function parseFieldQuery(q) {
  const s = String(q || '').trim();
  if (!s) return { field: null, term: '' };

  const m1 = s.match(/^\{\{\s*([^}\s]+)\s*\}\s*:\s*(.*)\}$/);
  if (m1) {
    const field = String(m1[1] || '').trim();
    let term = String(m1[2] || '').trim();
    if (term === '') term = '%';
    return { field, term };
  }

  const compMatch = s.match(/^\{\s*([^:\s{}><=]+)\s*([<>]=?|=)\s*(.*)\}$/);
  if (compMatch) {
    const field = String(compMatch[1] || '').trim();
    const op = String(compMatch[2] || '').trim();
    let rhs = String(compMatch[3] || '').trim();
    if (op === '=') {
      const list = rhs === '' ? [] : rhs.split(',').map(x => String(x || '').trim()).filter(Boolean);
      return { field, term: rhs, op: '=', list };
    }
    return { field, term: rhs, op };
  }

  const m2 = s.match(/^\{\s*([^:\s}]+)\s*:\s*(.*)\}$/);
  if (m2) {
    const field = String(m2[1] || '').trim();
    let term = String(m2[2] || '').trim();
    if (term === '') term = '%';
    return { field, term };
  }

  return { field: null, term: s };
}

export function splitTopLevel(s, sep) {
  const out = [];
  if (typeof s !== 'string') return out;
  let cur = '';
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{' || ch === '(' || ch === '[') { depth++; cur += ch; continue; }
    if (ch === '}' || ch === ')' || ch === ']') { depth = Math.max(0, depth - 1); cur += ch; continue; }
    if (ch === sep && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function escapeRegexForWildcard(term) {
  return String(term || '').replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

export function buildRegexFromWildcard(term) {
  // Use a wildcard that matches across newlines. '.' does not match newlines
  // by default, so replace '%' with '[\s\S]*' to allow multiline matches.
  const esc = escapeRegexForWildcard(term).replace(/%/g, '[\\s\\S]*');
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

export function parseTableQuery(query) {
  const q = String(query || '').trim();
  if (!q) return { parts: [] };
  const parts = String(q).split(';').map(s => String(s || '').trim()).filter(Boolean);
  const out = [];

  for (const p of parts) {
    const parsed = parseFieldQuery(p);
    const term = parsed.term ?? '';
    const rawAlts = splitTopLevel(term, '|').map(a => String(a || '').trim()).filter(Boolean);
    const alts = rawAlts.map(a => {
      const ands = splitTopLevel(a, '&').map(x => _stripOuterParens(String(x || '').trim())).filter(Boolean);
      return { raw: a, ands };
    });
    out.push({ raw: p, field: parsed.field, term, op: parsed.op ?? null, list: parsed.list ?? null, alts });
  }
  return { parts: out };
}

const NUM_RE_SRC = '[-+]?\\d*\\.?\\d+(?:[eE][-+]?\\d+)?';
const PURE_COMP_CHAIN_RE = new RegExp(`^\\s*(?:[<>]=?|=)\\s*(${NUM_RE_SRC})(?:\\s*(?:[<>]=?|=)\\s*(${NUM_RE_SRC}))*\\s*$`);
const COMP_SCAN_RE = new RegExp(`([<>]=?|=)\\s*(${NUM_RE_SRC})`, 'g');

function normalizeFieldsMeta(fields) {
  if (!Array.isArray(fields)) return null;
  return fields
    .map(f => {
      if (!f) return null;
      if (typeof f === 'string') return { key: String(f), type: null };
      if (typeof f === 'object') return { key: String(f.key ?? ''), type: f.type ?? (f.schema && f.schema.type) ?? null };
      return null;
    })
    .filter(f => f && f.key);
}

function getFieldTypeFromMeta(fieldsMeta, key) {
  if (!Array.isArray(fieldsMeta) || !key) return null;
  const k = String(key);
  for (const f of fieldsMeta) {
    if (f && f.key === k) return f.type ?? null;
  }
  return null;
}

function shallowScalarStrings(v) {
  const out = [];
  const push = (x) => {
    if (x == null) return;
    if (typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean') out.push(String(x));
  };
  if (Array.isArray(v)) {
    for (const it of v) push(it);
  } else {
    push(v);
  }
  return out;
}

function valuesForGlobalSearchFromRecord(record, fieldsMeta = null) {
  if (!record || typeof record !== 'object') return [];
  // If fields are specified, restrict to those keys (keeps parity with Data View metadata fields)
  if (Array.isArray(fieldsMeta) && fieldsMeta.length) {
    const out = [];
    for (const f of fieldsMeta) {
      out.push(...shallowScalarStrings(record[f.key]));
    }
    return out;
  }
  const out = [];
  for (const v of Object.values(record)) out.push(...shallowScalarStrings(v));
  return out;
}

function equalsI(a, b) {
  return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
}

function parseBooleanLike(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return null;
  if (s === 'true' || s === '1' || s === 'yes' || s === 'y' || s === 'on' || s === 't' || s === '✓') return true;
  if (s === 'false' || s === '0' || s === 'no' || s === 'n' || s === 'off' || s === 'f' || s === '✗' || s === 'x') return false;
  return null;
}

function valueMatchesToken(value, token) {
  const t = String(token ?? '').trim();
  if (!t) return false;
  const vals = shallowScalarStrings(value);
  if (!vals.length) return false;

  const tokenBool = parseBooleanLike(t);
  if (tokenBool !== null) {
    return vals.some(v => parseBooleanLike(v) === tokenBool);
  }

  if (t.includes('%')) {
    const rx = buildRegexFromWildcard(t);
    return vals.some(v => rx.test(String(v ?? '')));
  }
  return vals.some(v => equalsI(v, t));
}

function parseComparatorChain(s) {
  const str = String(s ?? '').trim();
  if (!str) return null;
  if (!PURE_COMP_CHAIN_RE.test(str)) return null;

  const comps = [];
  COMP_SCAN_RE.lastIndex = 0;
  let m;
  while ((m = COMP_SCAN_RE.exec(str)) !== null) {
    const op = String(m[1] ?? '').trim();
    const val = Number(m[2]);
    if (!op || Number.isNaN(val)) return null;
    comps.push({ op, val });
  }
  return comps.length ? comps : null;
}

export function compileTableSearchQuery(query) {
  const q = String(query ?? '').trim();
  if (!q) return { raw: '', parsed: { parts: [] }, fieldsMeta: null };
  return { raw: q, parsed: parseTableQuery(q), fieldsMeta: null };
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

// Normalize a user-entered table query string. Moved here from helpers.js so
// table-specific behavior (auto-wildcard) lives with table search logic.
export function cleanSearchQuery(q) {
  const s = String(q || '');
  if (!s.trim()) return '';
  // Determine whether to auto-wrap plain tokens with wildcard markers and
  // whether to emit debug logs; read settings when available.
  let autoWildcard = true;
  let logEnabled = false;
  try {
    const sm = (typeof getGlobalSettingsManager === 'function') ? getGlobalSettingsManager() : null;
    if (sm && typeof sm.isReady === 'function' && sm.isReady() && typeof sm.get === 'function') {
      try { autoWildcard = !!sm.get('utils.tableSearch.autoWildcard', { consumerId: 'tableSearch.cleanSearchQuery' }); } catch (e) {}
      try { logEnabled = !!sm.get('utils.tableSearch.log.autoCleanQuery', { consumerId: 'tableSearch.cleanSearchQuery' }); } catch (e) {}
    }
  } catch (e) {}
  if (logEnabled) console.debug('cleanSearchQuery input:', s);
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
      const andPartsLocal = splitTopLevel(norm, '&').map(x => String(x || '').trim()).filter(Boolean)
        .map(tok => {
          if (!autoWildcard) return tok;
          if (!tok) return tok;
          const t = String(tok).trim();
          // Preserve field-expressions and explicit wildcards or comparator-like tokens
          if (t.startsWith('{') && t.endsWith('}')) return tok;
          if (t.includes('%') || t.includes('*')) return tok;
          if (/^[<>]=?/.test(t) || t.startsWith('=')) return tok;
          return `%${t}%`;
        });
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
  if (logEnabled) console.debug('cleanSearchQuery output:', result);
  return result;
}

function _toCodePoints(v) {
  return Array.from(String(v ?? ''));
}

function _sortCountEntries(entries) {
  return Array.from(entries || []).sort((a, b) => {
    const diff = Number(b?.[1] || 0) - Number(a?.[1] || 0);
    if (diff !== 0) return diff;
    return String(a?.[0] ?? '').localeCompare(String(b?.[0] ?? ''), undefined, { sensitivity: 'base' });
  });
}

function _sanitizeAddToSearchCoreTerm(v) {
  const raw = String(v ?? '');
  if (!raw) return '';
  if (/[{}|;&%]/.test(raw)) return '';
  if (raw !== raw.trim()) return '';
  const cleaned = raw.trim();
  if (!cleaned) return '';
  return cleaned;
}

function _countBy(values, getKeys) {
  const counts = new Map();
  const arr = Array.isArray(values) ? values : [];
  for (const raw of arr) {
    const keysRaw = (typeof getKeys === 'function') ? getKeys(raw) : [];
    const keys = Array.isArray(keysRaw) ? keysRaw : [];
    if (!keys.length) continue;
    const seen = new Set();
    for (const keyRaw of keys) {
      const key = String(keyRaw ?? '');
      if (!key) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return counts;
}

const ADD_TO_SEARCH_ANALYSIS_DEFS = Object.freeze([
  {
    id: 'groupby',
    label: 'AddToSearch-groupby',
    getKeys: (value) => {
      const s = String(value ?? '').trim();
      return s ? [s] : [];
    },
    toQueryTerm: (key) => _sanitizeAddToSearchCoreTerm(key),
  },
  {
    id: 'endsWithChar',
    label: 'AddToSearch-endsWithChar',
    getKeys: (value) => {
      const chars = _toCodePoints(String(value ?? '').trim());
      if (!chars.length) return [];
      return [chars[chars.length - 1]];
    },
    toQueryTerm: (key) => {
      const core = _sanitizeAddToSearchCoreTerm(key);
      return core ? `%${core}` : '';
    },
  },
  {
    id: 'startsWithChar',
    label: 'AddToSearch-startsWithChar',
    getKeys: (value) => {
      const chars = _toCodePoints(String(value ?? '').trim());
      if (!chars.length) return [];
      return [chars[0]];
    },
    toQueryTerm: (key) => {
      const core = _sanitizeAddToSearchCoreTerm(key);
      return core ? `${core}%` : '';
    },
  },
  {
    id: 'containsChar2',
    label: 'AddToSearch-containsChar2',
    getKeys: (value) => {
      const chars = _toCodePoints(String(value ?? '').trim());
      if (chars.length < 2) return [];
      const grams = new Set();
      for (let i = 0; i < chars.length - 1; i++) {
        grams.add(`${chars[i]}${chars[i + 1]}`);
      }
      return Array.from(grams);
    },
    toQueryTerm: (key) => {
      const core = _sanitizeAddToSearchCoreTerm(key);
      return core ? `%${core}%` : '';
    },
  },
]);

export function buildAddToSearchColumnAnalyses(values, { minCountExclusive = 2, topN = 4 } = {}) {
  const minCount = Number.isFinite(Number(minCountExclusive)) ? Number(minCountExclusive) : 2;
  const limit = Number.isFinite(Number(topN)) ? Math.max(0, Number(topN)) : 4;
  if (!limit) return [];

  const analyses = [];
  for (const def of ADD_TO_SEARCH_ANALYSIS_DEFS) {
    const counts = _countBy(values, def.getKeys);
    const ranked = _sortCountEntries(counts).filter(([, count]) => Number(count || 0) > minCount);
    const top = ranked.slice(0, limit);
    if (!top.length) continue;

    const suggestions = [];
    for (const [value, count] of top) {
      const queryTerm = (typeof def.toQueryTerm === 'function') ? String(def.toQueryTerm(value) || '') : '';
      if (!queryTerm) continue;
      suggestions.push({
        value: String(value ?? ''),
        count: Number(count || 0),
        queryTerm,
      });
    }
    if (!suggestions.length) continue;
    analyses.push({
      id: String(def.id || ''),
      label: String(def.label || ''),
      suggestions,
    });
  }
  return analyses;
}

function matchesFieldAlt({ fieldKey, fieldValue, alt, fieldsMeta, getFieldType }) {
  const andTerms = Array.isArray(alt?.ands) ? alt.ands : [];
  if (!andTerms.length) return false;

  const comps = [];
  const stringTerms = [];

  for (const rawTerm of andTerms) {
    const t = String(rawTerm ?? '').trim();
    if (!t) return false;

    if (t.startsWith('{') && t.endsWith('}')) {
      const sub = parseFieldQuery(t);
      if (!sub.field) return false;
      if (String(sub.field) !== String(fieldKey)) return false;

      if (sub.op) {
        if (sub.op === '=') {
          // Equals-list in a field-AND context: treat as a string constraint
          if (Array.isArray(sub.list) && sub.list.length) {
            const ok = sub.list.some(item => valueMatchesToken(fieldValue, item));
            if (!ok) return false;
            continue;
          }
          // fall through to term match
        } else {
          const n = Number(fieldValue);
          const rn = Number(sub.term);
          if (Number.isNaN(n) || Number.isNaN(rn)) return false;
          comps.push({ op: sub.op, val: rn });
          continue;
        }
      }

      // Legacy comparator form inside {field:<=3}
      const chain = parseComparatorChain(sub.term);
      if (chain) {
        const n = Number(fieldValue);
        if (Number.isNaN(n)) return false;
        comps.push(...chain);
        continue;
      }

      // Regular token
      stringTerms.push(sub.term);
      continue;
    }

    const chain = parseComparatorChain(t);
    if (chain) {
      const n = Number(fieldValue);
      if (Number.isNaN(n)) return false;
      comps.push(...chain);
    } else {
      stringTerms.push(t);
    }
  }

  if (comps.length) {
    const type = (typeof getFieldType === 'function') ? getFieldType(fieldKey) : getFieldTypeFromMeta(fieldsMeta, fieldKey);
    if (!isNumericType(type)) return false;
    const n = Number(fieldValue);
    if (Number.isNaN(n)) return false;
    if (!evalComparators(n, comps)) return false;
  }

  for (const st of stringTerms) {
    if (!valueMatchesToken(fieldValue, st)) return false;
  }

  return true;
}

export function matchesTableSearch(recordOrAccessor, queryOrCompiled, opts = {}) {
  const compiled = (queryOrCompiled && typeof queryOrCompiled === 'object' && queryOrCompiled.parsed)
    ? queryOrCompiled
    : compileTableSearchQuery(queryOrCompiled);

  const q = String(compiled?.raw ?? '').trim();
  if (!q) return false;

  const parsed = compiled?.parsed;
  const parts = Array.isArray(parsed?.parts) ? parsed.parts : [];
  if (!parts.length) return false;

  const fieldsMeta = normalizeFieldsMeta(opts?.fields ?? compiled?.fieldsMeta ?? null);

  const hasField = (typeof opts?.hasField === 'function')
    ? opts.hasField
    : (typeof recordOrAccessor?.hasField === 'function')
      ? (k) => recordOrAccessor.hasField(k)
      : (k) => Object.prototype.hasOwnProperty.call(recordOrAccessor || {}, String(k));

  const getValue = (typeof opts?.getValue === 'function')
    ? opts.getValue
    : (typeof recordOrAccessor?.getValue === 'function')
      ? (k) => recordOrAccessor.getValue(k)
      : (k) => (recordOrAccessor && typeof recordOrAccessor === 'object') ? recordOrAccessor[String(k)] : undefined;

  const getFieldType = (typeof opts?.getFieldType === 'function')
    ? opts.getFieldType
    : (typeof recordOrAccessor?.getFieldType === 'function')
      ? (k) => recordOrAccessor.getFieldType(k)
      : null;

  const getAllValues = (typeof opts?.getAllValues === 'function')
    ? opts.getAllValues
    : (typeof recordOrAccessor?.getAllValues === 'function')
      ? () => recordOrAccessor.getAllValues()
      : null;

  const globalValues = () => {
    if (getAllValues) return (Array.isArray(getAllValues()) ? getAllValues() : []).map(v => String(v ?? ''));
    return valuesForGlobalSearchFromRecord(recordOrAccessor, fieldsMeta);
  };

  try {
    for (const partObj of parts) {
      const field = partObj?.field ? String(partObj.field) : null;

      if (field) {
        if (!hasField(field)) return false;
        const fieldValue = getValue(field);

        // Comparator / equals-list when op is provided (canonical syntax: {field>=3}, {field=foo,bar})
        const op = partObj?.op ? String(partObj.op) : null;
        if (op) {
          if (op === '=') {
            const list = Array.isArray(partObj.list) ? partObj.list : [];
            if (list.length) {
              const ok = list.some(item => valueMatchesToken(fieldValue, item));
              if (!ok) return false;
              continue;
            }
            // If list is empty, fall through to string matching.
          } else {
            const type = (typeof getFieldType === 'function') ? getFieldType(field) : getFieldTypeFromMeta(fieldsMeta, field);
            if (!isNumericType(type)) return false;
            const n = Number(fieldValue);
            const rn = Number(partObj?.term);
            if (Number.isNaN(n) || Number.isNaN(rn)) return false;
            if (!evalComparators(n, [{ op, val: rn }])) return false;
            continue;
          }
        }

        // String alternatives with AND/OR; also supports legacy comparator tokens in the term: {field:<=3}
        let anyAltMatch = false;
        for (const alt of (Array.isArray(partObj?.alts) ? partObj.alts : [])) {
          if (matchesFieldAlt({ fieldKey: field, fieldValue, alt, fieldsMeta, getFieldType })) {
            anyAltMatch = true;
            break;
          }
        }
        if (!anyAltMatch) return false;
        continue;
      }

      // Global part: each alternative must match somewhere in the record.
      const values = globalValues();
      let anyAltMatch = false;

      for (const alt of (Array.isArray(partObj?.alts) ? partObj.alts : [])) {
        const andTerms = Array.isArray(alt?.ands) ? alt.ands : [];
        if (!andTerms.length) continue;

        let allMatch = true;
        for (const rawTerm of andTerms) {
          const t = String(rawTerm ?? '').trim();
          if (!t) { allMatch = false; break; }

          if (t.startsWith('{') && t.endsWith('}')) {
            const sub = parseFieldQuery(t);
            if (!sub.field) { allMatch = false; break; }
            const f = String(sub.field).trim();
            if (!f || !hasField(f)) { allMatch = false; break; }
            const v = getValue(f);

            if (sub.op) {
              if (sub.op === '=') {
                if (Array.isArray(sub.list) && sub.list.length) {
                  const ok = sub.list.some(item => valueMatchesToken(v, item));
                  if (!ok) { allMatch = false; break; }
                  continue;
                }
                // fall through
              } else {
                const type = (typeof getFieldType === 'function') ? getFieldType(f) : getFieldTypeFromMeta(fieldsMeta, f);
                if (!isNumericType(type)) { allMatch = false; break; }
                const n = Number(v);
                const rn = Number(sub.term);
                if (Number.isNaN(n) || Number.isNaN(rn)) { allMatch = false; break; }
                if (!evalComparators(n, [{ op: sub.op, val: rn }])) { allMatch = false; break; }
                continue;
              }
            }

            const chain = parseComparatorChain(sub.term);
            if (chain) {
              const type = (typeof getFieldType === 'function') ? getFieldType(f) : getFieldTypeFromMeta(fieldsMeta, f);
              if (!isNumericType(type)) { allMatch = false; break; }
              const n = Number(v);
              if (Number.isNaN(n)) { allMatch = false; break; }
              if (!evalComparators(n, chain)) { allMatch = false; break; }
              continue;
            }

            if (!valueMatchesToken(v, sub.term)) { allMatch = false; break; }
            continue;
          }

          // Global comparator tokens (like ">=3") are not allowed without a field.
          if (parseComparatorChain(t)) { allMatch = false; break; }

          // Token must match at least one value
          const ok = values.some(v => valueMatchesToken(v, t));
          if (!ok) { allMatch = false; break; }
        }

        if (allMatch) { anyAltMatch = true; break; }
      }

      if (!anyAltMatch) return false;
    }

    return true;
  } catch {
    return false;
  }
}

export function filterRecordsAndIndicesByTableSearch(records, indices, queryOrCompiled, opts = {}) {
  const arr = Array.isArray(records) ? records : [];
  const idx = Array.isArray(indices) ? indices : arr.map((_, i) => i);
  const compiled = (queryOrCompiled && typeof queryOrCompiled === 'object' && queryOrCompiled.parsed)
    ? queryOrCompiled
    : compileTableSearchQuery(queryOrCompiled);

  const q = String(compiled?.raw ?? '').trim();
  if (!q) return { records: arr.slice(), indices: idx.slice() };

  const outRecords = [];
  const outIdx = [];

  for (let i = 0; i < arr.length; i++) {
    const rec = arr[i];
    if (matchesTableSearch(rec, compiled, opts)) {
      outRecords.push(rec);
      outIdx.push(idx[i]);
    }
  }

  return { records: outRecords, indices: outIdx };
}
