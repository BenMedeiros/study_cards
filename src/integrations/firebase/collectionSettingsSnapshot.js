import * as idb from '../../utils/browser/idb.js';

const SNAPSHOT_SCHEMA_VERSION = 1;
const SNAPSHOT_TYPE = 'idb.collection_settings';
const SNAPSHOT_DB_NAME = 'study_cards';
const SNAPSHOT_STORE_NAME = 'collection_settings';

function cloneJson(value, fallback = null) {
  try {
    const cloned = JSON.parse(JSON.stringify(value));
    return cloned == null ? fallback : cloned;
  } catch {
    return fallback;
  }
}

export async function snapshotCollectionSettings() {
  const rows = await idb.idbGetAll(SNAPSHOT_STORE_NAME).catch(() => []);
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    snapshotType: SNAPSHOT_TYPE,
    dbName: SNAPSHOT_DB_NAME,
    storeName: SNAPSHOT_STORE_NAME,
    createdAt: new Date().toISOString(),
    rowCount: Array.isArray(rows) ? rows.length : 0,
    rows: Array.isArray(rows) ? rows.map((row) => cloneJson(row, row)).filter((row) => row != null) : [],
  };
}

export async function snapshotCollectionSetting(collectionIdOrCandidates) {
  const candidates = Array.isArray(collectionIdOrCandidates)
    ? collectionIdOrCandidates
    : [collectionIdOrCandidates];

  for (const rawCandidate of candidates) {
    const candidate = String(rawCandidate || '').trim();
    if (!candidate) continue;
    const row = await idb.idbGet(SNAPSHOT_STORE_NAME, candidate).catch(() => null);
    if (!row || typeof row !== 'object') continue;
    return {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      snapshotType: SNAPSHOT_TYPE,
      dbName: SNAPSHOT_DB_NAME,
      storeName: SNAPSHOT_STORE_NAME,
      createdAt: new Date().toISOString(),
      rowCount: 1,
      row: cloneJson(row, row),
    };
  }

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    snapshotType: SNAPSHOT_TYPE,
    dbName: SNAPSHOT_DB_NAME,
    storeName: SNAPSHOT_STORE_NAME,
    createdAt: new Date().toISOString(),
    rowCount: 0,
    row: null,
  };
}

export function serializeCollectionSettingsSnapshot(snapshot) {
  return JSON.stringify(snapshot, null, 2);
}

export async function gzipText(text) {
  if (typeof CompressionStream !== 'function') {
    throw new Error('CompressionStream gzip is not available in this browser');
  }
  const source = new Blob([String(text ?? '')], { type: 'application/json' });
  const compressedStream = source.stream().pipeThrough(new CompressionStream('gzip'));
  return await new Response(compressedStream).blob();
}

export async function createCompressedCollectionSettingsSnapshot() {
  const snapshot = await snapshotCollectionSettings();
  const json = serializeCollectionSettingsSnapshot(snapshot);
  const gzipBlob = await gzipText(json);
  return {
    snapshot,
    json,
    gzipBlob,
    fileName: 'collection_settings.snapshot.json.gz',
    contentType: 'application/gzip',
  };
}