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

export function openStudyDb({ dbName = 'study_cards', version = 5 } = {}) {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (!isIndexedDBAvailable()) {
      reject(new Error('IndexedDB not available'));
      return;
    }
    const req = indexedDB.open(dbName, version);

    req.onupgradeneeded = (ev) => {
      const db = ev.target.result;
      const tx = ev.target.transaction;

      if (!db.objectStoreNames.contains('collection_settings')) {
        db.createObjectStore('collection_settings', { keyPath: 'id' });
      }

      // Stores for collectionDatabaseManager
      if (!db.objectStoreNames.contains('system_collections')) {
        db.createObjectStore('system_collections', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('system_collections_index')) {
        db.createObjectStore('system_collections_index', { keyPath: 'key' });
      }

      // Ensure study_progress store exists and has indexes for efficient queries
      if (!db.objectStoreNames.contains('study_progress')) {
        const s = db.createObjectStore('study_progress', { keyPath: 'id' });
        s.createIndex('by_collection', 'collection', { unique: false });
        s.createIndex('by_collection_entry', ['collection', 'entryKey'], { unique: true });
      } else {
        // existing store: ensure indexes exist (use upgrade transaction access)
        try {
          const s = tx.objectStore('study_progress');
          if (!s.indexNames.contains('by_collection')) s.createIndex('by_collection', 'collection', { unique: false });
          if (!s.indexNames.contains('by_collection_entry')) s.createIndex('by_collection_entry', ['collection', 'entryKey'], { unique: true });
        } catch (e) {
          // ignore
        }
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

export async function idbGetAllByIndex(storeName, indexName, key) {
  const db = await openStudyDb();
  const tx = db.transaction(storeName, 'readonly');
  const store = tx.objectStore(storeName);
  let idx;
  try {
    idx = store.index(indexName);
  } catch (e) {
    await waitForTransaction(tx);
    return [];
  }

  if (typeof idx.getAll === 'function') {
    const req = idx.getAll(key);
    const result = await promisifyRequest(req);
    await waitForTransaction(tx);
    return Array.isArray(result) ? result : [];
  }

  const out = [];
  await new Promise((resolve, reject) => {
    const cursorReq = idx.openCursor(key);
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

export async function idbGetByIndex(storeName, indexName, key) {
  const db = await openStudyDb();
  const tx = db.transaction(storeName, 'readonly');
  const store = tx.objectStore(storeName);
  let idx;
  try {
    idx = store.index(indexName);
  } catch (e) {
    await waitForTransaction(tx);
    return null;
  }
  const req = idx.get(key);
  const result = await promisifyRequest(req);
  await waitForTransaction(tx);
  return result ?? null;
}

export async function idbDumpAll() {
  const collections = await idbGetAll('collection_settings').catch(() => null);
  const study = await idbGetAll('study_progress').catch(() => null);
  const sessions = await idbGetAll('study_time_sessions').catch(() => null);
  return { collections, study_progress: study, study_time_sessions: sessions };
}
