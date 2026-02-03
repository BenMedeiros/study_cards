import { card, el } from '../components/ui.js';
import { formatDurationMs, formatIsoShort, formatRelativeFromIso } from '../utils/helpers.js';

const APP_META = {
  home: { label: 'Home', path: '/' },
  flashcards: { label: 'Flashcards', path: '/flashcards' },
  'qa-cards': { label: 'QA Cards', path: '/qa-cards' },
  kanji: { label: 'Kanji Study', path: '/kanji' },
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

function makeLink({ label, goTo, sublabel }) {
  const a = el('a', {
    className: 'home-link',
    text: label,
    attrs: { href: `#${goTo}`, 'data-go': goTo },
  });
  if (!sublabel) return a;
  return el('div', {
    className: 'home-link-row',
    children: [a, el('div', { className: 'hint', text: sublabel })],
  });
}

export function renderLanding({ store, onNavigate }) {
  const root = document.createElement('div');
  root.id = 'home-root';

  const active = store.getActiveCollection();
  const activeId = store.getActiveCollectionId?.() || null;
  const activeName = active?.metadata?.name || 'None';
  const activeCategory = String(active?.metadata?.category || '').toLowerCase();

  const now = Date.now();
  const total24h = store.sumSessionDurations?.({ windowMs: 24 * 60 * 60 * 1000 }) || 0;
  const total48h = store.sumSessionDurations?.({ windowMs: 48 * 60 * 60 * 1000 }) || 0;
  const total72h = store.sumSessionDurations?.({ windowMs: 72 * 60 * 60 * 1000 }) || 0;
  const total7d = store.sumSessionDurations?.({ windowMs: 7 * 24 * 60 * 60 * 1000 }) || 0;

  const sessions = store.getRecentStudySessions?.(30) || [];
  const recent = [];
  const seen = new Set();
  for (const s of sessions) {
    const key = `${s.appId}::${s.collectionId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    recent.push(s);
    if (recent.length >= 8) break;
  }

  const allStats = store.getAllCollectionsStudyStats?.() || [];
  allStats.sort((a, b) => {
    const ta = a?.lastEndIso ? new Date(a.lastEndIso).getTime() : 0;
    const tb = b?.lastEndIso ? new Date(b.lastEndIso).getTime() : 0;
    return tb - ta;
  });
  const recentCollections = allStats.slice(0, 6);

  const focusKanji = (activeCategory === 'japanese' && typeof store.getFocusKanjiValues === 'function')
    ? (store.getFocusKanjiValues(16) || [])
    : [];

  const header = card({
    id: 'home-header-card',
    title: 'Home',
    subtitle: `Active collection: ${activeName}`,
    cornerCaption: activeId ? (activeId.split('/').pop() || activeId) : '',
  });

  const statsGrid = el('div', { className: 'grid', id: 'home-stats-grid' });
  statsGrid.append(
    card({ title: 'Last 24h', cornerCaption: formatDurationMs(total24h), children: [el('p', { className: 'hint', text: 'All collections, all apps' })] }),
    card({ title: 'Last 48h', cornerCaption: formatDurationMs(total48h), children: [el('p', { className: 'hint', text: 'All collections, all apps' })] }),
    card({ title: 'Last 72h', cornerCaption: formatDurationMs(total72h), children: [el('p', { className: 'hint', text: 'All collections, all apps' })] }),
    card({ title: 'Last 7d', cornerCaption: formatDurationMs(total7d), children: [el('p', { className: 'hint', text: 'All collections, all apps' })] }),
  );

  const quickLinks = [];
  quickLinks.push(makeLink({ label: 'Flashcards', goTo: linkToAppAndCollection('flashcards', activeId), sublabel: 'Browse and review all fields' }));
  quickLinks.push(makeLink({ label: 'QA Cards', goTo: linkToAppAndCollection('qa-cards', activeId), sublabel: 'Type answers with romaji conversion' }));
  quickLinks.push(makeLink({ label: 'Data', goTo: linkToAppAndCollection('data', activeId), sublabel: 'Table view of entries' }));
  if (activeCategory === 'japanese') {
    quickLinks.push(makeLink({ label: 'Kanji Study', goTo: linkToAppAndCollection('kanji', activeId), sublabel: 'Study kanji cards' }));
  }
  quickLinks.push(makeLink({ label: 'Collections', goTo: '/collections', sublabel: 'Manage collection settings + stats' }));

  const toolsCard = card({
    id: 'home-tools-card',
    title: 'Open',
    subtitle: 'Jump into a view',
    children: [el('div', { className: 'home-links', children: quickLinks })],
  });

  const recentCard = card({
    id: 'home-recent-card',
    title: 'Pick back up',
    subtitle: 'Most recent app + collection pairs',
  });
  const recentList = el('div', { className: 'home-links', id: 'home-recent-links' });
  if (recent.length === 0) {
    recentList.append(el('p', { className: 'hint', text: 'No study sessions recorded yet.' }));
  } else {
    for (const s of recent) {
      const goTo = linkToAppAndCollection(s.appId, s.collectionId);
      const collName = store.getCollections?.().find(c => c.key === s.collectionId)?.metadata?.name || s.collectionId;
      const when = s.endIso ? `${formatIsoShort(s.endIso)} (${formatRelativeFromIso(s.endIso, now)})` : '';
      const dur = s.durationMs ? formatDurationMs(s.durationMs) : '';
      recentList.append(makeLink({
        label: `${appLabel(s.appId)} — ${collName}`,
        goTo,
        sublabel: [dur, when].filter(Boolean).join(' • '),
      }));
    }
  }
  recentCard.append(recentList);

  const recentCollectionsCard = card({
    id: 'home-recent-collections-card',
    title: 'Recent collections',
    subtitle: 'Last studied collections with totals',
  });
  const collList = el('div', { className: 'home-links', id: 'home-recent-collections-links' });
  if (recentCollections.length === 0) {
    collList.append(el('p', { className: 'hint', text: 'No collection activity yet.' }));
  } else {
    for (const st of recentCollections) {
      const collName = store.getCollections?.().find(c => c.key === st.collectionId)?.metadata?.name || st.collectionId;
      const goTo = linkToAppAndCollection((activeCategory === 'japanese') ? 'kanji' : 'flashcards', st.collectionId);
      const when = st.lastEndIso ? `${formatIsoShort(st.lastEndIso)} (${formatRelativeFromIso(st.lastEndIso, now)})` : '';
      const total = st.totalMs ? formatDurationMs(st.totalMs) : '0s';
      const lastDur = st.lastDurationMs ? formatDurationMs(st.lastDurationMs) : '';
      collList.append(makeLink({
        label: collName,
        goTo,
        sublabel: [
          `Total ${total}`,
          lastDur ? `Last ${lastDur}` : null,
          when || null,
        ].filter(Boolean).join(' • '),
      }));
    }
  }
  recentCollectionsCard.append(collList);

  const focusCard = (activeCategory === 'japanese') ? card({
    id: 'home-focus-card',
    title: 'Focus kanji',
    subtitle: 'Marked as focus (global)',
  }) : null;

  if (focusCard) {
    const wrap = el('div', { className: 'home-focus-wrap' });
    if (focusKanji.length === 0) {
      wrap.append(el('p', { className: 'hint', text: 'No focus kanji yet.' }));
    } else {
      const list = el('div', { className: 'home-focus-list' });
      for (const k of focusKanji) {
        const a = el('a', {
          className: 'pill',
          text: k,
          attrs: { href: `#${linkToAppAndCollection('kanji', activeId)}`, 'data-go': linkToAppAndCollection('kanji', activeId) },
        });
        list.append(a);
      }
      wrap.append(list);
    }
    focusCard.append(wrap);
  }

  const grid = el('div', { className: 'grid', id: 'home-grid' });
  grid.append(toolsCard, recentCard, recentCollectionsCard);
  if (focusCard) grid.append(focusCard);

  root.append(header, statsGrid, grid);

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
