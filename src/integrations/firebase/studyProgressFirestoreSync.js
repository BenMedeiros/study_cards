import {
  deleteField,
  doc,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js';

import { firebaseAuth, firebaseDb } from './firebaseApp.js';
import {
  idbGet,
  idbGetAll,
  idbPut,
} from '../../utils/browser/idb.js';

function requireSignedInUser() {
  const user = firebaseAuth.currentUser;
  if (!user?.uid) {
    throw new Error('A signed-in Firebase user is required to sync study progress');
  }
  return user;
}

function normalizeValue(value) {
  return String(value ?? '').trim();
}

function normalizeBoolean(value) {
  return value === true;
}

function normalizeWholeNumber(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function cloneObject(value) {
  return (value && typeof value === 'object' && !Array.isArray(value)) ?
    { ...value } :
    {};
}

function buildStudyId(collectionKey, entryKey) {
  const collection = normalizeValue(collectionKey);
  const key = normalizeValue(entryKey);
  if (!collection || !key) return '';
  return `${collection}|${key}`;
}

function encodeCollectionDocId(collectionKey) {
  const normalizedCollectionKey = normalizeValue(collectionKey);
  if (!normalizedCollectionKey) throw new Error('collectionKey is required');
  return encodeURIComponent(normalizedCollectionKey);
}

function normalizeStudyState(value) {
  const normalized = normalizeValue(value);
  return (normalized === 'unseen' || normalized === 'seen' || normalized === 'focus' || normalized === 'learned') ? normalized : '';
}

function readEntryValueByPath(entry, keyPath) {
  if (!entry || typeof entry !== 'object') return '';
  const path = normalizeValue(keyPath);
  if (!path) return '';

  const direct = entry[path];
  if (direct != null && String(direct).trim()) return String(direct).trim();

  const parts = path.split('.').map((part) => normalizeValue(part)).filter(Boolean);
  if (!parts.length) return '';

  let current = entry;
  for (const part of parts) {
    if (!current || typeof current !== 'object') return '';
    current = current[part];
  }
  if (current == null) return '';
  return String(current).trim();
}

function getCollectionEntryStudyKey(entry, collection) {
  if (!entry || typeof entry !== 'object') return '';

  const metadataEntryKey = normalizeValue(collection?.metadata?.entry_key);
  if (metadataEntryKey) {
    const explicit = readEntryValueByPath(entry, metadataEntryKey);
    if (explicit) return explicit;
  }

  for (const candidateKey of ['kanji', 'character', 'text', 'word', 'reading', 'kana', 'id', 'key', 'value', 'name', 'title', 'term', 'lowercase', 'uppercase', 'pattern']) {
    const candidate = entry[candidateKey];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    if (typeof candidate === 'number' || typeof candidate === 'boolean') return String(candidate);
  }

  return '';
}

async function loadCollectionEntryKeys(collectionKey) {
  const normalizedCollectionKey = normalizeValue(collectionKey);
  if (!normalizedCollectionKey) return [];

  const systemRow = await idbGet('system_collections', normalizedCollectionKey).catch(() => null);
  const collection = (systemRow?.blob && typeof systemRow.blob === 'object') ? systemRow.blob : null;
  const entries = Array.isArray(collection?.entries) ? collection.entries : [];
  if (!entries.length) return [];

  const out = [];
  const seen = new Set();
  for (const entry of entries) {
    const entryKey = normalizeValue(getCollectionEntryStudyKey(entry, collection));
    if (!entryKey || seen.has(entryKey)) continue;
    seen.add(entryKey);
    out.push(entryKey);
  }
  out.sort((left, right) => left.localeCompare(right));
  return out;
}

function buildSyncStateId(entityType, entityKey) {
  const normalizedType = normalizeValue(entityType);
  const normalizedKey = normalizeValue(entityKey);
  if (!normalizedType || !normalizedKey) {
    throw new Error('entityType and entityKey are required');
  }
  return `${normalizedType}|${normalizedKey}`;
}

export function encodeStudyProgressDocId(collectionKey, entryKey) {
  const studyId = buildStudyId(collectionKey, entryKey);
  if (!studyId) throw new Error('collectionKey and entryKey are required');
  return encodeURIComponent(studyId);
}

function normalizeStudyProgressRow(row) {
  const id = normalizeValue(row?.id);
  if (!id) return null;
  const collectionKey = normalizeValue(row?.collection);
  const entryKey = normalizeValue(row?.entryKey);
  if (!collectionKey || !entryKey) return null;

  const value = cloneObject(row?.value);
  const apps = cloneObject(value.apps);
  const appIds = Object.keys(apps)
    .map((appId) => normalizeValue(appId))
    .filter(Boolean);
  const state = normalizeStudyState(value.state) || (normalizeBoolean(value.seen) ? 'seen' : null);

  return {
    studyId: id,
    collectionKey,
    entryKey,
    state,
    timesSeen: normalizeWholeNumber(value.timesSeen),
    timeMs: normalizeWholeNumber(value.timeMs),
    lastSeenIso: normalizeValue(value.lastSeenIso) || null,
    apps,
    appIds,
  };
}

async function writeStudyProgressRows(rows, opts = {}) {
  const normalizedRows = rows
    .map((row) => normalizeStudyProgressRow(row))
    .filter(Boolean);
  if (!normalizedRows.length) {
    return {
      userId: requireSignedInUser().uid,
      count: 0,
      rows: [],
    };
  }

  const user = requireSignedInUser();
  const batch = writeBatch(firebaseDb);
  for (const row of normalizedRows) {
    const docId = encodeStudyProgressDocId(row.collectionKey, row.entryKey);
    const docRef = doc(firebaseDb, 'users', user.uid, 'study_progress', docId);
    batch.set(docRef, {
      ...row,
      seen: deleteField(),
      source: 'browser.indexeddb.study_progress',
      syncedAt: serverTimestamp(),
      ...(opts && typeof opts === 'object' ? opts : {}),
    }, { merge: true });
  }
  await batch.commit();

  return {
    userId: user.uid,
    count: normalizedRows.length,
    rows: normalizedRows,
  };
}

export async function syncStudyProgressRecord(
  entryKeyOrStudyId,
  { collectionKey = '', ...opts } = {},
) {
  const raw = normalizeValue(entryKeyOrStudyId);
  if (!raw) throw new Error('entryKeyOrStudyId is required');

  let studyId = raw;
  if (!raw.includes('|')) {
    studyId = buildStudyId(collectionKey, raw);
  }
  if (!studyId) {
    throw new Error('collectionKey is required when studyId is not provided');
  }

  const row = await idbGet('study_progress', studyId);
  if (!row) {
    throw new Error(`No study_progress row found for ${studyId}`);
  }

  return await writeStudyProgressRows([row], opts);
}

export async function syncStudyProgressCollection(collectionKey, opts = {}) {
  const normalizedCollectionKey = normalizeValue(collectionKey);
  if (!normalizedCollectionKey) throw new Error('collectionKey is required');
  const rows = await idbGetAll('study_progress');
  const matches = rows.filter((row) =>
    normalizeValue(row?.collection) === normalizedCollectionKey);
  return await writeStudyProgressRows(matches, opts);
}

export async function syncAllStudyProgressRecords(opts = {}) {
  const rows = await idbGetAll('study_progress');
  return await writeStudyProgressRows(rows, opts);
}

async function buildStudyProgressStateSnapshot(collectionIdOrCandidates) {
  const candidates = Array.isArray(collectionIdOrCandidates) ?
    collectionIdOrCandidates :
    [collectionIdOrCandidates];
  const normalizedCandidates = candidates
    .map((value) => normalizeValue(value))
    .filter(Boolean);
  if (!normalizedCandidates.length) {
    throw new Error('A collection key is required to sync study progress state');
  }

  const rows = await idbGetAll('study_progress');
  const matchingRows = rows.filter((row) =>
    normalizedCandidates.includes(normalizeValue(row?.collection)));
  const collectionKey = normalizeValue(matchingRows[0]?.collection) || normalizedCandidates[0];
  const collectionEntryKeys = await loadCollectionEntryKeys(collectionKey);
  const states = {
    unseen: [],
    seen: [],
    focus: [],
    learned: [],
  };
  const seenUnseen = new Set();
  const seenSeen = new Set();
  const seenFocus = new Set();
  const seenLearned = new Set();

  for (const row of matchingRows) {
    const normalizedRow = normalizeStudyProgressRow(row);
    if (!normalizedRow || normalizeValue(normalizedRow.collectionKey) !== collectionKey) continue;
    const state = normalizeStudyState(normalizedRow.state);
    const entryKey = normalizeValue(normalizedRow.entryKey);
    if (!entryKey) continue;

    if (!state || state === 'unseen') {
      if (seenUnseen.has(entryKey)) continue;
      seenUnseen.add(entryKey);
      states.unseen.push(entryKey);
      continue;
    }

    if (state === 'seen') {
      if (seenSeen.has(entryKey)) continue;
      seenSeen.add(entryKey);
      states.seen.push(entryKey);
      continue;
    }

    if (state === 'focus') {
      if (seenFocus.has(entryKey)) continue;
      seenFocus.add(entryKey);
      states.focus.push(entryKey);
      continue;
    }

    if (seenLearned.has(entryKey)) continue;
    seenLearned.add(entryKey);
    states.learned.push(entryKey);
  }

  for (const entryKey of collectionEntryKeys) {
    if (!entryKey) continue;
    if (seenSeen.has(entryKey) || seenFocus.has(entryKey) || seenLearned.has(entryKey) || seenUnseen.has(entryKey)) continue;
    seenUnseen.add(entryKey);
    states.unseen.push(entryKey);
  }

  states.unseen.sort((left, right) => left.localeCompare(right));
  states.seen.sort((left, right) => left.localeCompare(right));
  states.focus.sort((left, right) => left.localeCompare(right));
  states.learned.sort((left, right) => left.localeCompare(right));

  return {
    collectionKey,
    docId: encodeCollectionDocId(collectionKey),
    states,
    schemaVersion: 3,
  };
}

function getCollectionKeyHint(collectionIdOrCandidates) {
  const candidates = Array.isArray(collectionIdOrCandidates) ?
    collectionIdOrCandidates :
    [collectionIdOrCandidates];
  const normalizedCandidates = candidates
    .map((value) => normalizeValue(value))
    .filter(Boolean);
  return normalizedCandidates[0] || '';
}

function normalizeSyncStateRecord(record) {
  if (!record || typeof record !== 'object') return null;
  return {
    id: normalizeValue(record.id),
    entityType: normalizeValue(record.entityType),
    entityKey: normalizeValue(record.entityKey),
    status: normalizeValue(record.status) || null,
    dirty: record.dirty === true,
    lastAttemptIso: normalizeValue(record.lastAttemptIso) || null,
    lastSuccessIso: normalizeValue(record.lastSuccessIso) || null,
    lastError: normalizeValue(record.lastError) || null,
    docSize: normalizeWholeNumber(record.docSize),
    lastAttemptDocSize: normalizeWholeNumber(record.lastAttemptDocSize),
    lastSyncedDocSize: normalizeWholeNumber(record.lastSyncedDocSize),
    lastSyncedPayload:
      (record.lastSyncedPayload && typeof record.lastSyncedPayload === 'object') ?
        record.lastSyncedPayload :
        null,
  };
}

function estimateJsonSizeBytes(value) {
  try {
    const text = JSON.stringify(value ?? null);
    return new TextEncoder().encode(text).length;
  } catch {
    return 0;
  }
}

function areJsonEqual(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function uniqueSorted(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map((value) =>
    normalizeValue(value)).filter(Boolean))).sort((left, right) => left.localeCompare(right));
}

function diffStateArrays(previousValues, nextValues) {
  const previous = uniqueSorted(previousValues);
  const next = uniqueSorted(nextValues);
  const previousSet = new Set(previous);
  const nextSet = new Set(next);
  return {
    added: next.filter((value) => !previousSet.has(value)),
    removed: previous.filter((value) => !nextSet.has(value)),
  };
}

function buildStudyProgressPayloadDiff(previousPayload, nextPayload) {
  const previous = (previousPayload && typeof previousPayload === 'object') ? previousPayload : null;
  const next = (nextPayload && typeof nextPayload === 'object') ? nextPayload : null;
  const previousStates = (previous?.states && typeof previous.states === 'object') ? previous.states : {};
  const nextStates = (next?.states && typeof next.states === 'object') ? next.states : {};

  return {
    collectionKey: {
      previous: normalizeValue(previous?.collectionKey) || null,
      next: normalizeValue(next?.collectionKey) || null,
      same: normalizeValue(previous?.collectionKey) === normalizeValue(next?.collectionKey),
    },
    schemaVersion: {
      previous: previous?.schemaVersion ?? null,
      next: next?.schemaVersion ?? null,
      same: (previous?.schemaVersion ?? null) === (next?.schemaVersion ?? null),
    },
    states: {
      unseen: diffStateArrays(previousStates.unseen, nextStates.unseen),
      seen: diffStateArrays(previousStates.seen, nextStates.seen),
      focus: diffStateArrays(previousStates.focus, nextStates.focus),
      learned: diffStateArrays(previousStates.learned, nextStates.learned),
    },
  };
}

async function getSyncStateRecord(entityType, entityKey) {
  const id = buildSyncStateId(entityType, entityKey);
  const record = await idbGet('firebase_sync_state', id).catch(() => null);
  return normalizeSyncStateRecord(record);
}

async function writeSyncStateRecord(record) {
  if (!record || typeof record !== 'object') return null;
  await idbPut('firebase_sync_state', record);
  return record;
}

export async function getStudyProgressStateSyncStatus(collectionIdOrCandidates) {
  const snapshot = await buildStudyProgressStateSnapshot(collectionIdOrCandidates);
  const docSize = estimateJsonSizeBytes(snapshot);
  const syncState = await getSyncStateRecord('study_progress_state', snapshot.collectionKey);
  const needsSync = !syncState?.lastSyncedPayload ||
    !areJsonEqual(syncState.lastSyncedPayload, snapshot);

  return {
    entityType: 'study_progress_state',
    entityKey: snapshot.collectionKey,
    needsSync,
    payload: snapshot,
    docSize,
    syncState,
    diff: buildStudyProgressPayloadDiff(syncState?.lastSyncedPayload || null, snapshot),
  };
}

export async function markStudyProgressStateDirty(collectionIdOrCandidates, opts = {}) {
  const snapshot = await buildStudyProgressStateSnapshot(collectionIdOrCandidates);
  const docSize = estimateJsonSizeBytes(snapshot);
  const prior = await getSyncStateRecord('study_progress_state', snapshot.collectionKey);
  const nowIso = new Date().toISOString();
  await writeSyncStateRecord({
    id: buildSyncStateId('study_progress_state', snapshot.collectionKey),
    entityType: 'study_progress_state',
    entityKey: snapshot.collectionKey,
    status: normalizeValue(opts.status) || prior?.status || 'dirty',
    dirty: true,
    docSize,
    lastAttemptDocSize: prior?.lastAttemptDocSize || 0,
    lastSyncedDocSize: prior?.lastSyncedDocSize || 0,
    lastAttemptIso: prior?.lastAttemptIso || null,
    lastSuccessIso: prior?.lastSuccessIso || null,
    lastError: prior?.lastError || null,
    markedDirtyIso: nowIso,
    lastSyncedPayload: prior?.lastSyncedPayload || null,
  });

  return {
    entityType: 'study_progress_state',
    entityKey: snapshot.collectionKey,
    dirty: true,
  };
}

export async function syncStudyProgressStateSnapshot(collectionIdOrCandidates, opts = {}) {
  const user = requireSignedInUser();
  const snapshot = await buildStudyProgressStateSnapshot(collectionIdOrCandidates);
  const docSize = estimateJsonSizeBytes(snapshot);
  const nowIso = new Date().toISOString();
  const docRef = doc(firebaseDb, 'users', user.uid, 'study_progress_state', snapshot.docId);
  const syncStateId = buildSyncStateId('study_progress_state', snapshot.collectionKey);
  const prior = await getSyncStateRecord('study_progress_state', snapshot.collectionKey);

  try {
    await writeSyncStateRecord({
      id: syncStateId,
      entityType: 'study_progress_state',
      entityKey: snapshot.collectionKey,
      status: 'pending',
      dirty: true,
      docSize,
      lastAttemptDocSize: docSize,
      lastSyncedDocSize: prior?.lastSyncedDocSize || 0,
      lastAttemptIso: nowIso,
      lastSuccessIso: prior?.lastSuccessIso || null,
      lastError: null,
      lastSyncedPayload: prior?.lastSyncedPayload || null,
    });

    await setDoc(docRef, {
      collectionKey: snapshot.collectionKey,
      states: snapshot.states,
      schemaVersion: snapshot.schemaVersion,
      updatedAt: serverTimestamp(),
      source: 'collectionsView.rowAction',
      ...(opts && typeof opts === 'object' ? opts : {}),
    }, { merge: true });

    await writeSyncStateRecord({
      id: syncStateId,
      entityType: 'study_progress_state',
      entityKey: snapshot.collectionKey,
      status: 'success',
      dirty: false,
      docSize,
      lastAttemptDocSize: docSize,
      lastSyncedDocSize: docSize,
      lastAttemptIso: nowIso,
      lastSuccessIso: nowIso,
      lastError: null,
      lastSyncedPayload: snapshot,
    });
  } catch (error) {
    const prior = await getSyncStateRecord('study_progress_state', snapshot.collectionKey);
    await writeSyncStateRecord({
      id: syncStateId,
      entityType: 'study_progress_state',
      entityKey: snapshot.collectionKey,
      status: 'error',
      dirty: true,
      docSize,
      lastAttemptDocSize: docSize,
      lastSyncedDocSize: prior?.lastSyncedDocSize || 0,
      lastAttemptIso: nowIso,
      lastSuccessIso: prior?.lastSuccessIso || null,
      lastError: String(error?.message || error || 'Sync failed'),
      lastSyncedPayload: prior?.lastSyncedPayload || null,
    });
    throw error;
  }

  return {
    userId: user.uid,
    collectionKey: snapshot.collectionKey,
    docId: snapshot.docId,
    states: snapshot.states,
    schemaVersion: snapshot.schemaVersion,
  };
}
