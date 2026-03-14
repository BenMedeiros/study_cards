function safeClone(v) {
  try { return JSON.parse(JSON.stringify(v)); } catch { return null; }
}

export function detectCollectionArrayKey(collection) {
  const c = collection && typeof collection === 'object' ? collection : null;
  if (!c) return { key: null, arr: null };

  const candidates = ['entries', 'sentences', 'paragraphs', 'items', 'cards'];
  for (const k of candidates) {
    if (Array.isArray(c[k])) return { key: k, arr: c[k] };
  }

  // Fallback: first top-level array prop (excluding metadata-like keys)
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

  // Common conventions
  if ('id' in sample) return 'id';
  if ('key' in sample) return 'key';
  if (arrKey === 'sentences' && 'ja' in sample) return 'ja';
  if (arrKey === 'entries' && 'kanji' in sample) return 'kanji';
  if ('name' in sample) return 'name';

  // Try schema order if present
  const schema = Array.isArray(meta?.schema) ? meta.schema : (Array.isArray(collection?.schema) ? collection.schema : null);
  if (Array.isArray(schema) && schema.length) {
    const firstKey = schema.find(f => f && typeof f.key === 'string' && f.key.trim());
    if (firstKey && firstKey.key) return String(firstKey.key);
  }

  // Last resort: first string field on sample
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
  const baseSchema = normalizeSchemaFromCollection(base);
  const entryKeyField = inferEntryKeyField({ collection: base, arrayKey: baseArrKey, entries: baseArr });

  let inputMeta = null;
  let inputSchema = null;
  let inputArrKey = null;
  let inputEntries = null;

  if (kind === 'full') {
    inputMeta = (input?.metadata && typeof input.metadata === 'object') ? input.metadata : null;
    inputSchema = Array.isArray(input?.metadata?.schema) ? input.metadata.schema : (Array.isArray(input?.schema) ? input.schema : null);
    const det = detectCollectionArrayKey(input);
    inputArrKey = det.key;
    inputEntries = det.arr;
  } else if (kind === 'metadata') {
    inputMeta = input;
  } else if (kind === 'schema') {
    inputSchema = Array.isArray(input) ? input : (Array.isArray(input?.schema) ? input.schema : (Array.isArray(input?.metadata?.schema) ? input.metadata.schema : null));
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
    const metaEk = (inputMeta && typeof inputMeta.entry_key === 'string') ? inputMeta.entry_key.trim() : '';
    if (metaEk) return metaEk;
    const inferred = inferEntryKeyField({ collection: base, arrayKey: targetArrKey, entries: inputEntries || baseArr });
    return inferred || entryKeyField || '';
  })();

  const patch = {
    targetArrayKey: targetArrKey,
    entryKeyField: targetEntryKeyField,
    metadata: { set: {}, unset: [] },
    schema: { upsert: [], removeKeys: [] },
    entries: { upsert: [], upsertMinimal: [], removeKeys: [] },
    _inputKind: kind,
  };

  // Metadata changes: for metadata-only and full collection
  const baseMeta = (base.metadata && typeof base.metadata === 'object') ? base.metadata : {};
  if (inputMeta) {
    const md = diffObjectsShallow(baseMeta, inputMeta);
    for (const d of md) {
      if (d.after === undefined) patch.metadata.unset.push(d.key);
      else patch.metadata.set[d.key] = d.after;
    }
  }

  // Schema changes
  if (inputSchema) {
    const sd = diffSchema(baseSchema || [], inputSchema || []);
    for (const a of sd.added) patch.schema.upsert.push(a.after);
    for (const c of sd.changes) patch.schema.upsert.push(c.after);
    for (const r of sd.removed) patch.schema.removeKeys.push(r.key);
  }

  // Entry upserts and (optional) removals
  const baseEntries = Array.isArray(base?.[targetArrKey]) ? base[targetArrKey] : (Array.isArray(baseArr) ? baseArr : []);
  if (Array.isArray(inputEntries)) {
    if (!targetEntryKeyField) warnings.push('No unique entry key detected (metadata.entry_key). Edits will be best-effort and may not match existing records correctly.');

    const baseMap = buildEntryMap(baseEntries, targetEntryKeyField);
    const inputMap = buildEntryMap(inputEntries, targetEntryKeyField);

    // For incremental updates, only consider provided entries.
    for (const [k, incoming] of inputMap.entries()) {
      const existing = baseMap.get(k);
      if (!existing) {
        patch.entries.upsert.push(incoming);
        // for new entries, minimal = full object (useful for export/preview)
        patch.entries.upsertMinimal.push(safeClone(incoming) || incoming);
        continue;
      }
      const fields = diffEntry(existing, incoming);
      if (fields.length) {
        patch.entries.upsert.push(incoming);
        // build minimal diff containing only changed fields + the entry key
        const minimal = {};
        for (const f of fields) {
          try { minimal[f.key] = incoming[f.key]; } catch (e) {}
        }
        // ensure key present so minimal can be mapped later
        if (targetEntryKeyField && !(targetEntryKeyField in minimal)) {
          try { minimal[targetEntryKeyField] = incoming[targetEntryKeyField]; } catch (e) {}
        }
        patch.entries.upsertMinimal.push(minimal);
      }
    }

    // If input is full and caller wants replacement semantics, compute removals.
    if (kind === 'full' && treatFullAsReplace) {
      for (const [k] of baseMap.entries()) {
        if (!inputMap.has(k)) patch.entries.removeKeys.push(k);
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

  // metadata
  if (!base.metadata || typeof base.metadata !== 'object') base.metadata = {};
  try {
    const set = p.metadata?.set && typeof p.metadata.set === 'object' ? p.metadata.set : {};
    for (const [k, v] of Object.entries(set)) {
      base.metadata[k] = v;
    }
    const unset = Array.isArray(p.metadata?.unset) ? p.metadata.unset : [];
    for (const k of unset) {
      try { delete base.metadata[String(k)]; } catch (e) {}
    }
  } catch (e) {}

  // schema lives under metadata.schema (preferred)
  try {
    const schema = Array.isArray(base.metadata.schema) ? base.metadata.schema.slice() : (Array.isArray(base.schema) ? base.schema.slice() : []);
    const map = schemaToMap(schema);

    const remove = Array.isArray(p.schema?.removeKeys) ? p.schema.removeKeys : [];
    for (const k of remove) map.delete(String(k));

    const upsert = Array.isArray(p.schema?.upsert) ? p.schema.upsert : [];
    for (const f of upsert) {
      if (!f || typeof f !== 'object') continue;
      const k = typeof f.key === 'string' ? f.key.trim() : '';
      if (!k) continue;
      map.set(k, f);
    }

    // preserve order: existing order first, then any new keys appended
    const existingOrder = schema.map(f => (f && typeof f.key === 'string') ? f.key.trim() : '').filter(Boolean);
    const newKeys = Array.from(map.keys()).filter(k => !existingOrder.includes(k));
    const out = [];
    for (const k of existingOrder) {
      const f = map.get(k);
      if (f) out.push(f);
    }
    for (const k of newKeys) {
      const f = map.get(k);
      if (f) out.push(f);
    }

    base.metadata.schema = out;
    if ('schema' in base) delete base.schema;
  } catch (e) {}

  // entries
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

    // removals
    const removeKeys = Array.isArray(p.entries?.removeKeys) ? p.entries.removeKeys : [];
    if (entryKeyField && removeKeys.length) {
      const removeSet = new Set(removeKeys.map(k => String(k)));
      for (let i = arr.length - 1; i >= 0; i--) {
        const e = arr[i];
        const k = (e && typeof e === 'object' && e[entryKeyField] != null) ? String(e[entryKeyField]).trim() : '';
        if (k && removeSet.has(k)) arr.splice(i, 1);
      }
    }

    // upserts (merge into existing; append new)
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
      // shallow merge to support partial updates
      arr[idx] = { ...existing, ...incoming };
    }

    base[arrayKey] = arr;
  } catch (e) {}

  return base;
}

export function summarizePatchAgainstBase({ baseCollection, patch } = {}) {
  const base = baseCollection && typeof baseCollection === 'object' ? baseCollection : { metadata: {} };
  const p = patch && typeof patch === 'object' ? patch : {};

  const metaSet = p.metadata?.set && typeof p.metadata.set === 'object' ? p.metadata.set : {};
  const metaUnset = Array.isArray(p.metadata?.unset) ? p.metadata.unset : [];
  const metadataChanges = Object.keys(metaSet).length + metaUnset.length;

  const schemaUpsert = Array.isArray(p.schema?.upsert) ? p.schema.upsert : [];
  const schemaRemove = Array.isArray(p.schema?.removeKeys) ? p.schema.removeKeys : [];
  const schemaChanges = schemaUpsert.length + schemaRemove.length;

  const arrayKey = String(p.targetArrayKey || detectCollectionArrayKey(base).key || 'entries');
  const entryKeyField = String(p.entryKeyField || inferEntryKeyField({ collection: base, arrayKey }) || '').trim();
  const baseEntries = Array.isArray(base?.[arrayKey]) ? base[arrayKey] : [];
  const baseMap = buildEntryMap(baseEntries, entryKeyField);

  const upsert = Array.isArray(p.entries?.upsert) ? p.entries.upsert : [];
  const removeKeys = Array.isArray(p.entries?.removeKeys) ? p.entries.removeKeys : [];

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
    // unknown keys: treat all upserts as new
    newEntries = upsert.length;
  }

  return {
    arrayKey,
    entryKeyField,
    metadataChanges,
    schemaChanges,
    entriesUpsert: upsert.length,
    entriesRemove: removeKeys.length,
    newEntries,
    editedEntries,
  };
}
