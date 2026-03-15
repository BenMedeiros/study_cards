/**
 * Shared collection parsing and relation helpers.
 *
 * Works on parsed collection JSON objects after `JSON.parse`, not on raw JSON text.
 * Normalizes collection-shaped objects, reads relation config, resolves relation paths,
 * and attaches `relatedCollections` arrays onto parsed entry objects.
 */

function normalizeFolderPath(folderPath) {
  return String(folderPath || '').replace(/^\/+/, '').replace(/\/+$/, '');
}

function detectCollectionArrayKey(collection) {
  const coll = collection && typeof collection === 'object' ? collection : null;
  if (!coll) return { key: null, arr: null };

  const candidates = ['entries', 'sentences', 'paragraphs', 'items', 'cards'];
  for (const key of candidates) {
    if (Array.isArray(coll[key])) return { key, arr: coll[key] };
  }

  for (const [key, value] of Object.entries(coll)) {
    if (key === 'metadata' || key === 'schema') continue;
    if (Array.isArray(value)) return { key, arr: value };
  }

  return { key: null, arr: null };
}

export function normalizeCollectionBlob(blob, { defaultArrayKey = 'entries' } = {}) {
  if (Array.isArray(blob)) return { metadata: {}, [defaultArrayKey]: blob };
  if (!blob || typeof blob !== 'object') return { metadata: {}, [defaultArrayKey]: [] };
  const out = blob;
  if (!out.metadata || typeof out.metadata !== 'object') out.metadata = {};
  return out;
}

export function normalizeRelatedCollectionsConfig(value) {
  const arr = Array.isArray(value) ? value : [];
  const out = [];
  const seen = new Set();
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    const name = String(raw.name || '').trim();
    const path = String(raw.path || '').trim();
    const thisKey = String(raw.this_key || '').trim();
    const foreignKey = String(raw.foreign_key || '').trim();
    if (!name || !path || !thisKey || !foreignKey) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    const relation = { ...raw, name, path, this_key: thisKey, foreign_key: foreignKey };
    if (!Array.isArray(relation.fields)) delete relation.fields;
    out.push(relation);
  }
  return out;
}

export function parsePathExpression(expr) {
  const raw = String(expr || '').trim();
  if (!raw) return [];
  return raw
    .split('.')
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .map((part) => {
      const many = part.endsWith('[]');
      const key = many ? part.slice(0, -2) : part;
      return { key, many };
    })
    .filter((token) => !!token.key);
}

export function extractPathValues(obj, expr) {
  const tokens = parsePathExpression(expr);
  if (!obj || typeof obj !== 'object') return [];
  if (!tokens.length) return [];
  let nodes = [obj];
  for (const token of tokens) {
    const next = [];
    for (const node of nodes) {
      if (node == null) continue;
      const value = node[token.key];
      if (token.many) {
        if (Array.isArray(value)) {
          for (const item of value) next.push(item);
        }
      } else {
        next.push(value);
      }
    }
    nodes = next;
    if (!nodes.length) break;
  }
  return nodes;
}

export function normalizeRelatedLookupValues(values) {
  const out = [];
  const seen = new Set();
  const list = Array.isArray(values) ? values : [values];
  for (const raw of list) {
    if (raw == null) continue;
    const value = String(raw).trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function resolveRelatedCollectionPath(baseCollectionKey, relPath) {
  let path = String(relPath || '').trim();
  if (!path) return '';
  path = path.replace(/^\.\//, '').replace(/^collections\//, '');
  if (path.includes('/')) return path;
  const folder = normalizeFolderPath(
    typeof baseCollectionKey === 'string' && baseCollectionKey.includes('/')
      ? baseCollectionKey.slice(0, baseCollectionKey.lastIndexOf('/'))
      : ''
  );
  return folder ? `${folder}/${path}` : path;
}

export function extractCollectionRecords(blob) {
  if (Array.isArray(blob)) return blob;
  const normalized = normalizeCollectionBlob(blob, { defaultArrayKey: 'entries' });
  const detected = detectCollectionArrayKey(normalized);
  return Array.isArray(detected.arr) ? detected.arr : [];
}

export async function attachRelatedCollections(collection, collectionKey, { resolveCollection } = {}) {
  const coll = collection && typeof collection === 'object' ? collection : null;
  if (!coll) return coll;

  const records = extractCollectionRecords(coll);
  if (!records.length) return coll;

  const relations = normalizeRelatedCollectionsConfig(coll?.metadata?.relatedCollections);
  if (!relations.length) return coll;

  const resolver = typeof resolveCollection === 'function' ? resolveCollection : null;
  if (!resolver) return coll;

  for (const relation of relations) {
    const relName = relation.name;
    const relPath = resolveRelatedCollectionPath(collectionKey, relation.path);
    let foreign = null;
    if (relPath) {
      try {
        foreign = await resolver(relPath);
      } catch {
        foreign = null;
      }
    }

    const foreignRecords = extractCollectionRecords(foreign);
    const foreignIndex = new Map();
    for (const record of foreignRecords) {
      if (!record || typeof record !== 'object') continue;
      const values = normalizeRelatedLookupValues(extractPathValues(record, relation.foreign_key));
      for (const value of values) {
        const bucket = foreignIndex.get(value) || [];
        bucket.push(record);
        foreignIndex.set(value, bucket);
      }
    }

    for (const entry of records) {
      if (!entry || typeof entry !== 'object') continue;
      if (!entry.relatedCollections || typeof entry.relatedCollections !== 'object') entry.relatedCollections = {};

      const localValues = normalizeRelatedLookupValues(extractPathValues(entry, relation.this_key));
      const matches = [];
      const seen = new Set();
      for (const value of localValues) {
        const rows = foreignIndex.get(value) || [];
        for (const record of rows) {
          if (!record || typeof record !== 'object') continue;
          if (seen.has(record)) continue;
          seen.add(record);
          matches.push(record);
        }
      }

      entry.relatedCollections[relName] = matches;
    }
  }

  return coll;
}

export default {
  normalizeCollectionBlob,
  normalizeRelatedCollectionsConfig,
  parsePathExpression,
  extractPathValues,
  normalizeRelatedLookupValues,
  resolveRelatedCollectionPath,
  extractCollectionRecords,
  attachRelatedCollections,
};