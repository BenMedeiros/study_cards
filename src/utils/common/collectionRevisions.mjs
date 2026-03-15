/**
 * Shared collection revision helpers.
 *
 * Works on parsed collection objects and revision records after `JSON.parse`, not on raw
 * storage rows. Normalizes generic collection/revision records, groups revisions by
 * collection, resolves revision chains, and produces normalized diff/snapshot records.
 */

import { applyPatchToCollection } from './collectionDiff.mjs';
import { normalizeCollectionBlob } from './collectionParser.mjs';

function safeClone(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch { return null; }
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isRevisionLike(value) {
  if (!isObject(value)) return false;
  return (
    typeof value.id === 'string' ||
    typeof value.collectionKey === 'string' ||
    typeof value.kind === 'string' ||
    isObject(value.patch) ||
    isObject(value.blob)
  );
}

function pickRevisionPayload(value) {
  const raw = isObject(value) ? value : null;
  const nested = isObject(raw?.value) ? raw.value : null;
  if (isRevisionLike(raw)) return { envelope: raw, payload: raw };
  if (isRevisionLike(nested)) return { envelope: raw, payload: nested };
  return { envelope: raw, payload: nested || raw };
}

function compareByCreatedAtThenId(a, b) {
  const createdAtA = String(a?.createdAt || '');
  const createdAtB = String(b?.createdAt || '');
  if (createdAtA !== createdAtB) return createdAtA.localeCompare(createdAtB);
  return String(a?.id || '').localeCompare(String(b?.id || ''));
}

export function currentTimestampIso() {
  try { return (new Date()).toISOString(); } catch { return ''; }
}

function randomIdFragment() {
  try {
    const cryptoObj = globalThis?.crypto;
    if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
      const parts = new Uint32Array(2);
      cryptoObj.getRandomValues(parts);
      return `${parts[0].toString(16)}${parts[1].toString(16)}`;
    }
  } catch {}
  return Math.random().toString(16).slice(2);
}

export function createRevisionId() {
  const ts = (() => {
    try { return Date.now(); } catch { return 0; }
  })();
  return `rev_${ts}_${randomIdFragment()}`;
}

function createEmptyCollection(collectionKey) {
  return {
    metadata: {
      name: String(collectionKey || '').trim() || null,
      version: 1,
    },
    entries: [],
  };
}

export function normalizeCollectionRecord(value, fallbackKey = '') {
  const raw = isObject(value) ? value : null;
  const candidate = isObject(raw?.collection)
    ? raw.collection
    : (isObject(raw?.data)
      ? raw.data
      : (isObject(raw?.value) ? raw.value : raw));
  if (!isObject(candidate)) return null;

  const key = String(raw?.key || raw?.path || raw?.collectionKey || fallbackKey || '').trim();
  const path = String(raw?.path || raw?.key || raw?.collectionPath || key || fallbackKey || '').trim();
  const collection = safeClone(candidate) || candidate;

  return {
    key: key || path,
    path: path || key,
    collection: normalizeCollectionBlob(collection),
    filePath: typeof raw?.filePath === 'string' ? raw.filePath : null,
    sourcePath: typeof raw?.sourcePath === 'string' ? raw.sourcePath : null,
  };
}

export function normalizeCollectionRecordSet(collections) {
  const out = [];

  if (collections instanceof Map) {
    for (const [key, value] of collections.entries()) {
      const record = normalizeCollectionRecord(value, key);
      if (record) out.push(record);
    }
  } else if (Array.isArray(collections)) {
    for (let index = 0; index < collections.length; index += 1) {
      const record = normalizeCollectionRecord(collections[index], String(index));
      if (record) out.push(record);
    }
  } else if (isObject(collections)) {
    for (const [key, value] of Object.entries(collections)) {
      const record = normalizeCollectionRecord(value, key);
      if (record) out.push(record);
    }
  }

  out.sort((a, b) => String(a.path || a.key).localeCompare(String(b.path || b.key), 'ja'));
  return out;
}

export function buildCollectionRecordMap(collections) {
  const map = new Map();
  const records = normalizeCollectionRecordSet(collections);
  for (const record of records) {
    const keys = [record?.key, record?.path].filter(Boolean);
    for (const key of keys) {
      if (!map.has(key)) map.set(key, record);
    }
  }
  return map;
}

export function normalizeRevisionRecord(value, fallbackId = '') {
  const { envelope, payload } = pickRevisionPayload(value);
  if (!isObject(payload)) return null;

  const id = String(payload.id || envelope?.id || envelope?.key || fallbackId || '').trim();
  const collectionKey = String(
    payload.collectionKey ||
    envelope?.collectionKey ||
    payload.collection ||
    envelope?.collection ||
    ''
  ).trim();

  let kind = String(payload.kind || envelope?.kind || '').trim();
  if (!kind) {
    if (isObject(payload.blob)) kind = 'snapshot';
    else if (isObject(payload.patch)) kind = 'diff';
  }

  const patch = isObject(payload.patch) ? (safeClone(payload.patch) || payload.patch) : null;
  const blob = isObject(payload.blob) ? (safeClone(payload.blob) || payload.blob) : null;

  if (!id || !collectionKey || (kind !== 'diff' && kind !== 'snapshot')) return null;

  return {
    id,
    collectionKey,
    kind,
    createdAt: typeof payload.createdAt === 'string' ? payload.createdAt : (typeof envelope?.createdAt === 'string' ? envelope.createdAt : null),
    parentId: typeof payload.parentId === 'string' && payload.parentId.trim() ? payload.parentId.trim() : null,
    label: typeof payload.label === 'string' && payload.label.trim() ? payload.label.trim() : null,
    patch,
    blob,
    sourcePath: typeof envelope?.sourcePath === 'string' ? envelope.sourcePath : null,
    sourceFilePath: typeof envelope?.sourceFilePath === 'string' ? envelope.sourceFilePath : null,
  };
}

export function normalizeRevisionSet(revisions) {
  const out = [];

  if (revisions instanceof Map) {
    for (const [key, value] of revisions.entries()) {
      const record = normalizeRevisionRecord(value, key);
      if (record) out.push(record);
    }
  } else if (Array.isArray(revisions)) {
    for (let index = 0; index < revisions.length; index += 1) {
      const record = normalizeRevisionRecord(revisions[index], String(index));
      if (record) out.push(record);
    }
  } else if (isObject(revisions)) {
    for (const [key, value] of Object.entries(revisions)) {
      const record = normalizeRevisionRecord(value, key);
      if (record) out.push(record);
    }
  }

  out.sort(compareByCreatedAtThenId);
  return out;
}

export function groupRevisionsByCollection(revisions) {
  const map = new Map();
  const records = normalizeRevisionSet(revisions);
  for (const record of records) {
    const key = String(record?.collectionKey || '').trim();
    if (!key) continue;
    const bucket = map.get(key) || [];
    bucket.push(record);
    map.set(key, bucket);
  }
  return map;
}

export function buildRevisionMap(revisions, { collectionKey = null } = {}) {
  const map = new Map();
  const records = normalizeRevisionSet(revisions)
    .filter((record) => !collectionKey || record.collectionKey === collectionKey);
  for (const record of records) map.set(record.id, record);
  return map;
}

export function buildRevisionChain({ revisionId, revisionsById, strictParents = false } = {}) {
  const rid = String(revisionId || '').trim();
  if (!rid) return [];
  const map = revisionsById instanceof Map ? revisionsById : new Map();
  if (!map.has(rid)) {
    if (strictParents) throw new Error(`Revision not found: ${rid}`);
    return [];
  }

  const out = [];
  const seen = new Set();
  let cur = rid;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const rec = map.get(cur);
    if (!rec) {
      if (strictParents) throw new Error(`Revision not found: ${cur}`);
      break;
    }
    out.push(rec);
    const parentId = typeof rec.parentId === 'string' && rec.parentId.trim() ? rec.parentId.trim() : '';
    if (parentId && !map.has(parentId)) {
      if (strictParents) throw new Error(`Missing parent revision ${parentId} for ${rec.id}`);
      break;
    }
    cur = parentId;
  }
  out.reverse();
  return out;
}

export function getRevisionLeafIds(revisions, { collectionKey = null } = {}) {
  const records = normalizeRevisionSet(revisions)
    .filter((record) => !collectionKey || record.collectionKey === collectionKey);
  const ids = new Set(records.map((record) => record.id));
  const parentIds = new Set();

  for (const record of records) {
    const parentId = typeof record.parentId === 'string' ? record.parentId.trim() : '';
    if (parentId && ids.has(parentId)) parentIds.add(parentId);
  }

  return records
    .filter((record) => !parentIds.has(record.id))
    .map((record) => record.id);
}

export function selectRevisionHead({ revisions, collectionKey = null, preferredRevisionId = null, onMultipleLeaves = 'error' } = {}) {
  const records = normalizeRevisionSet(revisions)
    .filter((record) => !collectionKey || record.collectionKey === collectionKey);
  if (!records.length) return null;

  const preferred = String(preferredRevisionId || '').trim();
  if (preferred) {
    if (!records.some((record) => record.id === preferred)) {
      throw new Error(`Preferred revision not found for ${collectionKey || 'collection'}: ${preferred}`);
    }
    return preferred;
  }

  const leafIds = getRevisionLeafIds(records);
  if (leafIds.length <= 1) return leafIds[0] || records[records.length - 1].id;

  if (onMultipleLeaves === 'latest-created' || onMultipleLeaves === 'latest-createdAt') {
    const leaves = records.filter((record) => leafIds.includes(record.id)).sort(compareByCreatedAtThenId);
    return leaves.length ? leaves[leaves.length - 1].id : null;
  }

  throw new Error(
    `Multiple revision heads found for ${collectionKey || 'collection'}: ${leafIds.join(', ')}`
  );
}

export function resolveCollectionAtRevision({
  collectionKey,
  revisionId,
  baseCollection = null,
  revisions = [],
  revisionsById = null,
  fallbackToEmpty = true,
  strictParents = false,
  annotateRevision = false,
} = {}) {
  const key = String(collectionKey || '').trim();
  if (!key) throw new Error('collectionKey required');

  const base = isObject(baseCollection) ? (safeClone(baseCollection) || baseCollection) : null;
  const map = revisionsById instanceof Map
    ? revisionsById
    : buildRevisionMap(revisions, { collectionKey: key });
  const rid = String(revisionId || '').trim();

  if (!rid) {
    if (base) return normalizeCollectionBlob(base);
    if (fallbackToEmpty) return createEmptyCollection(key);
    throw new Error(`revisionId required for ${key}`);
  }

  const chain = buildRevisionChain({ revisionId: rid, revisionsById: map, strictParents });
  if (!chain.length) {
    if (base) return normalizeCollectionBlob(base);
    if (fallbackToEmpty) return createEmptyCollection(key);
    throw new Error(`No revision chain found for ${key} at ${rid}`);
  }

  let out = base ? normalizeCollectionBlob(base) : null;
  if (!out) {
    const snapshot = chain.find((record) => record.kind === 'snapshot' && isObject(record.blob));
    if (snapshot) out = normalizeCollectionBlob(safeClone(snapshot.blob) || snapshot.blob);
  }

  if (!out) {
    if (!fallbackToEmpty) throw new Error(`No base collection or snapshot found for ${key}`);
    out = createEmptyCollection(key);
  }

  for (const record of chain) {
    if (!record || typeof record !== 'object') continue;
    if (record.kind === 'snapshot' && isObject(record.blob)) {
      out = normalizeCollectionBlob(safeClone(record.blob) || record.blob);
      continue;
    }
    if (record.kind === 'diff' && isObject(record.patch)) {
      out = applyPatchToCollection({ baseCollection: out, patch: record.patch });
    }
  }

  if (annotateRevision) {
    if (!out.metadata || typeof out.metadata !== 'object') out.metadata = {};
    out.metadata._active_revision = rid;
  }

  return out;
}

export function resolveCollectionsAtHeads({
  collections = [],
  revisions = [],
  headByCollection = null,
  onMultipleLeaves = 'error',
  fallbackToEmpty = false,
  strictParents = false,
  annotateRevision = false,
} = {}) {
  const collectionMap = buildCollectionRecordMap(collections);
  const grouped = groupRevisionsByCollection(revisions);
  const resolved = [];

  for (const [collectionKey, collectionRevisions] of grouped.entries()) {
    const baseRecord = collectionMap.get(collectionKey) || null;
    const preferredRevisionId = headByCollection && typeof headByCollection === 'object'
      ? headByCollection[collectionKey]
      : null;
    const headRevisionId = selectRevisionHead({
      revisions: collectionRevisions,
      collectionKey,
      preferredRevisionId,
      onMultipleLeaves,
    });

    const collection = resolveCollectionAtRevision({
      collectionKey,
      revisionId: headRevisionId,
      baseCollection: baseRecord?.collection || null,
      revisions: collectionRevisions,
      fallbackToEmpty,
      strictParents,
      annotateRevision,
    });

    resolved.push({
      key: collectionKey,
      path: baseRecord?.path || collectionKey,
      filePath: baseRecord?.filePath || null,
      collection,
      headRevisionId,
      revisions: collectionRevisions.slice(),
    });
  }

  resolved.sort((a, b) => String(a.path || a.key).localeCompare(String(b.path || b.key), 'ja'));
  return resolved;
}

export function createPatchRevisionRecord({ collectionKey, patch, parentId = null, id, createdAt = null, label = null } = {}) {
  const key = String(collectionKey || '').trim();
  const rid = String(id || '').trim();
  const normalizedPatch = isObject(patch) ? (safeClone(patch) || patch) : null;
  if (!key) throw new Error('collectionKey required');
  if (!rid) throw new Error('id required');
  if (!normalizedPatch) throw new Error('patch required');

  return {
    id: rid,
    collectionKey: key,
    kind: 'diff',
    createdAt: typeof createdAt === 'string' && createdAt.trim() ? createdAt.trim() : null,
    parentId: typeof parentId === 'string' && parentId.trim() ? parentId.trim() : null,
    label: typeof label === 'string' && label.trim() ? label.trim() : null,
    patch: normalizedPatch,
  };
}

export function createSnapshotRevisionRecord({ collectionKey, blob, parentId = null, id, createdAt = null, label = null } = {}) {
  const key = String(collectionKey || '').trim();
  const rid = String(id || '').trim();
  const normalizedBlob = isObject(blob) ? (safeClone(blob) || blob) : null;
  if (!key) throw new Error('collectionKey required');
  if (!rid) throw new Error('id required');
  if (!normalizedBlob) throw new Error('blob required');

  return {
    id: rid,
    collectionKey: key,
    kind: 'snapshot',
    createdAt: typeof createdAt === 'string' && createdAt.trim() ? createdAt.trim() : null,
    parentId: typeof parentId === 'string' && parentId.trim() ? parentId.trim() : null,
    label: typeof label === 'string' && label.trim() ? label.trim() : null,
    blob: normalizedBlob,
    patch: null,
  };
}

export default {
  currentTimestampIso,
  createRevisionId,
  normalizeCollectionRecord,
  normalizeCollectionRecordSet,
  buildCollectionRecordMap,
  normalizeRevisionRecord,
  normalizeRevisionSet,
  groupRevisionsByCollection,
  buildRevisionMap,
  buildRevisionChain,
  getRevisionLeafIds,
  selectRevisionHead,
  resolveCollectionAtRevision,
  resolveCollectionsAtHeads,
  createPatchRevisionRecord,
  createSnapshotRevisionRecord,
};