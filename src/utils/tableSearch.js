import { parseFieldQuery, parseTableQuery, buildRegexFromWildcard, isNumericType, evalComparators } from './helpers.js';

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

function valueMatchesToken(value, token) {
  const t = String(token ?? '').trim();
  if (!t) return false;
  const vals = shallowScalarStrings(value);
  if (!vals.length) return false;

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
