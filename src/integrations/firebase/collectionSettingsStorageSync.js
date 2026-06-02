import { assertFirebaseSyncEnabled } from './config.js';
import { createCompressedCollectionSettingsSnapshot } from './collectionSettingsSnapshot.js';

async function loadFirebaseStorageApi() {
  assertFirebaseSyncEnabled();
  const [api, app] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/12.11.0/firebase-storage.js'),
    import('./firebaseApp.js'),
  ]);
  const user = app.firebaseAuth.currentUser;
  if (!user?.uid) {
    throw new Error('A signed-in Firebase user is required to upload collection settings');
  }
  return { api, storage: app.firebaseStorage, user };
}

export function buildCollectionSettingsSnapshotPath(uid) {
  const safeUid = String(uid || '').trim();
  if (!safeUid) throw new Error('uid is required');
  return `users/${safeUid}/snapshots/collection_settings/latest.json.gz`;
}

export async function uploadCollectionSettingsSnapshot({ path = null, metadata = null } = {}) {
  const { api, storage, user } = await loadFirebaseStorageApi();
  const payload = await createCompressedCollectionSettingsSnapshot();
  const objectPath = path || buildCollectionSettingsSnapshotPath(user.uid);
  const storageRef = api.ref(storage, objectPath);
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
  const result = await api.uploadBytes(storageRef, payload.gzipBlob, uploadMetadata);
  const downloadURL = await api.getDownloadURL(result.ref);
  return {
    path: objectPath,
    downloadURL,
    size: payload.gzipBlob.size,
    snapshot: payload.snapshot,
    uploadedAt: new Date().toISOString(),
  };
}
