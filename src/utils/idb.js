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

  // Make a shallow copy so we don't mutate caller objects.
  const toPut = { ...record };
  if (toPut && typeof toPut === 'object' && toPut.value && typeof toPut.value === 'object') {
    toPut.value = { ...toPut.value };
  }

  // If persisting study_time, add normalized arrays for app and collection ids
  // to make persisted shape easier to query without loading large sessions arrays.
  try {
    if (String(storeName) === 'kv' && toPut?.key === 'study_time' && Array.isArray(toPut.value?.sessions)) {
      const sessions = toPut.value.sessions || [];
      const appIds = [];
      const colIds = [];
      const appIndex = new Map();
      const colIndex = new Map();
      const compressed = [];

      for (const s of sessions) {
        if (!s) continue;
        // If already compressed (array with numeric idxes), keep as-is
        if (Array.isArray(s) && s.length >= 5 && typeof s[0] === 'number') {
          compressed.push(s);
          continue;
        }

        // Expect object shape { appId, collectionId, startIso, endIso, durationMs }
        const aiRaw = (s && typeof s === 'object') ? String(s.appId || '').trim() : '';
        const ciRaw = (s && typeof s === 'object') ? String(s.collectionId || '').trim() : '';

        let ai = -1;
        if (aiRaw) {
          if (appIndex.has(aiRaw)) ai = appIndex.get(aiRaw);
          else { ai = appIds.length; appIndex.set(aiRaw, ai); appIds.push(aiRaw); }
        }

        let ci = -1;
        if (ciRaw) {
          if (colIndex.has(ciRaw)) ci = colIndex.get(ciRaw);
          else { ci = colIds.length; colIndex.set(ciRaw, ci); colIds.push(ciRaw); }
        }

        const startIso = (s && typeof s === 'object') ? String(s.startIso || '') : '';
        const endIso = (s && typeof s === 'object') ? String(s.endIso || '') : '';
        const durationMs = (s && typeof s === 'object') ? Math.round(Number(s.durationMs) || 0) : 0;

        compressed.push([ai, ci, startIso, endIso, durationMs]);
      }

      toPut.value.sessions = compressed;
      toPut.value.normalization_appIds = appIds;
      toPut.value.normalization_collectionIds = colIds;
      // Mark compressed schema version
      toPut.value.schema_version = 2;
      toPut.value.__schema = { sessionShape: ['appIndex', 'collectionIndex', 'startIso', 'endIso', 'durationMs'], schema_version: 2 };
    }
  } catch (e) {
    // ignore normalization failures
  }

  // Ensure every stored kv value has a schema_version (default 1)
  try {
    if (toPut && typeof toPut === 'object' && toPut.value && typeof toPut.value === 'object') {
      if (typeof toPut.value.schema_version !== 'number') toPut.value.schema_version = 1;
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
  const collections = await idbGetAll('collections').catch(() => null);
  return { kv, collections };
}
