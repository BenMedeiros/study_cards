import { renderLanding } from './views/landing.js';
import { renderFlashcards } from './apps/flashcards.js';
import { renderQaCards } from './apps/qaCards.js';
import { renderCrossword } from './apps/crossword.js';
import { renderCollectionsManager } from './views/collections.js';
import { renderPlaceholderTool } from './views/placeholder.js';
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
    brand.style.cursor = 'pointer';
    brand.title = 'Click to collapse/expand header';

    const brandTitle = document.createElement('div');
    brandTitle.className = 'brand-title';
    brandTitle.id = 'hdr-brand-title';
    brandTitle.textContent = 'Study Cards';

    const brandSubtitle = document.createElement('div');
    brandSubtitle.className = 'brand-subtitle';
    brandSubtitle.id = 'hdr-brand-subtitle';
    brandSubtitle.textContent = 'Local-first study tools';

    brand.append(brandTitle, brandSubtitle);
    
    // Add collapse toggle
    brand.addEventListener('click', () => {
      const right = document.getElementById('hdr-right');
      const isCollapsed = right.style.display === 'none';
      right.style.display = isCollapsed ? 'flex' : 'none';
    });

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
        renderRoute(getCurrentRoute());
      }
    });
    collectionSelect.id = 'hdr-collection-select';

    const collectionLabel = document.createElement('span');
    collectionLabel.className = 'badge-muted';
    collectionLabel.id = 'hdr-collection-label';
    collectionLabel.textContent = 'Collection:';

    const collectionGear = document.createElement('button');
    collectionGear.className = 'icon-button';
    collectionGear.id = 'hdr-collection-gear';
    collectionGear.type = 'button';
    collectionGear.title = 'Manage collections';
    collectionGear.textContent = '⚙';
    collectionGear.addEventListener('click', () => {
      const id = store.getActiveCollectionId();
      onNavigate(`/collections${id ? `?collection=${encodeURIComponent(id)}` : ''}`);
    });

    collectionBadge.append(collectionLabel, collectionSelect, collectionGear);

    right.append(collectionBadge);
    headerInner.append(brand, right);

    nav.innerHTML = '';
    const links = [
      { href: '#/', label: 'Home' },
      { href: '#/flashcards', label: 'Flashcards' },
      { href: '#/qa-cards', label: 'QA Cards' },
      { href: '#/crossword', label: 'Crossword' },
      { href: '#/wordsearch', label: 'Word Search' },
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
