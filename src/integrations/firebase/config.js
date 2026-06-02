export const FIREBASE_SYNC_ENABLED = false;

export function assertFirebaseSyncEnabled() {
  if (!FIREBASE_SYNC_ENABLED) {
    throw new Error('Firebase sync is disabled; this app is running local-only.');
  }
}
