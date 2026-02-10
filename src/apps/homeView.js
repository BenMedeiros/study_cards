import { card, el } from '../components/ui.js';
import { formatDurationMs, formatIsoShort, formatRelativeFromIso } from '../utils/helpers.js';

const APP_META = {
  home: { label: 'Home', path: '/' },
  flashcards: { label: 'Flashcards', path: '/flashcards' },
  'qa-cards': { label: 'QA Cards', path: '/qa-cards' },
  kanji: { label: 'Kanji Study', path: '/kanji' },
  grammar: { label: 'Grammar Study', path: '/grammar' },
  explorer: { label: 'Explorer', path: '/explorer' },
  data: { label: 'Data', path: '/data' },
  collections: { label: 'Collections', path: '/collections' },
};

function appLabel(appId) {
  return APP_META[appId]?.label || String(appId || '').trim() || 'Unknown';
}

function appPath(appId) {
  return APP_META[appId]?.path || '/';
}

function linkToAppAndCollection(appId, collectionId) {
  const p = appPath(appId);
  if (!collectionId) return p;
  const enc = encodeURIComponent(String(collectionId));
  return `${p}?collection=${enc}`;
}

function makeLink({ label, goTo, sublabel, meta }) {
  const a = el('a', {
    className: 'home-link',
    children: [
      el('span', { className: 'home-link-label', text: label }),
      meta ? el('span', { className: 'home-link-meta', text: meta }) : null,
    ].filter(Boolean),
    attrs: { href: `#${goTo}`, 'data-go': goTo },
  });
  if (!sublabel) return a;
  return el('div', {
    className: 'home-link-row',
    children: [a, el('div', { className: 'hint', text: sublabel })],
  });
}

export function renderHome({ store, onNavigate }) {
  const root = document.createElement('div');
  root.id = 'home-root';

  const active = store.collections.getActiveCollection();
  const activeId = store.collections.getActiveCollectionId?.() || null;
  const activeName = active?.metadata?.name || 'None';
  const activeCategory = String(active?.metadata?.category || '').toLowerCase();

  const now = Date.now();
  const total24h = store.studyTime.sumSessionDurations?.({ windowMs: 24 * 60 * 60 * 1000 }) || 0;
  const total48h = store.studyTime.sumSessionDurations?.({ windowMs: 48 * 60 * 60 * 1000 }) || 0;
  const total72h = store.studyTime.sumSessionDurations?.({ windowMs: 72 * 60 * 60 * 1000 }) || 0;
  const total7d = store.studyTime.sumSessionDurations?.({ windowMs: 7 * 24 * 60 * 60 * 1000 }) || 0;

  const sessions = store.studyTime.getRecentStudySessions?.(30) || [];
  const recent = [];
  const seen = new Set();
  for (const s of sessions) {
    const key = `${s.appId}::${s.collectionId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    recent.push(s);
    if (recent.length >= 8) break;
  }

  const allStats = store.studyTime.getAllCollectionsStudyStats?.() || [];
  allStats.sort((a, b) => {
    const ta = a?.lastEndIso ? new Date(a.lastEndIso).getTime() : 0;
    const tb = b?.lastEndIso ? new Date(b.lastEndIso).getTime() : 0;
    return tb - ta;
  });
  const recentCollections = allStats.slice(0, 6);

  // old stats grid removed — replaced by Japanese-focused windows below

  const quickLinks = [];
  quickLinks.push(makeLink({ label: 'Flashcards', goTo: linkToAppAndCollection('flashcards', activeId), sublabel: 'Browse and review all fields' }));
  quickLinks.push(makeLink({ label: 'QA Cards', goTo: linkToAppAndCollection('qa-cards', activeId), sublabel: 'Type answers with romaji conversion' }));
  quickLinks.push(makeLink({ label: 'Data', goTo: linkToAppAndCollection('data', activeId), sublabel: 'Table view of entries' }));
  if (activeCategory === 'japanese') {
    quickLinks.push(makeLink({ label: 'Kanji Study', goTo: linkToAppAndCollection('kanji', activeId), sublabel: 'Study kanji cards' }));
  }
  quickLinks.push(makeLink({ label: 'Collections', goTo: '/collections', sublabel: 'Manage collection settings + stats' }));

  // Helper: return sorted, Japanese-filtered items for a window
  function getWindowItems(windowMs) {
    const cutoff = now - windowMs;
    const raw = store.studyTime.getRecentStudySessions?.(1000) || [];
    const map = new Map();
    for (const s of raw) {
      if (!s.endIso) continue;
      const t = new Date(s.endIso).getTime();
      if (t < cutoff) continue;
      const id = s.collectionId;
      const prev = map.get(id) || { collectionId: id, totalMs: 0, lastEndIso: null, lastDurationMs: 0, lastAppId: null };
      prev.totalMs += s.durationMs || 0;
      if (!prev.lastEndIso || new Date(s.endIso).getTime() > new Date(prev.lastEndIso).getTime()) {
        prev.lastEndIso = s.endIso;
        prev.lastDurationMs = s.durationMs || 0;
        prev.lastAppId = s.appId;
      }
      map.set(id, prev);
    }

    let items = Array.from(map.values()).sort((a, b) => {
      const ta = a.lastEndIso ? new Date(a.lastEndIso).getTime() : 0;
      const tb = b.lastEndIso ? new Date(b.lastEndIso).getTime() : 0;
      return tb - ta;
    });

    // Filter to only Japanese collections for this home section
    items = items.filter(it => {
      const coll = store.collections.getCollections?.().find(c => c.key === it.collectionId);
      const category = String(coll?.metadata?.category || '').toLowerCase();
      return category === 'japanese' || String(it.collectionId || '').startsWith('japanese/');
    });

    return items;
  }

  // Render a card from a prepared items array. excludeLabel is shown under the title.
  function renderWindowCard(title, items, totalMs, excludeLabel, windowKey) {
    const cardChildren = [];
    // render the exclude hint when excludeLabel is provided (allow empty string to reserve space)
    if (excludeLabel !== undefined) {
      cardChildren.push(el('div', { className: 'hint', text: excludeLabel }));
    }
    const wrap = el('div', { className: 'home-links' });
    if (!items || items.length === 0) {
      wrap.append(el('p', { className: 'hint', text: 'No collections studied in this period.' }));
    } else {
      for (const it of items) {
        const coll = store.collections.getCollections?.().find(c => c.key === it.collectionId);
        const rawName = coll?.metadata?.name || it.collectionId.replace(/^japanese\/?/, '');
        const collName = rawName;
        const goTo = linkToAppAndCollection('kanji', it.collectionId);
        const when = it.lastEndIso ? `${formatIsoShort(it.lastEndIso)} (${formatRelativeFromIso(it.lastEndIso, now)})` : '';
        const total = it.totalMs ? formatDurationMs(it.totalMs) : '';
        wrap.append(makeLink({ label: collName, goTo, meta: total, sublabel: when }));
      }
    }
    cardChildren.push(wrap);
    const cardEl = card({ title, cornerCaption: formatDurationMs(totalMs), children: cardChildren });
    cardEl.classList.add('home-window-card');
    if (windowKey) cardEl.classList.add(`home-window-${String(windowKey).replace(/\s+/g, '-').toLowerCase()}`);
    return cardEl;
  }

  const sectionLabel = el('div', { className: 'section-label-row', children: [el('h3', { className: 'section-label', text: 'Japanese — Kanji study' })] });

  // Combine the time-window cards into a single "Total Study Time" card
  // Merge all windowed items into a single deduplicated list for a single card
  const windows = [
    getWindowItems(24 * 60 * 60 * 1000),
    getWindowItems(48 * 60 * 60 * 1000),
    getWindowItems(72 * 60 * 60 * 1000),
    getWindowItems(7 * 24 * 60 * 60 * 1000),
  ];

  const unionMap = new Map();
  for (const arr of windows) {
    for (const it of arr) {
      const prev = unionMap.get(it.collectionId) || { ...it };
      // sum totals and pick latest end
      prev.totalMs = (prev.totalMs || 0) + (it.totalMs || 0);
      if (!prev.lastEndIso || (it.lastEndIso && new Date(it.lastEndIso).getTime() > new Date(prev.lastEndIso).getTime())) {
        prev.lastEndIso = it.lastEndIso;
        prev.lastDurationMs = it.lastDurationMs || 0;
        prev.lastAppId = it.lastAppId || null;
      }
      unionMap.set(it.collectionId, prev);
    }
  }

  const mergedItems = Array.from(unionMap.values()).sort((a, b) => {
    const ta = a.lastEndIso ? new Date(a.lastEndIso).getTime() : 0;
    const tb = b.lastEndIso ? new Date(b.lastEndIso).getTime() : 0;
    return tb - ta;
  });

  const totalMsAll = mergedItems.reduce((s, it) => s + (it.totalMs || 0), 0);

  const totalCard = renderWindowCard('Total Study Time', mergedItems, totalMsAll, undefined, 'total');
  totalCard.classList.add('home-window-total');

  // New card: Saved Filters grouped by collection
  function renderSavedFiltersCard() {
    const collList = store.collections.getCollections?.() || [];
    const children = [];
    if (!collList.length) {
      children.push(el('p', { className: 'hint', text: 'No collections available.' }));
    } else {
      for (const coll of collList) {
        if (!coll || !coll.key) continue;
        let state = {};
        try {
          if (typeof store.collections.loadCollectionState === 'function') state = store.collections.loadCollectionState(coll.key) || {};
        } catch (e) {
          state = {};
        }
        const list = Array.isArray(state?.savedTableSearches) ? state.savedTableSearches : (Array.isArray(coll?.savedTableSearches) ? coll.savedTableSearches : []);
        if (!list || !list.length) continue;
        const group = el('div', { className: 'saved-filters-group' });
        group.append(el('div', { className: 'saved-filters-collection-title', text: coll.metadata?.name || coll.key }));
        const wrap = el('div', { className: 'home-links' });
        for (const q of list) {
          const qStr = String(q || '').trim();
          if (!qStr) continue;
          const goTo = `${linkToAppAndCollection('data', coll.key)}&heldTableSearch=${encodeURIComponent(qStr)}`;
          wrap.append(makeLink({ label: qStr, goTo, sublabel: coll.metadata?.name || coll.key }));
        }
        group.append(wrap);
        children.push(group);
      }
      if (!children.length) children.push(el('p', { className: 'hint', text: 'No saved filters found.' }));
    }
    return card({ title: 'Saved Filters', children });
  }

  const savedFiltersCard = renderSavedFiltersCard();

  root.append(sectionLabel, totalCard, savedFiltersCard);

  root.addEventListener('click', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const path = t.getAttribute('data-go');
    if (!path) return;
    e.preventDefault();
    onNavigate(path);
  });

  return root;
}
