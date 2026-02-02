import { getCollectionView } from './collectionManagement.js';

function serializeStudyFilter({ skipLearned, focusOnly }) {
  const parts = [];
  if (skipLearned) parts.push('skipLearned');
  if (focusOnly) parts.push('focusOnly');
  return parts.join(',');
}

export function createCollectionActions(store) {
  if (!store) throw new Error('store is required');

  function _getCollectionByKey(collKey) {
    const cols = (typeof store.getCollections === 'function') ? store.getCollections() : [];
    return cols.find(c => c && c.key === collKey) || null;
  }

  function shuffleCollection(collKey) {
    const coll = _getCollectionByKey(collKey) || (typeof store.getActiveCollection === 'function' ? store.getActiveCollection() : null);
    if (!coll) return null;
    const seed = (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues)
      ? (window.crypto.getRandomValues(new Uint32Array(1))[0] >>> 0)
      : (Math.floor(Math.random() * 0x100000000) >>> 0);

    if (typeof store.saveCollectionState === 'function') {
      store.saveCollectionState(coll.key, { order_hash_int: seed, isShuffled: true, currentIndex: 0 });
    } else if (typeof store.saveKanjiUIState === 'function') {
      // fallback for older API
      try { store.saveKanjiUIState({ order_hash_int: seed, isShuffled: true, currentIndex: 0 }); } catch (e) { /* ignore */ }
    }
    return seed;
  }

  function clearCollectionShuffle(collKey) {
    const coll = _getCollectionByKey(collKey) || (typeof store.getActiveCollection === 'function' ? store.getActiveCollection() : null);
    if (!coll) return false;
    if (typeof store.saveCollectionState === 'function') {
      store.saveCollectionState(coll.key, { order_hash_int: null, isShuffled: false, currentIndex: 0 });
    } else if (typeof store.saveKanjiUIState === 'function') {
      try { store.saveKanjiUIState({ order_hash_int: null, isShuffled: false, currentIndex: 0 }); } catch (e) { /* ignore */ }
    }
    return true;
  }

  function pickStudyWindow(collKey, opts = { windowSize: 10, skipLearned: false, focusOnly: false }) {
    const coll = _getCollectionByKey(collKey) || (typeof store.getActiveCollection === 'function' ? store.getActiveCollection() : null);
    if (!coll) return null;
    const entries = Array.isArray(coll.entries) ? coll.entries : [];
    const n = entries.length;
    if (n === 0) return null;

    const saved = (typeof store.loadCollectionState === 'function') ? (store.loadCollectionState(coll.key) || {}) : {};
    const cursor = (saved && typeof saved.studyStart === 'number') ? saved.studyStart : 0;

    const picked = [];
    let lastIdx = null;
    for (let i = 0; i < n; i++) {
      const idx = (cursor + i) % n;
      const entry = entries[idx];
      if (opts.skipLearned && typeof store.isKanjiLearned === 'function' && store.isKanjiLearned(getEntryKanjiValue(entry))) continue;
      if (opts.focusOnly && typeof store.isKanjiFocus === 'function' && !store.isKanjiFocus(getEntryKanjiValue(entry))) continue;
      picked.push(idx);
      lastIdx = idx;
      if (picked.length >= opts.windowSize) break;
    }

    const nextCursor = (lastIdx === null) ? cursor : ((lastIdx + 1) % n);
    if (typeof store.saveCollectionState === 'function') {
      store.saveCollectionState(coll.key, {
        studyIndices: picked,
        studyStart: nextCursor,
        studyFilter: serializeStudyFilter({ skipLearned: !!opts.skipLearned, focusOnly: !!opts.focusOnly }),
        currentIndex: 0,
      });
    } else if (typeof store.saveKanjiUIState === 'function') {
      try {
        store.saveKanjiUIState({ studyIndices: picked, studyStart: nextCursor, studyFilter: serializeStudyFilter({ skipLearned: !!opts.skipLearned, focusOnly: !!opts.focusOnly }), currentIndex: 0 });
      } catch (e) { /* ignore */ }
    }

    return { studyIndices: picked, studyStart: nextCursor };
  }

  function setStudyAll(collKey, { skipLearned = false, focusOnly = false } = {}) {
    const coll = _getCollectionByKey(collKey) || (typeof store.getActiveCollection === 'function' ? store.getActiveCollection() : null);
    if (!coll) return false;
    if (typeof store.saveCollectionState === 'function') {
      store.saveCollectionState(coll.key, { studyStart: null, studyIndices: null, studyFilter: serializeStudyFilter({ skipLearned: !!skipLearned, focusOnly: !!focusOnly }), currentIndex: 0 });
    } else if (typeof store.saveKanjiUIState === 'function') {
      try { store.saveKanjiUIState({ studyStart: null, studyIndices: null, studyFilter: serializeStudyFilter({ skipLearned: !!skipLearned, focusOnly: !!focusOnly }), currentIndex: 0 }); } catch (e) { /* ignore */ }
    }
    return true;
  }

  function setStudyFilter(collKey, { skipLearned = false, focusOnly = false } = {}) {
    const coll = _getCollectionByKey(collKey) || (typeof store.getActiveCollection === 'function' ? store.getActiveCollection() : null);
    if (!coll) return false;
    if (typeof store.saveCollectionState === 'function') {
      store.saveCollectionState(coll.key, { studyFilter: serializeStudyFilter({ skipLearned: !!skipLearned, focusOnly: !!focusOnly }), skipLearned: null, focusOnly: null, currentIndex: 0 });
    } else if (typeof store.saveKanjiUIState === 'function') {
      try { store.saveKanjiUIState({ studyFilter: serializeStudyFilter({ skipLearned: !!skipLearned, focusOnly: !!focusOnly }), currentIndex: 0 }); } catch (e) { /* ignore */ }
    }
    return true;
  }

  function pruneStudyIndicesToFilters(collKey) {
    try {
      const coll = _getCollectionByKey(collKey) || (typeof store.getActiveCollection === 'function' ? store.getActiveCollection() : null);
      if (!coll) return false;
      const entries = Array.isArray(coll.entries) ? coll.entries : [];
      const saved = (typeof store.loadCollectionState === 'function') ? (store.loadCollectionState(coll.key) || {}) : {};
      if (!Array.isArray(saved.studyIndices)) return false;

      const next = saved.studyIndices
        .map(i => Number(i))
        .filter(Number.isFinite)
        .filter(i => i >= 0 && i < entries.length)
        .filter(i => {
          const entry = entries[i];
          const v = getEntryKanjiValue(entry);
          if (!v) return true;
          if (saved?.studyFilter) {
            // parse studyFilter string
            const parts = String(saved.studyFilter || '').split(/[,|\s]+/g).map(s => s.trim()).filter(Boolean);
            const set = new Set(parts);
            const skipLearned = set.has('skipLearned') || set.has('skip_learned') || set.has('skip-learned');
            const focusOnly = set.has('focusOnly') || set.has('focus_only') || set.has('focus') || set.has('morePractice') || set.has('more_practice');
            if (skipLearned && typeof store.isKanjiLearned === 'function' && store.isKanjiLearned(v)) return false;
            if (focusOnly && typeof store.isKanjiFocus === 'function' && !store.isKanjiFocus(v)) return false;
          }
          return true;
        });

      if (next.length !== saved.studyIndices.length) {
        if (typeof store.saveCollectionState === 'function') {
          store.saveCollectionState(coll.key, { studyIndices: next, currentIndex: 0 });
        } else if (typeof store.saveKanjiUIState === 'function') {
          try { store.saveKanjiUIState({ studyIndices: next, currentIndex: 0 }); } catch (e) { /* ignore */ }
        }
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function clearLearnedForCollection(collKey) {
    const coll = _getCollectionByKey(collKey) || (typeof store.getActiveCollection === 'function' ? store.getActiveCollection() : null);
    if (!coll) return false;
    const entries = Array.isArray(coll.entries) ? coll.entries : [];
    const values = entries.map(getEntryKanjiValue).filter(Boolean);
    if (typeof store.clearLearnedKanjiForValues === 'function') {
      store.clearLearnedKanjiForValues(values);
      return true;
    }
    if (typeof store.clearLearnedKanji === 'function') {
      store.clearLearnedKanji();
      return true;
    }
    return false;
  }

  // small helper replicated from apps: get primary kanji value from entry
  function getEntryKanjiValue(entry) {
    if (!entry || typeof entry !== 'object') return '';
    for (const k of ['kanji', 'character', 'text', 'word', 'reading', 'kana']) {
      const v = entry[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  }

  return {
    shuffleCollection,
    clearCollectionShuffle,
    pickStudyWindow,
    setStudyAll,
    setStudyFilter,
    pruneStudyIndicesToFilters,
    clearLearnedForCollection,
  };
}
