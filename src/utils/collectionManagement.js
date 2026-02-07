// Collection management helpers: deterministic shuffle
import { inflectIAdjective, inflectNaAdjective } from './japanese.js';

export function mulberry32(a) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededPermutation(n, seed) {
  const rng = mulberry32(seed >>> 0);
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Table-search compatible wildcard regex.
// Mirrors src/components/table.js behavior:
// - % is the wildcard
// - if no % provided, wrap the query in %...%
// - case-insensitive
export function makeTableSearchRegex(query) {
  const s = String(query || '');
  if (!s.trim()) return null;
  let pat = s;
  if (!pat.includes('%')) pat = `%${pat}%`;
  // escape regex special chars except %
  pat = pat.replace(/([.+?^${}()|[\\]\\])/g, '\\$1');
  pat = pat.replace(/%/g, '.*');
  try {
    return new RegExp(pat, 'i');
  } catch {
    return null;
  }
}

function fieldKeyListFromMetadataFields(fields) {
  if (!Array.isArray(fields)) return [];
  return fields
    .map(f => (f && typeof f === 'object' ? f.key : f))
    .map(k => String(k || '').trim())
    .filter(Boolean);
}

function shallowEntryValueStrings(entry, fieldKeys) {
  if (!entry || typeof entry !== 'object') return [];
  const out = [];

  const pushVal = (v) => {
    if (v == null) return;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      const s = String(v).trim();
      if (s) out.push(s);
      return;
    }
    if (Array.isArray(v)) {
      // only include primitive-ish arrays for predictable matching
      for (const item of v) {
        if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
          const s = String(item).trim();
          if (s) out.push(s);
        }
      }
      return;
    }
  };

  if (Array.isArray(fieldKeys) && fieldKeys.length) {
    for (const k of fieldKeys) pushVal(entry[k]);
    return out;
  }

  // fallback: scan shallow primitive values on the entry
  for (const v of Object.values(entry)) pushVal(v);
  return out;
}

// Returns true if the entry matches a table-style wildcard search.
// If `fields` is provided (collection metadata fields), it matches the same
// columns the Data view renders.
export function entryMatchesTableSearch(entry, { query, regex = null, fields = null } = {}) {
  const rx = regex || makeTableSearchRegex(query);
  if (!rx) return true;
  const fieldKeys = fieldKeyListFromMetadataFields(fields);
  const values = shallowEntryValueStrings(entry, fieldKeys);
  for (const v of values) {
    if (rx.test(String(v))) return true;
  }
  return false;
}

// Filters a pair of (entries, indices) using a table-search query.
export function filterEntriesAndIndicesByTableSearch(entries, indices, { query, fields = null } = {}) {
  const arr = Array.isArray(entries) ? entries : [];
  const idx = Array.isArray(indices) ? indices : arr.map((_, i) => i);
  const rx = makeTableSearchRegex(query);
  if (!rx) return { entries: arr.slice(), indices: idx.slice() };

  const outEntries = [];
  const outIdx = [];
  for (let i = 0; i < arr.length; i++) {
    const e = arr[i];
    if (entryMatchesTableSearch(e, { regex: rx, fields })) {
      outEntries.push(e);
      outIdx.push(idx[i]);
    }
  }
  return { entries: outEntries, indices: outIdx };
}

// Study/progress key for an entry.
// If an entry is a derived/expanded variant, it may carry `__baseStudyKey`
// pointing at the canonical value that should receive progress credit.
export function getEntryStudyKey(entry) {
  try {
    const base = entry && typeof entry === 'object' ? entry.__baseStudyKey : null;
    if (typeof base === 'string' && base.trim()) return base.trim();
  } catch {}

  if (!entry || typeof entry !== 'object') return '';
  for (const k of ['kanji', 'character', 'text', 'word', 'reading', 'kana']) {
    const v = entry[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function getEntryRawStudyKey(entry) {
  if (!entry || typeof entry !== 'object') return '';
  for (const k of ['kanji', 'character', 'text', 'word', 'reading', 'kana']) {
    const v = entry[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function normalizeType(v) {
  return String(v || '').trim().toLowerCase();
}

function normalizeExpansionForms(v) {
  if (Array.isArray(v)) {
    return v.map(s => String(s || '').trim()).filter(Boolean);
  }
  const s = String(v || '').trim();
  if (!s) return [];
  // accept legacy string values (single) or comma/space separated
  return s.split(/[,|\s]+/g).map(x => String(x || '').trim()).filter(Boolean);
}

function uniqueInOrder(values) {
  const out = [];
  const seen = new Set();
  for (const v of (Array.isArray(values) ? values : [])) {
    const s = String(v || '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function expandJapaneseAdjectiveEntry(entry, { kind = '', form = '', baseStudyKey = '' } = {}) {
  if (!entry || typeof entry !== 'object') return entry;
  const typeRaw = String(entry.type || '').trim();
  const type = normalizeType(typeRaw);
  const isI = kind === 'i';
  const isNa = kind === 'na';

  if (!form) return entry;

  const next = { ...entry };
  if (baseStudyKey) next.__baseStudyKey = baseStudyKey;

  // surface fields to inflect (so Data table + cards reflect the chosen form)
  const surfaceKeys = ['kanji', 'character', 'text', 'word'];
  const readingKeys = ['reading', 'kana'];

  const inflect = (s) => {
    if (isI) return inflectIAdjective(s, form);
    if (isNa) return inflectNaAdjective(s, form);
    return String(s || '');
  };

  for (const k of surfaceKeys) {
    if (typeof next[k] === 'string' && next[k].trim()) next[k] = inflect(next[k]);
  }
  for (const k of readingKeys) {
    if (typeof next[k] === 'string' && next[k].trim()) next[k] = inflect(next[k]);
  }

  // Make it easy to see which form is active in the Data view.
  const baseType = typeRaw || (isI ? 'i-adjective' : (isNa ? 'na-adjective' : ''));
  next.type = baseType ? `${baseType}::${form}` : `::${form}`;
  return next;
}

export function expandEntriesAndIndicesByAdjectiveForms(entries, indices, { iForms = [], naForms = [] } = {}) {
  const arr = Array.isArray(entries) ? entries : [];
  const idx = Array.isArray(indices) ? indices : arr.map((_, i) => i);
  if (!arr.length) return { entries: [], indices: [] };

  const iSel = uniqueInOrder(normalizeExpansionForms(iForms));
  const naSel = uniqueInOrder(normalizeExpansionForms(naForms));

  // If nothing selected, pass through unchanged.
  if (!iSel.length && !naSel.length) return { entries: arr.slice(), indices: idx.slice() };

  const outEntries = [];
  const outIndices = [];

  for (let i = 0; i < arr.length; i++) {
    const entry = arr[i];
    const originalIndex = idx[i];
    if (!entry || typeof entry !== 'object') {
      outEntries.push(entry);
      outIndices.push(originalIndex);
      continue;
    }

    const typeRaw = String(entry.type || '').trim();
    const type = normalizeType(typeRaw);
    const isI = type === 'i-adjective' || type === 'i_adj' || type === 'i-adj';
    const isNa = type === 'na-adjective' || type === 'na_adj' || type === 'na-adj';

    const forms = isI ? iSel : (isNa ? naSel : []);

    // If this entry type has no selected forms, keep it as-is.
    if (!forms.length) {
      outEntries.push(entry);
      outIndices.push(originalIndex);
      continue;
    }

    const baseStudyKey = getEntryRawStudyKey(entry);
    const kind = isI ? 'i' : 'na';

    for (const form of forms) {
      outEntries.push(expandJapaneseAdjectiveEntry(entry, { kind, form, baseStudyKey }));
      outIndices.push(originalIndex);
    }
  }

  return { entries: outEntries, indices: outIndices };
}

// Back-compat: entries-only helper used by Data view.
export function expandEntriesByAdjectiveForm(entries, { iForms = [], naForms = [], iForm = '', naForm = '' } = {}) {
  const arr = Array.isArray(entries) ? entries : [];
  if (!arr.length) return [];
  const nextIForms = (iForms && Array.isArray(iForms)) ? iForms : (iForm ? [iForm] : []);
  const nextNaForms = (naForms && Array.isArray(naForms)) ? naForms : (naForm ? [naForm] : []);
  return expandEntriesAndIndicesByAdjectiveForms(arr, null, { iForms: nextIForms, naForms: nextNaForms }).entries;
}


// Given original entries and a collection-state object (may contain order_hash_int),
// return the view that apps should render: entries array and metadata.
export function getCollectionView(originalEntries, collState = {}, opts = { windowSize: 10 }) {
  const n = Array.isArray(originalEntries) ? originalEntries.length : 0;
  const baseIndices = [];
  const baseEntriesRaw = [];
  for (let i = 0; i < n; i++) {
    const e = originalEntries[i];
    if (!e) continue;
    baseIndices.push(i);
    baseEntriesRaw.push(e);
  }

  // Optional per-collection adjective expansion (i-adjective / na-adjective).
  const iForms = collState ? (collState.expansion_i ?? collState.expansion_iAdj ?? collState.expansion_i_adjective ?? []) : [];
  const naForms = collState ? (collState.expansion_na ?? collState.expansion_naAdj ?? collState.expansion_na_adjective ?? []) : [];
  const expanded = expandEntriesAndIndicesByAdjectiveForms(baseEntriesRaw, baseIndices, { iForms, naForms });
  const baseEntries = expanded.entries;
  const expandedIndices = expanded.indices;
  const m = baseEntries.length;
  const orderHashInt = (collState && typeof collState.order_hash_int === 'number') ? collState.order_hash_int : null;
  if (orderHashInt !== null && m > 0) {
    const perm = seededPermutation(m, orderHashInt);
    const entries = perm.map(i => baseEntries[i]);
    const indices = perm.map(i => expandedIndices[i]);
    return { entries, indices, isShuffled: true, order_hash_int: orderHashInt };
  }
  return { entries: baseEntries, indices: expandedIndices.slice(), isShuffled: false, order_hash_int: null };
}
