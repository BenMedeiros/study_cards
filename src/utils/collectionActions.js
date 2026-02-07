function serializeStudyFilter({ skipLearned, focusOnly }) {
  const parts = [];
  if (skipLearned) parts.push('skipLearned');
  if (focusOnly) parts.push('focusOnly');
  return parts.join(',');
}

import { getEntryStudyKey } from './collectionManagement.js';

export function createCollectionActions(store) {
  if (!store) throw new Error('store is required');

  function _getCollectionByKey(collKey) {
    const cols = (typeof store?.collections?.getCollections === 'function') ? store.collections.getCollections() : [];
    return cols.find(c => c && c.key === collKey) || null;
  }

  function shuffleCollection(collKey) {
    const coll = _getCollectionByKey(collKey) || (typeof store?.collections?.getActiveCollection === 'function' ? store.collections.getActiveCollection() : null);
    if (!coll) return null;
    const seed = (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues)
      ? (window.crypto.getRandomValues(new Uint32Array(1))[0] >>> 0)
      : (Math.floor(Math.random() * 0x100000000) >>> 0);

    if (typeof store?.collections?.saveCollectionState === 'function') {
      store.collections.saveCollectionState(coll.key, { order_hash_int: seed, isShuffled: true, currentIndex: 0 });
    }
    return seed;
  }

  function clearCollectionShuffle(collKey) {
    const coll = _getCollectionByKey(collKey) || (typeof store?.collections?.getActiveCollection === 'function' ? store.collections.getActiveCollection() : null);
    if (!coll) return false;
    if (typeof store?.collections?.saveCollectionState === 'function') {
      store.collections.saveCollectionState(coll.key, { order_hash_int: null, isShuffled: false, currentIndex: 0 });
    }
    return true;
  }

  

  function setStudyFilter(collKey, { skipLearned = false, focusOnly = false } = {}) {
    const coll = _getCollectionByKey(collKey) || (typeof store?.collections?.getActiveCollection === 'function' ? store.collections.getActiveCollection() : null);
    if (!coll) return false;
    // Persist only the studyFilter string; other studyIndices / studyStart features removed.
    if (typeof store?.collections?.saveCollectionState === 'function') {
      store.collections.saveCollectionState(coll.key, { studyFilter: serializeStudyFilter({ skipLearned: !!skipLearned, focusOnly: !!focusOnly }), currentIndex: 0 });
    }
    return true;
  }

  function setHeldTableSearch(collKey, { hold = false, query = '' } = {}) {
    const coll = _getCollectionByKey(collKey) || (typeof store?.collections?.getActiveCollection === 'function' ? store.collections.getActiveCollection() : null);
    if (!coll) return false;
    const q = String(query || '').trim();
    const enabled = !!hold;
    if (typeof store?.collections?.saveCollectionState === 'function') {
      store.collections.saveCollectionState(coll.key, {
        holdTableSearch: enabled,
        heldTableSearch: q,
        currentIndex: 0,
      });
    }
    return true;
  }

  function setAdjectiveExpansionForms(collKey, { iForms = [], naForms = [], iForm = '', naForm = '' } = {}) {
    const coll = _getCollectionByKey(collKey) || (typeof store?.collections?.getActiveCollection === 'function' ? store.collections.getActiveCollection() : null);
    if (!coll) return false;

    const normalizeList = (v, fallbackSingle) => {
      if (Array.isArray(v)) return v.map(x => String(x || '').trim()).filter(Boolean);
      const s = String(fallbackSingle || '').trim();
      if (!s) return [];
      return s.split(/[,|\s]+/g).map(x => String(x || '').trim()).filter(Boolean);
    };

    const i = normalizeList(iForms, iForm);
    const na = normalizeList(naForms, naForm);
    if (typeof store?.collections?.saveCollectionState === 'function') {
      store.collections.saveCollectionState(coll.key, {
        expansion_i: i,
        expansion_na: na,
        currentIndex: 0,
      });
    }
    return true;
  }

  function clearLearnedForCollection(collKey) {
    const coll = _getCollectionByKey(collKey) || (typeof store?.collections?.getActiveCollection === 'function' ? store.collections.getActiveCollection() : null);
    if (!coll) return false;
    const entries = Array.isArray(coll.entries) ? coll.entries : [];
    const values = entries.map(getEntryKanjiValue).filter(Boolean);
    if (typeof store?.kanjiProgress?.clearLearnedKanjiForValues === 'function') {
      store.kanjiProgress.clearLearnedKanjiForValues(values);
      return true;
    }
    if (typeof store?.kanjiProgress?.clearLearnedKanji === 'function') {
      store.kanjiProgress.clearLearnedKanji();
      return true;
    }
    return false;
  }

  // small helper replicated from apps: get primary kanji value from entry
  function getEntryKanjiValue(entry) {
    return getEntryStudyKey(entry);
  }

  return {
    shuffleCollection,
    clearCollectionShuffle,
    setStudyFilter,
    setHeldTableSearch,
    setAdjectiveExpansionForms,
    clearLearnedForCollection,
  };
}
