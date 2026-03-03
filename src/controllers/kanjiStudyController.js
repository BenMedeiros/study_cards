import controllerFactory from './controller.js';
import { CARD_REGISTRY } from '../cards/index.js';

const VIEW = 'kanjiStudyCardView';
const AVAILABLE_CARD_KEYS = new Set((CARD_REGISTRY || []).map(c => c.key));

const DEFAULT_VIEW = {
  currentIndex: 0,
  entryFields: ['kanji', 'reading', 'meaning', 'type', 'lexicalClass', 'orthography', 'tags'],
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

  // keep a local collection reference once ready so we can resolve metadata-driven maps
  let _collectionRef = null;
  base.ready.then((c) => { _collectionRef = c; }).catch(() => {});

  function _computeResolved(viewState) {
    const collection = _collectionRef || {};
    const md = collection.metadata || {};
    const fields = Array.isArray(md.fields) ? md.fields.map(f => String(f.key || f)) : [];
    const relatedDefs = Array.isArray(md.relatedCollections) ? md.relatedCollections.slice() : [];

    const effective = { ...DEFAULT_VIEW, ...(viewState || {}) };

    // entry field map
    const entryFieldMap = {};
    if (effective.entryFields === 'all') {
      for (const k of fields) entryFieldMap[String(k)] = true;
    } else if (Array.isArray(effective.entryFields)) {
      const s = new Set(effective.entryFields.map(String));
      for (const k of fields) entryFieldMap[String(k)] = !!s.has(String(k));
    } else {
      for (const k of fields) entryFieldMap[String(k)] = false;
    }

    // related field maps
    const relatedFieldMaps = {};
    for (const rd of relatedDefs) {
      const name = String(rd?.name || '').trim();
      if (!name) continue;
      const relFields = Array.isArray(rd.fields) ? rd.fields.map(f => String(f.key || f)) : [];
      relatedFieldMaps[name] = {};
      const sel = effective.relatedFields && Object.prototype.hasOwnProperty.call(effective.relatedFields, name) ? effective.relatedFields[name] : 'all';
      if (sel === 'all') {
        for (const k of relFields) relatedFieldMaps[name][String(k)] = true;
      } else if (Array.isArray(sel)) {
        const s = new Set(sel.map(String));
        for (const k of relFields) relatedFieldMaps[name][String(k)] = !!s.has(String(k));
      } else {
        for (const k of relFields) relatedFieldMaps[name][String(k)] = false;
      }
    }

    // display cards resolved list (expand 'all')
    let displayCardsResolved = [];
    if (effective.displayCards === 'all') displayCardsResolved = Array.from(AVAILABLE_CARD_KEYS);
    else if (Array.isArray(effective.displayCards)) displayCardsResolved = effective.displayCards.filter(c => AVAILABLE_CARD_KEYS.has(c));
    else displayCardsResolved = Array.from(DEFAULT_VIEW.displayCards || []);

    return { entryFieldMap, relatedFieldMaps, displayCards: displayCardsResolved };
  }

  // convenience wrappers (same API as before) with augmented get/subscribe
  return {
    collKey: base.collKey,
    ready: base.ready,
    get: () => {
      const s = base.get();
      try { return { ...s, resolved: _computeResolved(s) }; } catch (e) { return s; }
    },
    set: base.set,
    reset: base.reset,
    setEntryFields: (fields) => base.set({ entryFields: fields }),
    setDisplayCards: (cards) => base.set({ displayCards: cards }),
    goToIndex: async (newIndex) => {
      const coll = await base.ready;
      const n = Array.isArray(coll?.entries) ? coll.entries.length : 0;
      if (!n) return;
      const ni = Math.min(Math.max(0, Number.isFinite(Number(newIndex)) ? Number(newIndex) : 0), n - 1);
      return base.set({ currentIndex: ni });
    },
    setCurrentIndex: (i) => base.set({ currentIndex: i }),
    nextIndex: async () => {
      const coll = await base.ready;
      const n = Array.isArray(coll?.entries) ? coll.entries.length : 0;
      if (!n) return;
      const st = base.get() || {};
      const cur = Number.isFinite(Number(st.currentIndex)) ? Number(st.currentIndex) : 0;
      const next = ((cur + 1) % n + n) % n;
      return base.set({ currentIndex: next });
    },
    prevIndex: async () => {
      const coll = await base.ready;
      const n = Array.isArray(coll?.entries) ? coll.entries.length : 0;
      if (!n) return;
      const st = base.get() || {};
      const cur = Number.isFinite(Number(st.currentIndex)) ? Number(st.currentIndex) : 0;
      const next = ((cur - 1) % n + n) % n;
      return base.set({ currentIndex: next });
    },
    subscribe: (cb) => {
      return base.subscribe((viewState, viewPatch, newState, patch) => {
        try {
          const resolved = _computeResolved(viewState || {});
          const vs = { ...viewState, resolved };
          const vp = { ...viewPatch, resolved };
          cb(vs, vp, newState, patch);
        } catch (e) {
          try { cb(viewState, viewPatch, newState, patch); } catch (e2) {}
        }
      });
    },
    dispose: base.dispose,
  };
}

async function forCollection(collKey) { const c = create(collKey); await c.ready; return c; }

export default { create, forCollection };
