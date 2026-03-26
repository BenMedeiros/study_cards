import {
  doc,
  serverTimestamp,
  setDoc,
} from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js';

import { firebaseAuth, firebaseDb } from './firebaseApp.js';
import { snapshotCollectionSetting } from './collectionSettingsSnapshot.js';

function requireSignedInUser() {
  const user = firebaseAuth.currentUser;
  if (!user?.uid) {
    throw new Error('A signed-in Firebase user is required to snapshot collection settings');
  }
  return user;
}

export function encodeCollectionSettingsDocId(collectionId) {
  const normalized = String(collectionId || '').trim();
  if (!normalized) throw new Error('collectionId is required');
  return encodeURIComponent(normalized);
}

export async function syncCollectionSettingSnapshot(collectionIdOrCandidates, opts = {}) {
  const user = requireSignedInUser();
  const snapshot = await snapshotCollectionSetting(collectionIdOrCandidates);
  if (!snapshot?.row) {
    throw new Error('No collection_settings row found for the requested collection');
  }

  const collectionId = String(snapshot.row.id || '').trim();
  if (!collectionId) {
    throw new Error('Snapshot row is missing an id');
  }

  const docId = encodeCollectionSettingsDocId(collectionId);
  const docRef = doc(firebaseDb, 'users', user.uid, 'collection_settings', docId);
  await setDoc(docRef, {
    schemaVersion: snapshot.schemaVersion,
    snapshotType: snapshot.snapshotType,
    dbName: snapshot.dbName,
    storeName: snapshot.storeName,
    collectionId,
    row: snapshot.row,
    clientSnapshotCreatedAt: snapshot.createdAt,
    syncedAt: serverTimestamp(),
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