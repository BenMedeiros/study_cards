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

export function openStudyDb({ dbName = 'study_cards', version = 1 } = {}) {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (!isIndexedDBAvailable()) {
      reject(new Error('IndexedDB not available'));
      return;
    }

    const req = indexedDB.open(dbName, version);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains('kv')) {
        db.createObjectStore('kv', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('collections')) {
        db.createObjectStore('collections', { keyPath: 'id' });
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
  store.put(record);
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
