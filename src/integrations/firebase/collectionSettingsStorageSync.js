import {
  getDownloadURL,
  ref,
  uploadBytes,
} from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-storage.js';

import { firebaseAuth, firebaseStorage } from './firebaseApp.js';
import { createCompressedCollectionSettingsSnapshot } from './collectionSettingsSnapshot.js';

function requireSignedInUser() {
  const user = firebaseAuth.currentUser;
  if (!user?.uid) {
    throw new Error('A signed-in Firebase user is required to upload collection settings');
  }
  return user;
}

export function buildCollectionSettingsSnapshotPath(uid) {
  const safeUid = String(uid || '').trim();
  if (!safeUid) throw new Error('uid is required');
  return `users/${safeUid}/snapshots/collection_settings/latest.json.gz`;
}

export async function uploadCollectionSettingsSnapshot({ path = null, metadata = null } = {}) {
  const user = requireSignedInUser();
  const payload = await createCompressedCollectionSettingsSnapshot();
  const objectPath = path || buildCollectionSettingsSnapshotPath(user.uid);
  const storageRef = ref(firebaseStorage, objectPath);
  const uploadMetadata = {
    contentType: payload.contentType,
    cacheControl: 'no-store',
    customMetadata: {
      uid: user.uid,
      snapshotType: payload.snapshot.snapshotType,
      dbName: payload.snapshot.dbName,
      storeName: payload.snapshot.storeName,
      createdAt: payload.snapshot.createdAt,
      rowCount: String(payload.snapshot.rowCount),
      ...(metadata && typeof metadata === 'object' ? metadata : {}),
    },
  };
  const result = await uploadBytes(storageRef, payload.gzipBlob, uploadMetadata);
  const downloadURL = await getDownloadURL(result.ref);
  return {
    path: objectPath,
    downloadURL,
    size: payload.gzipBlob.size,
    snapshot: payload.snapshot,
    uploadedAt: new Date().toISOString(),
  };
}