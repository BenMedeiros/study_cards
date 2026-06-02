import { assertFirebaseSyncEnabled } from './config.js';
import { snapshotCollectionSetting } from './collectionSettingsSnapshot.js';

async function loadFirebaseSyncApi() {
  assertFirebaseSyncEnabled();
  const [api, app] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js'),
    import('./firebaseApp.js'),
  ]);
  const user = app.firebaseAuth.currentUser;
  if (!user?.uid) {
    throw new Error('A signed-in Firebase user is required to snapshot collection settings');
  }
  return { api, db: app.firebaseDb, user };
}

export function encodeCollectionSettingsDocId(collectionId) {
  const normalized = String(collectionId || '').trim();
  if (!normalized) throw new Error('collectionId is required');
  return encodeURIComponent(normalized);
}

export async function syncCollectionSettingSnapshot(collectionIdOrCandidates, opts = {}) {
  const { api, db, user } = await loadFirebaseSyncApi();
  const snapshot = await snapshotCollectionSetting(collectionIdOrCandidates);
  if (!snapshot?.row) {
    throw new Error('No collection_settings row found for the requested collection');
  }

  const collectionId = String(snapshot.row.id || '').trim();
  if (!collectionId) {
    throw new Error('Snapshot row is missing an id');
  }

  const docId = encodeCollectionSettingsDocId(collectionId);
  const docRef = api.doc(db, 'users', user.uid, 'collection_settings', docId);
  await api.setDoc(docRef, {
    schemaVersion: snapshot.schemaVersion,
    snapshotType: snapshot.snapshotType,
    dbName: snapshot.dbName,
    storeName: snapshot.storeName,
    collectionId,
    row: snapshot.row,
    clientSnapshotCreatedAt: snapshot.createdAt,
    syncedAt: api.serverTimestamp(),
    source: 'collectionsView.rowAction',
    ...(opts && typeof opts === 'object' ? opts : {}),
  }, { merge: true });

  return {
    userId: user.uid,
    collectionId,
    docId,
    snapshot,
  };
}
