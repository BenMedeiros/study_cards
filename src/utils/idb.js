let dbPromise = null;

function promisifyRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function waitForTransaction(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    tx.onerror = () => reject(tx.error);
  });
}

export function isIndexedDBAvailable() {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

export function openStudyDb({ dbName = 'study_cards', version = 2 } = {}) {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (!isIndexedDBAvailable()) {
      reject(new Error('IndexedDB not available'));
      return;
    }

    const req = indexedDB.open(dbName, version);

    req.onupgradeneeded = () => {
      const db = req.result;

      // Remove legacy 'kv' store if present (we no longer use a generic kv store)
      if (db.objectStoreNames.contains('kv')) {
        try { db.deleteObjectStore('kv'); } catch (e) { /* ignore */ }
      }

      if (!db.objectStoreNames.contains('collection_settings')) {
        db.createObjectStore('collection_settings', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('kanji_progress')) {
        db.createObjectStore('kanji_progress', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('study_time_sessions')) {
        // keyPath startIso asserted unique by app
        db.createObjectStore('study_time_sessions', { keyPath: 'startIso' });
      }
      
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return dbPromise;
}

export async function idbGet(storeName, key) {
  const db = await openStudyDb();
  const tx = db.transaction(storeName, 'readonly');
  const store = tx.objectStore(storeName);
  const req = store.get(key);
  const result = await promisifyRequest(req);
  await waitForTransaction(tx);
  return result ?? null;
}

export async function idbPut(storeName, record) {
  const db = await openStudyDb();
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);

  // Make a shallow copy so we don't mutate caller objects.
  const toPut = { ...record };
  if (toPut && typeof toPut === 'object' && toPut.value && typeof toPut.value === 'object') {
    toPut.value = { ...toPut.value };
  }

  // No special-case compression of study_time here; study_time sessions
  // will be stored in `study_time_sessions` object store.

  // Ensure every stored kv value has a schema_version (default 1)
  try {
    if (String(storeName) === 'kv') {
      if (toPut && typeof toPut === 'object' && toPut.value && typeof toPut.value === 'object') {
        if (typeof toPut.value.schema_version !== 'number') toPut.value.schema_version = 1;
      }
    }
  } catch (e) {}

  store.put(toPut);
  await waitForTransaction(tx);
}

export async function idbDelete(storeName, key) {
  const db = await openStudyDb();
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  store.delete(key);
  await waitForTransaction(tx);
}

export async function idbGetAll(storeName) {
  const db = await openStudyDb();
  const tx = db.transaction(storeName, 'readonly');
  const store = tx.objectStore(storeName);

  // Prefer getAll when available.
  if (typeof store.getAll === 'function') {
    const req = store.getAll();
    const result = await promisifyRequest(req);
    await waitForTransaction(tx);
    return Array.isArray(result) ? result : [];
  }

  // Cursor fallback.
  const out = [];
  await new Promise((resolve, reject) => {
    const cursorReq = store.openCursor();
    cursorReq.onerror = () => reject(cursorReq.error);
    cursorReq.onsuccess = (ev) => {
      const cursor = ev.target.result;
      if (!cursor) {
        resolve();
        return;
      }
      out.push(cursor.value);
      cursor.continue();
    };
  });

  await waitForTransaction(tx);
  return out;
}

export async function idbDumpAll() {
  const kv = await idbGetAll('kv').catch(() => null);
  const collections = await idbGetAll('collection_settings').catch(() => null);
  const kanji = await idbGetAll('kanji_progress').catch(() => null);
  const sessions = await idbGetAll('study_time_sessions').catch(() => null);
  return { kv, collections, kanji_progress: kanji, study_time_sessions: sessions };
}
