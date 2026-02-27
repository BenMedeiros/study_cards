// Helper to add shuffle/clear-shuffle/clear-learned controls to a headerTools instance.
// Usage: addShuffleControls(headerTools, { store, onShuffle, onClearShuffle, onClearLearned, includeClearShuffle=true, includeClearLearned=true })
import collectionSettingsController from '../controllers/collectionSettingsController.js';

export function addShuffleControls(headerTools, { store, onShuffle, onClearShuffle, onClearLearned, includeClearShuffle = true, includeClearLearned = true } = {}) {
  if (!headerTools || typeof headerTools.addElement !== 'function') return null;

  const makeShuffle = () => ({
    type: 'button', key: 'shuffle', label: 'Shuffle', caption: 'col.shuffle',
    onClick: () => {
      if (typeof onShuffle === 'function') {
        onShuffle();
        return;
      }
      const coll = store.collections.getActiveCollection();
      if (!coll) return;
      // set persisted shuffle state (controller will persist)
      const seed = (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues)
        ? (window.crypto.getRandomValues(new Uint32Array(1))[0] >>> 0)
        : (Math.floor(Math.random() * 0x100000000) >>> 0);
      collectionSettingsController.set(coll.key, { order_hash_int: seed, isShuffled: true });
    }
  });

  const makeClearShuffle = () => ({
    type: 'button', key: 'clearShuffle', label: 'Clear Shuffle', caption: 'col.clear-shuffle',
    onClick: () => {
      // Always clear persisted shuffle state first so views don't immediately reapply it.
      const coll = store.collections.getActiveCollection();
      if (!coll) return;
      collectionSettingsController.set(coll.key, { order_hash_int: null, isShuffled: false });
      if (typeof onClearShuffle === 'function') { onClearShuffle(); return; }
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
