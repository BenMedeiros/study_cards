import { renderLanding } from './apps/landing.js';
import { renderFlashcards } from './apps/flashcards.js';
import { renderQaCards } from './apps/qaCards.js';
import { renderCrossword } from './apps/crossword.js';
import { renderCollectionsManager } from './apps/collections.js';
import { renderData } from './apps/data.js';
import { renderPlaceholderTool } from './apps/placeholder.js';
import { renderKanjiStudyCard } from './apps/kanjiStudyCard.js';
import { createDropdown } from './components/dropdown.js';

export function createAppShell({ store, onNavigate }) {
  const el = document.createElement('div');
  el.id = 'shell-root';

  const header = document.createElement('div');
  header.className = 'header';
  header.id = 'shell-header';

  const headerInner = document.createElement('div');
  headerInner.className = 'header-inner';
  headerInner.id = 'shell-header-inner';

  const nav = document.createElement('div');
  nav.className = 'nav';
  nav.id = 'shell-nav';

  const main = document.createElement('main');
  main.className = 'main';
  main.id = 'shell-main';

  header.append(headerInner);
  header.append(nav);
  el.append(header);
  el.append(main);

  function renderHeader() {
    headerInner.innerHTML = '';

    const brand = document.createElement('div');
    brand.className = 'brand';
    brand.id = 'hdr-brand';

    const brandTitle = document.createElement('div');
    brandTitle.className = 'brand-title';
    brandTitle.id = 'hdr-brand-title';
    brandTitle.textContent = 'Study Cards';

    const brandSubtitle = document.createElement('div');
    brandSubtitle.className = 'brand-subtitle';
    brandSubtitle.id = 'hdr-brand-subtitle';
    brandSubtitle.textContent = 'Local-first study tools';

    brand.append(brandTitle, brandSubtitle);

    const right = document.createElement('div');
    right.className = 'header-right';
    right.id = 'hdr-right';

    const collectionBadge = document.createElement('div');
    collectionBadge.className = 'badge';
    collectionBadge.id = 'hdr-collection-badge';

    const collections = store.getCollections();
    const activeId = store.getActiveCollectionId();

    const collectionSelect = createDropdown({
      items: collections.map(c => ({ value: c.metadata.id, label: c.metadata.name })),
      value: activeId,
      onChange: async (value) => {
        await store.setActiveCollectionId(value);
        renderHeader();
        const currentRoute = getCurrentRoute();
        renderRoute(currentRoute);
      }
    });
    collectionSelect.id = 'hdr-collection-select';

    const collectionLabel = document.createElement('span');
    collectionLabel.className = 'badge-muted';
    collectionLabel.id = 'hdr-collection-label';
    collectionLabel.textContent = 'Collection:';

    collectionBadge.append(collectionLabel, collectionSelect);

    right.append(collectionBadge);
    headerInner.append(brand, right);

    // On mobile, use SK if collection name is long, otherwise show full brand name
    if (window.innerWidth <= 768) {
      const activeCollection = collections.find(c => c.metadata.id === activeId);
      const collectionName = activeCollection?.metadata?.name || '';
      
      if (collectionName.length > 20) {
        headerInner.classList.add('compact-brand');
      } else {
        headerInner.classList.remove('compact-brand');
      }
    } else {
      headerInner.classList.remove('compact-brand');
    }

    nav.innerHTML = '';
    const links = [
      { href: '#/', label: 'Home' },
      { href: '#/flashcards', label: 'Flashcards' },
      { href: '#/qa-cards', label: 'QA Cards' },
      { href: '#/crossword', label: 'Crossword' },
      { href: '#/wordsearch', label: 'Word Search' },
      { href: '#/kanji', label: 'Kanji Study' },
      { href: '#/data', label: 'Data' },
      { href: '#/collections', label: 'Collections' },
    ];

    const currentPath = getCurrentRoute().pathname;
    for (const l of links) {
      const a = document.createElement('a');
      a.id = `nav-link-${String(l.label).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      a.href = l.href;
      a.textContent = l.label;
      const linkPath = l.href.replace(/^#/, '');
      if (linkPath === currentPath) a.classList.add('active');
      nav.append(a);
    }
  }

  function getCurrentRoute() {
    const raw = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
    const path = raw.startsWith('/') ? raw : '/';
    const [pathname, search = ''] = path.split('?');
    return { pathname, query: new URLSearchParams(search) };
  }

  function renderRoute(route) {
    renderHeader();
    main.innerHTML = '';

    if (route.pathname === '/') {
      main.append(renderLanding({ store, onNavigate }));
      return;
    }

    if (route.pathname === '/flashcards') {
      main.append(renderFlashcards({ store }));
      return;
    }

    if (route.pathname === '/qa-cards') {
      main.append(renderQaCards({ store, onNavigate }));
      return;
    }
    if (route.pathname === '/crossword') {
      main.append(renderCrossword({ store }));
      return;
    }

    if (route.pathname === '/wordsearch') {
      main.append(renderPlaceholderTool({ title: 'Word Search', hint: 'Scaffolded — coming soon.' }));
      return;
    }

    if (route.pathname === '/kanji') {
      main.append(renderKanjiStudyCard({ store }));
      return;
    }

    if (route.pathname === '/data') {
      main.append(renderData({ store }));
      return;
    }

    if (route.pathname === '/collections') {
      main.append(renderCollectionsManager({ store, onNavigate, route }));
      return;
    }

    main.append(renderPlaceholderTool({ title: 'Not Found', hint: `No route for ${route.pathname}` }));
  }

  store.subscribe(() => {
    renderHeader();
  });

  return { el, renderHeader, renderRoute, getCurrentRoute };
}