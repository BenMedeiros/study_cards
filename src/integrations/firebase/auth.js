import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js';

import { firebaseAuth } from './firebaseApp.js';

let authReady = false;
let currentUser = firebaseAuth.currentUser || null;
const subscribers = new Set();

function buildAuthSnapshot() {
  const user = currentUser;
  return {
    isReady: authReady,
    isSignedIn: !!user?.uid,
    uid: user?.uid || null,
    displayName: user?.displayName || null,
    email: user?.email || null,
    photoURL: user?.photoURL || null,
  };
}

function notifySubscribers() {
  const snapshot = buildAuthSnapshot();
  for (const callback of Array.from(subscribers)) {
    try { callback(snapshot); } catch (e) {}
  }
}

onAuthStateChanged(firebaseAuth, (user) => {
  currentUser = user || null;
  authReady = true;
  notifySubscribers();
});

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
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return await signInWithPopup(firebaseAuth, provider);
}

export async function waitForFirebaseAuthReady(timeoutMs = 15000) {
  if (authReady) return buildAuthSnapshot();

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
  const user = currentUser || firebaseAuth.currentUser || null;
  if (!user || typeof user.getIdToken !== 'function') {
    throw new Error('No Firebase user is signed in');
  }
  return await user.getIdToken(!!forceRefresh);
}

export async function signOutFirebaseUser() {
  return await signOut(firebaseAuth);
}
