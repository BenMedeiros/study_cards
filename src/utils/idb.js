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

export function openStudyDb({ dbName = 'study_cards', version = 4 } = {}) {
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

      // Remove legacy 'kv' store if present (we no longer use a generic kv store)
      if (db.objectStoreNames.contains('kv')) {
        try { db.deleteObjectStore('kv'); } catch (e) { /* ignore */ }
      }

      if (!db.objectStoreNames.contains('collection_settings')) {
        db.createObjectStore('collection_settings', { keyPath: 'id' });
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

      if (!db.objectStoreNames.contains('kanji_progress')) {
        db.createObjectStore('kanji_progress', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('grammar_progress')) {
        db.createObjectStore('grammar_progress', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('study_time_sessions')) {
        // keyPath startIso asserted unique by app
        db.createObjectStore('study_time_sessions', { keyPath: 'startIso' });
      }

      // Migrate legacy per-store progress into study_progress if present. Use the
      // upgrade transaction's stores for atomic migration when possible.
      try {
        const hasOldKanji = db.objectStoreNames.contains('kanji_progress');
        const hasOldGrammar = db.objectStoreNames.contains('grammar_progress');
        if ((hasOldKanji || hasOldGrammar) && tx) {
          const newStore = tx.objectStore('study_progress');

          if (hasOldKanji) {
            const old = tx.objectStore('kanji_progress');
            const cursorReq = old.openCursor();
            cursorReq.onsuccess = (e) => {
              const cur = e.target.result;
              if (!cur) return;
              const row = cur.value || {};
              const entryId = String(row.id || '');
              if (entryId) {
                const rec = { id: `japanese.words|${entryId}`, collection: 'japanese.words', entryKey: entryId, value: row.value ?? row };
                newStore.put(rec);
              }
              cur.continue();
            };
          }

          if (hasOldGrammar) {
            const oldG = tx.objectStore('grammar_progress');
            const cursorReqG = oldG.openCursor();
            cursorReqG.onsuccess = (e) => {
              const cur = e.target.result;
              if (!cur) return;
              const row = cur.value || {};
              const entryId = String(row.id || '');
              if (entryId) {
                const rec = { id: `grammar|${entryId}`, collection: 'grammar', entryKey: entryId, value: row.value ?? row };
                newStore.put(rec);
              }
              cur.continue();
            };
          }
        }
      } catch (e) {
        // ignore migration errors here; app will handle reading legacy stores if needed
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
  const kv = await idbGetAll('kv').catch(() => null);
  const collections = await idbGetAll('collection_settings').catch(() => null);
  const study = await idbGetAll('study_progress').catch(() => null);
  const kanji = await idbGetAll('kanji_progress').catch(() => null);
  const grammar = await idbGetAll('grammar_progress').catch(() => null);
  const sessions = await idbGetAll('study_time_sessions').catch(() => null);
  return { kv, collections, study_progress: study, kanji_progress: kanji, grammar_progress: grammar, study_time_sessions: sessions };
}
