import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-storage.js';

const publicApiKey = 'AIzaSyAC7UKSO_VQQWDC6kzKFnFzVxH7EQ8gHt8';

export const firebaseConfig = {
  apiKey: publicApiKey,
  authDomain: 'study-cards-sync.firebaseapp.com',
  projectId: 'study-cards-sync',
  storageBucket: 'study-cards-sync.firebasestorage.app',
  messagingSenderId: '146383394381',
  appId: '1:146383394381:web:faa3a0273e4d3bbc1fae04',
};

export const firebaseApp = initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(firebaseApp);
export const firebaseDb = getFirestore(firebaseApp);
export const firebaseStorage = getStorage(firebaseApp);

export default firebaseApp;
