import controllerFactory from './controller.js';
import { CARD_REGISTRY } from '../cards/index.js';

const VIEW = 'kanjiStudyCardView';
const AVAILABLE_CARD_KEYS = new Set((CARD_REGISTRY || []).map(c => c.key));

const DEFAULT_VIEW = {
  currentIndex: 0,
  entryFields: ['kanji', 'reading', 'type', 'lexicalClass', 'orthography', 'tags'],
  relatedFields: { sentences: ['english', 'notes'] },
  displayCards: ['main', 'related', 'full', 'generic', 'json'],
};

function _validateDisplayCards(cards) {
  // Allow the compact 'all' marker (string) used by the UI dropdowns.
  if (typeof cards === 'string') {
    if (cards === 'all') return;
    throw new Error('displayCards must be an array or "all"');
  }
  if (!Array.isArray(cards)) throw new Error('displayCards must be an array');
  for (const c of cards) {
    if (typeof c !== 'string') throw new Error('displayCards entries must be strings');
    if (c === '__toggle__') continue;
    if (!AVAILABLE_CARD_KEYS.has(c)) throw new Error(`unknown display card type: ${c}`);
  }
}

function _validateEntryFields(fields, collection) {
  // Allow the compact 'all' marker (string) used by the UI dropdowns.
  if (typeof fields === 'string') {
    if (fields === 'all') return;
    throw new Error('entryFields must be an array or "all"');
  }
  if (!Array.isArray(fields)) throw new Error('entryFields must be an array');
  const fieldKeys = new Set((Array.isArray(collection?.metadata?.fields) ? collection.metadata.fields : []).map(f => f.key));
  for (const f of fields) {
    if (typeof f !== 'string') throw new Error('entryFields must contain strings');
    if (f === '__toggle__') continue;
    if (!fieldKeys.has(f)) throw new Error(`entry field not in collection schema: ${f}`);
  }
}

function create(collKey) {
  const validators = {
    displayCards: (v) => _validateDisplayCards(v),
    entryFields: (v, collection) => _validateEntryFields(v, collection),
    currentIndex: (v) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) throw new Error('currentIndex must be an integer >= 0');
    },
  };

  const base = controllerFactory.createViewController(collKey, VIEW, DEFAULT_VIEW, validators);

  // convenience wrappers (same API as before)
  return {
    collKey: base.collKey,
    ready: base.ready,
    get: base.get,
    set: base.set,
    reset: base.reset,
    setEntryFields: (fields) => base.set({ entryFields: fields }),
    setDisplayCards: (cards) => base.set({ displayCards: cards }),
    setCurrentIndex: (i) => base.set({ currentIndex: i }),
    subscribe: base.subscribe,
    dispose: base.dispose,
  };
}

async function forCollection(collKey) { const c = create(collKey); await c.ready; return c; }

export default { create, forCollection };
