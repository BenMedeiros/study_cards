import {
  assertFirebaseSyncEnabled,
  FIREBASE_SYNC_ENABLED,
} from './config.js';

let authReady = !FIREBASE_SYNC_ENABLED;
let currentUser = null;
const subscribers = new Set();
let firebaseAuthApi = null;
let firebaseAuth = null;

async function loadFirebaseAuth() {
  assertFirebaseSyncEnabled();
  if (firebaseAuthApi && firebaseAuth) return { api: firebaseAuthApi, auth: firebaseAuth };

  const [api, app] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js'),
    import('./firebaseApp.js'),
  ]);
  firebaseAuthApi = api;
  firebaseAuth = app.firebaseAuth;
  currentUser = firebaseAuth.currentUser || null;
  return { api, auth: firebaseAuth };
}

function buildAuthSnapshot() {
  const user = currentUser;
  return {
    isReady: authReady,
    isSignedIn: !!user?.uid,
    uid: user?.uid || null,
    displayName: user?.displayName || null,
    email: user?.email || null,
    photoURL: user?.photoURL || null,
    localOnly: !FIREBASE_SYNC_ENABLED,
  };
}

function notifySubscribers() {
  const snapshot = buildAuthSnapshot();
  for (const callback of Array.from(subscribers)) {
    try { callback(snapshot); } catch (e) {}
  }
}

function markAuthReady(user) {
  currentUser = user || null;
  authReady = true;
  notifySubscribers();
}

async function ensureFirebaseAuthStarted() {
  if (!FIREBASE_SYNC_ENABLED) return buildAuthSnapshot();
  const { api, auth } = await loadFirebaseAuth();
  api.onAuthStateChanged(auth, (user) => {
    markAuthReady(user);
  });
  void api.getRedirectResult(auth).catch((e) => {
    try { console.warn('Firebase redirect sign-in failed', e); } catch (warnError) {}
    if (!authReady) markAuthReady(auth.currentUser || null);
  });
  return buildAuthSnapshot();
}

void ensureFirebaseAuthStarted();

export function getFirebaseAuthSnapshot() {
  return buildAuthSnapshot();
}

export function subscribeFirebaseAuth(callback) {
  if (typeof callback !== 'function') return () => {};
  subscribers.add(callback);
  try { callback(buildAuthSnapshot()); } catch (e) {}
  return () => {
    subscribers.delete(callback);
  };
}

export async function signInWithGoogle() {
  const { api, auth } = await loadFirebaseAuth();
  const provider = new api.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    return await api.signInWithPopup(auth, provider);
  } catch (e) {
    const code = String(e?.code || '').trim();
    if (
      code !== 'auth/popup-blocked' &&
      code !== 'auth/operation-not-supported-in-this-environment' &&
      code !== 'auth/web-storage-unsupported'
    ) {
      throw e;
    }
    return await api.signInWithRedirect(auth, provider);
  }
}

export async function signInWithGoogleRedirect() {
  const { api, auth } = await loadFirebaseAuth();
  const provider = new api.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return await api.signInWithRedirect(auth, provider);
}

export async function waitForFirebaseAuthReady(timeoutMs = 15000) {
  if (!FIREBASE_SYNC_ENABLED || authReady) return buildAuthSnapshot();

  return await new Promise((resolve, reject) => {
    let settled = false;
    let timerId = 0;

    const unsubscribe = subscribeFirebaseAuth((snapshot) => {
      if (settled || !snapshot?.isReady) return;
      settled = true;
      try { clearTimeout(timerId); } catch (e) {}
      try { unsubscribe(); } catch (e) {}
      resolve(snapshot);
    });

    timerId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      try { unsubscribe(); } catch (e) {}
      reject(new Error('Timed out waiting for Firebase auth to initialize'));
    }, Math.max(1000, Number(timeoutMs) || 15000));
  });
}

export async function getFirebaseIdToken(forceRefresh = false) {
  assertFirebaseSyncEnabled();
  const user = currentUser || firebaseAuth?.currentUser || null;
  if (!user || typeof user.getIdToken !== 'function') {
    throw new Error('No Firebase user is signed in');
  }
  return await user.getIdToken(!!forceRefresh);
}

export async function signOutFirebaseUser() {
  const { api, auth } = await loadFirebaseAuth();
  return await api.signOut(auth);
}
