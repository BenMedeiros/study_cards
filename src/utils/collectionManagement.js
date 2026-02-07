// Collection management helpers: deterministic shuffle
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


// Given original entries and a collection-state object (may contain order_hash_int),
// return the view that apps should render: entries array and metadata.
export function getCollectionView(originalEntries, collState = {}, opts = { windowSize: 10 }) {
  const n = Array.isArray(originalEntries) ? originalEntries.length : 0;
  const baseIndices = Array.from({ length: n }, (_, i) => i);
  const baseEntries = baseIndices.map(i => originalEntries[i]).filter(Boolean);
  const m = baseEntries.length;
  const orderHashInt = (collState && typeof collState.order_hash_int === 'number') ? collState.order_hash_int : null;
  if (orderHashInt !== null && m > 0) {
    const perm = seededPermutation(m, orderHashInt);
    const entries = perm.map(i => baseEntries[i]);
    const indices = perm.map(i => baseIndices[i]);
    return { entries, indices, isShuffled: true, order_hash_int: orderHashInt };
  }
  return { entries: baseEntries, indices: baseIndices.slice(), isShuffled: false, order_hash_int: null };
}
