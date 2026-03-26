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

export async function signOutFirebaseUser() {
  return await signOut(firebaseAuth);
}