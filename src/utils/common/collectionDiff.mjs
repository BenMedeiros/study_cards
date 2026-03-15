/**
 * Shared collection diff and patch helpers.
 *
 * Works on parsed collection objects after `JSON.parse`, not on raw JSON text.
 * Computes object-level diffs/patches for metadata, schema, and entry arrays, and
 * applies those patches back onto parsed collection objects.
 */

function safeClone(v) {
  try { return JSON.parse(JSON.stringify(v)); } catch { return null; }
}

function jsonEqual(a, b) {
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return a === b; }
}

function mergeUniqueArray(existing = [], incoming = []) {
  const out = [];
  const seen = new Set();
  const pushUnique = (value) => {
    const key = (() => {
      try { return JSON.stringify(value); } catch { return String(value); }
    })();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(value);
  };

  for (const value of Array.isArray(existing) ? existing : []) pushUnique(value);
  for (const value of Array.isArray(incoming) ? incoming : []) pushUnique(value);
  return out;
}

function hasOwn(obj, key) {
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
}

function mergeRelatedCollectionsValue(existingValue, incomingValue) {
  const hasExisting = existingValue && typeof existingValue === 'object';
  const hasIncoming = incomingValue && typeof incomingValue === 'object';
  if (!hasIncoming) return hasExisting ? safeClone(existingValue) || existingValue : incomingValue;

  const merged = hasExisting ? { ...existingValue } : {};
  for (const [key, value] of Object.entries(incomingValue)) {
    if (!Array.isArray(value)) {
      if (!hasOwn(merged, key)) merged[key] = value;
      else if (!jsonEqual(merged[key], value)) merged[key] = value;
      continue;
    }

    const current = Array.isArray(merged[key]) ? merged[key] : [];
    const next = mergeUniqueArray(current, value);
    if (next.length) merged[key] = next;
    else if (!current.length && hasOwn(merged, key)) delete merged[key];
  }
  return Object.keys(merged).length ? merged : undefined;
}

export function mergeEntryForPatch(existingEntry, incomingEntry) {
  const existing = existingEntry && typeof existingEntry === 'object' ? existingEntry : {};
  const incoming = incomingEntry && typeof incomingEntry === 'object' ? incomingEntry : {};
  const merged = { ...existing };

  for (const [key, value] of Object.entries(incoming)) {
    if (key === 'tags' && Array.isArray(value)) {
      const current = Array.isArray(existing.tags) ? existing.tags : [];
      const next = mergeUniqueArray(current, value);
      if (next.length) merged.tags = next;
      else if (!current.length) delete merged.tags;
      continue;
    }

    if (key === 'relatedCollections' && value && typeof value === 'object' && !Array.isArray(value)) {
      const next = mergeRelatedCollectionsValue(existing.relatedCollections, value);
      if (typeof next === 'undefined') delete merged.relatedCollections;
      else merged.relatedCollections = next;
      continue;
    }

    merged[key] = value;
  }

  return merged;
}

export function detectCollectionArrayKey(collection) {
  const c = collection && typeof collection === 'object' ? collection : null;
  if (!c) return { key: null, arr: null };

  const candidates = ['entries', 'sentences', 'paragraphs', 'items', 'cards'];
  for (const k of candidates) {
    if (Array.isArray(c[k])) return { key: k, arr: c[k] };
  }

  for (const [k, v] of Object.entries(c)) {
    if (k === 'metadata' || k === 'schema') continue;
    if (Array.isArray(v)) return { key: k, arr: v };
  }
  return { key: null, arr: null };
}

export function inferEntryKeyField({ collection = null, arrayKey = null, entries = null } = {}) {
  const meta = collection?.metadata && typeof collection.metadata === 'object' ? collection.metadata : null;
  const fromMeta = meta && typeof meta.entry_key === 'string' ? meta.entry_key.trim() : '';
  if (fromMeta) return fromMeta;

  const arrKey = String(arrayKey || '').trim();
  const arr = Array.isArray(entries) ? entries : (Array.isArray(collection?.[arrKey]) ? collection[arrKey] : null);
  const sample = Array.isArray(arr) && arr.length ? arr.find(x => x && typeof x === 'object') : null;
  if (!sample || typeof sample !== 'object') return '';

  if ('id' in sample) return 'id';
  if ('key' in sample) return 'key';
  if (arrKey === 'sentences' && 'ja' in sample) return 'ja';
  if (arrKey === 'entries' && 'kanji' in sample) return 'kanji';
  if ('name' in sample) return 'name';

  const schema = Array.isArray(meta?.schema) ? meta.schema : (Array.isArray(collection?.schema) ? collection.schema : null);
  if (Array.isArray(schema) && schema.length) {
    const firstKey = schema.find(f => f && typeof f.key === 'string' && f.key.trim());
    if (firstKey && firstKey.key) return String(firstKey.key);
  }

  for (const [k, v] of Object.entries(sample)) {
    if (typeof v === 'string' && String(v).trim()) return k;
  }
  return '';
}

function normalizeSchemaFromCollection(coll) {
  const meta = coll?.metadata && typeof coll.metadata === 'object' ? coll.metadata : null;
  if (Array.isArray(meta?.schema)) return meta.schema;
  if (Array.isArray(coll?.schema)) return coll.schema;
  return null;
}

function isProbablySchemaArray(arr) {
  if (!Array.isArray(arr) || !arr.length) return false;
  const sample = arr.find(x => x && typeof x === 'object');
  if (!sample) return false;
  return typeof sample.key === 'string' && (typeof sample.label === 'string' || typeof sample.type === 'string');
}

export function detectInputKind(input) {
  if (Array.isArray(input)) {
    return isProbablySchemaArray(input) ? 'schema' : 'entries';
  }
  if (!input || typeof input !== 'object') return 'unknown';

  const hasMeta = !!(input.metadata && typeof input.metadata === 'object');
  const hasSchema = Array.isArray(input.schema) || Array.isArray(input.metadata?.schema);
  const { key: arrKey, arr } = detectCollectionArrayKey(input);
  const hasArr = !!(arrKey && Array.isArray(arr));

  if (hasMeta && (hasSchema || hasArr)) return 'full';
  if (hasMeta && !hasSchema && !hasArr) return 'metadata';
  if (hasSchema && !hasMeta && !hasArr) return 'schema';
  if (hasArr) return 'entries-object';
  return 'unknown';
}

function diffObjectsShallow(a, b) {
  const out = [];
  const aa = a && typeof a === 'object' ? a : {};
  const bb = b && typeof b === 'object' ? b : {};
  const keys = new Set([...Object.keys(aa), ...Object.keys(bb)]);
  for (const k of keys) {
    const av = aa[k];
    const bv = bb[k];
    const same = (() => {
      try { return JSON.stringify(av) === JSON.stringify(bv); } catch { return av === bv; }
    })();
    if (!same) out.push({ key: k, before: av, after: bv });
  }
  return out;
}

function schemaToMap(schemaArr) {
  const m = new Map();
  const arr = Array.isArray(schemaArr) ? schemaArr : [];
  for (const f of arr) {
    if (!f || typeof f !== 'object') continue;
    const k = typeof f.key === 'string' ? f.key.trim() : '';
    if (!k) continue;
    m.set(k, f);
  }
  return m;
}

function diffSchema(oldSchema, newSchema) {
  const o = schemaToMap(oldSchema);
  const n = schemaToMap(newSchema);
  const changes = [];
  const added = [];
  const removed = [];
  for (const [k, nv] of n.entries()) {
    if (!o.has(k)) {
      added.push({ key: k, after: nv });
      continue;
    }
    const ov = o.get(k);
    let same = false;
    try { same = JSON.stringify(ov) === JSON.stringify(nv); } catch { same = ov === nv; }
    if (!same) changes.push({ key: k, before: ov, after: nv });
  }
  for (const [k, ov] of o.entries()) {
    if (!n.has(k)) removed.push({ key: k, before: ov });
  }
  return { added, removed, changes };
}

function buildEntryMap(entries, entryKeyField) {
  const m = new Map();
  const arr = Array.isArray(entries) ? entries : [];
  for (const e of arr) {
    if (!e || typeof e !== 'object') continue;
    const k = (entryKeyField && e[entryKeyField] != null) ? String(e[entryKeyField]).trim() : '';
    if (!k) continue;
    if (!m.has(k)) m.set(k, e);
  }
  return m;
}

function diffEntry(oldEntry, newEntry) {
  const o = oldEntry && typeof oldEntry === 'object' ? oldEntry : {};
  const n = newEntry && typeof newEntry === 'object' ? newEntry : {};
  const keys = new Set([...Object.keys(o), ...Object.keys(n)]);
  const fields = [];
  for (const k of keys) {
    const ov = o[k];
    const nv = n[k];
    let same = false;
    try { same = JSON.stringify(ov) === JSON.stringify(nv); } catch { same = ov === nv; }
    if (!same) fields.push({ key: k, before: ov, after: nv });
  }
  return fields;
}

export function computePatchFromInput({ baseCollection, input, treatFullAsReplace = true } = {}) {
  const base = safeClone(baseCollection) || { metadata: {} };
  const kind = detectInputKind(input);
  const warnings = [];

  const { key: baseArrKey, arr: baseArr } = detectCollectionArrayKey(base);
  const entryKeyField = inferEntryKeyField({ collection: base, arrayKey: baseArrKey, entries: baseArr });

  let inputArrKey = null;
  let inputEntries = null;

  if (kind === 'full') {
    const det = detectCollectionArrayKey(input);
    inputArrKey = det.key;
    inputEntries = det.arr;
  } else if (kind === 'entries') {
    inputEntries = input;
  } else if (kind === 'entries-object') {
    const det = detectCollectionArrayKey(input);
    inputArrKey = det.key;
    inputEntries = det.arr;
  } else {
    warnings.push('Unrecognized JSON shape; expected full collection object, entries array, metadata object, or schema array.');
  }

  const targetArrKey = inputArrKey || baseArrKey || 'entries';
  const targetEntryKeyField = (() => {
    const inferred = inferEntryKeyField({ collection: base, arrayKey: targetArrKey, entries: inputEntries || baseArr });
    return inferred || entryKeyField || '';
  })();

  const patch = {
    targetArrayKey: targetArrKey,
    entryKeyField: targetEntryKeyField,
    inputKind: kind,
    entries: { upsert: [] },
  };

  const baseEntries = Array.isArray(base?.[targetArrKey]) ? base[targetArrKey] : (Array.isArray(baseArr) ? baseArr : []);
  if (Array.isArray(inputEntries)) {
    if (!targetEntryKeyField) warnings.push('No unique entry key detected (metadata.entry_key). Edits will be best-effort and may not match existing records correctly.');

    const baseMap = buildEntryMap(baseEntries, targetEntryKeyField);
    const inputMap = buildEntryMap(inputEntries, targetEntryKeyField);

    for (const [k, incoming] of inputMap.entries()) {
      const existing = baseMap.get(k);
      if (!existing) {
        patch.entries.upsert.push(incoming);
        continue;
      }
      const mergedIncoming = mergeEntryForPatch(existing, incoming);
      const fields = diffEntry(existing, mergedIncoming);
      if (fields.length) {
        patch.entries.upsert.push(incoming);
      }
    }
  }

  const diffs = summarizePatchAgainstBase({ baseCollection: base, patch });
  const merged = applyPatchToCollection({ baseCollection: base, patch });
  return { patch, diffs, merged, warnings };
}

export function applyPatchToCollection({ baseCollection, patch } = {}) {
  const base = safeClone(baseCollection) || { metadata: {} };
  const p = patch && typeof patch === 'object' ? patch : null;
  if (!p) return base;

  const arrayKey = String(p.targetArrayKey || detectCollectionArrayKey(base).key || 'entries');
  const entryKeyField = String(p.entryKeyField || inferEntryKeyField({ collection: base, arrayKey }) || '').trim();

  try {
    const arr = Array.isArray(base[arrayKey]) ? base[arrayKey].slice() : [];
    const indexByKey = new Map();
    if (entryKeyField) {
      for (let i = 0; i < arr.length; i++) {
        const e = arr[i];
        if (!e || typeof e !== 'object') continue;
        const k = e[entryKeyField] != null ? String(e[entryKeyField]).trim() : '';
        if (!k) continue;
        if (!indexByKey.has(k)) indexByKey.set(k, i);
      }
    }

    const upsert = Array.isArray(p.entries?.upsert) ? p.entries.upsert : [];
    for (const incoming of upsert) {
      if (!incoming || typeof incoming !== 'object') continue;
      if (!entryKeyField) {
        arr.push(incoming);
        continue;
      }
      const k = incoming[entryKeyField] != null ? String(incoming[entryKeyField]).trim() : '';
      if (!k) {
        arr.push(incoming);
        continue;
      }
      const idx = indexByKey.get(k);
      if (idx == null) {
        indexByKey.set(k, arr.length);
        arr.push(incoming);
        continue;
      }
      const existing = arr[idx];
      if (!existing || typeof existing !== 'object') {
        arr[idx] = incoming;
        continue;
      }
      arr[idx] = mergeEntryForPatch(existing, incoming);
    }

    base[arrayKey] = arr;
  } catch (e) {}

  return base;
}

export function summarizePatchAgainstBase({ baseCollection, patch } = {}) {
  const base = baseCollection && typeof baseCollection === 'object' ? baseCollection : { metadata: {} };
  const p = patch && typeof patch === 'object' ? patch : {};

  const arrayKey = String(p.targetArrayKey || detectCollectionArrayKey(base).key || 'entries');
  const entryKeyField = String(p.entryKeyField || inferEntryKeyField({ collection: base, arrayKey }) || '').trim();
  const baseEntries = Array.isArray(base?.[arrayKey]) ? base[arrayKey] : [];
  const baseMap = buildEntryMap(baseEntries, entryKeyField);

  const upsert = Array.isArray(p.entries?.upsert) ? p.entries.upsert : [];

  let newEntries = 0;
  let editedEntries = 0;
  if (entryKeyField) {
    for (const e of upsert) {
      const k = e && typeof e === 'object' && e[entryKeyField] != null ? String(e[entryKeyField]).trim() : '';
      if (!k) continue;
      if (!baseMap.has(k)) newEntries++;
      else editedEntries++;
    }
  } else {
    newEntries = upsert.length;
  }

  return {
    arrayKey,
    entryKeyField,
    metadataChanges: 0,
    schemaChanges: 0,
    entriesUpsert: upsert.length,
    entriesRemove: 0,
    newEntries,
    editedEntries,
  };
}