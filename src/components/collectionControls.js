// Helper to add shuffle/clear-shuffle/clear-learned controls to a headerTools instance.
// Usage: addShuffleControls(headerTools, { store, onShuffle, onClearShuffle, onClearLearned, includeClearShuffle=true, includeClearLearned=true })
export function addShuffleControls(headerTools, { store, onShuffle, onClearShuffle, onClearLearned, includeClearShuffle = true, includeClearLearned = true } = {}) {
  if (!headerTools || typeof headerTools.addElement !== 'function') return null;

  const makeShuffle = () => ({
    type: 'button', key: 'shuffle', label: 'Shuffle', caption: 'col.shuffle',
    onClick: () => {
      try {
        if (typeof onShuffle === 'function') {
          onShuffle();
          return;
        }
        const coll = store?.collections?.getActiveCollection?.();
        if (!coll) return;
        if (store?.collections && typeof store.collections.shuffleCollection === 'function') store.collections.shuffleCollection(coll.key);
      } catch (e) {}
    }
  });

  const makeClearShuffle = () => ({
    type: 'button', key: 'clearShuffle', label: 'Clear Shuffle', caption: 'col.clear-shuffle',
    onClick: () => {
      try {
        if (typeof onClearShuffle === 'function') { onClearShuffle(); return; }
        const coll = store?.collections?.getActiveCollection?.();
        if (!coll) return;
        if (store?.collections && typeof store.collections.clearCollectionShuffle === 'function') store.collections.clearCollectionShuffle(coll.key);
      } catch (e) {}
    }
  });

  const makeClearLearned = () => ({
    type: 'button', key: 'clearLearned', label: 'Clear Learned', caption: 'col.clear-learned', title: 'Remove Learned flags',
    onClick: async () => {
      try {
        if (typeof onClearLearned === 'function') { await onClearLearned(); return; }
        // default: call collections manager helper to clear learned for collection
        const coll = store?.collections?.getActiveCollection?.();
        if (!coll) return;
        if (store?.collections && typeof store.collections.clearLearnedForCollection === 'function') {
          store.collections.clearLearnedForCollection(coll.key);
        }
      } catch (e) {}
    }
  });

  const elems = [];
  elems.push(makeShuffle());
  if (includeClearShuffle) elems.push(makeClearShuffle());
  if (includeClearLearned) elems.push(makeClearLearned());

  // Add them in order to headerTools
  for (const e of elems) {
    try { headerTools.addElement(e); } catch (ex) {}
  }

  return elems.map(it => it.key);
}
