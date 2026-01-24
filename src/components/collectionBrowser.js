/**
 * Folder-browsing dropdown for selecting a collection JSON file.
 *
 * This is intentionally separate from `createDropdown` (used elsewhere)
 * because this needs hierarchical navigation (folders + up-dir).
 */

function dirname(path) {
  const parts = String(path || '').split('/').filter(Boolean);
  if (parts.length <= 1) return '';
  parts.pop();
  return parts.join('/');
}

function basename(path) {
  const parts = String(path || '').split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

function titleFromFilename(filename) {
  return String(filename || '')
    .replace(/\.json$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
}

export function createCollectionBrowserDropdown({ store, className = '', onSelect }) {
  const container = document.createElement('div');
  container.className = `custom-dropdown ${className}`;
  container.style.position = 'relative';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'custom-dropdown-button';

  const menu = document.createElement('div');
  menu.className = 'custom-dropdown-menu';
  menu.style.display = 'none';
  menu.style.position = 'fixed';
  menu.style.left = '0px';
  menu.style.top = '0px';
  menu.style.zIndex = '1000';

  function onCloseOverlaysEvent() {
    if (menu.style.display === 'block') {
      close();
      button.focus();
    }
  }

  function getButtonLabel() {
    const active = store.getActiveCollection();
    if (active?.metadata?.name) return active.metadata.name;
    if (active?.key) return titleFromFilename(basename(active.key));
    return 'Select…';
  }

  let currentDir = '';

  function syncDirFromState() {
    const fromStore = store.getCollectionBrowserPath?.();
    if (typeof fromStore === 'string') {
      currentDir = fromStore;
      return;
    }

    const activeId = store.getActiveCollectionId?.();
    if (activeId) currentDir = dirname(activeId);
  }

  function setCurrentDir(nextDir) {
    currentDir = nextDir || '';
    if (store.setCollectionBrowserPath) {
      store.setCollectionBrowserPath(currentDir);
    }
  }

  function clearMenu() {
    menu.innerHTML = '';
  }

  function addOption({ label, kind, value, disabled = false }) {
    const option = document.createElement('div');
    option.className = 'custom-dropdown-option';
    option.textContent = label;
    option.dataset.kind = kind;
    option.dataset.value = value ?? '';

    if (disabled) {
      option.style.opacity = '0.6';
      option.style.pointerEvents = 'none';
    }

    option.addEventListener('click', async (e) => {
      // Important: for folder/up navigation we re-render the menu.
      // That removes the clicked element from the DOM, and without stopping
      // propagation the document-level outside-click handler will think the
      // click was "outside" and close the menu.
      e.stopPropagation();

      if (kind === 'up') {
        setCurrentDir(value);
        renderMenu();
        positionMenu();
        return;
      }

      if (kind === 'folder') {
        setCurrentDir(value);
        renderMenu();
        positionMenu();
        return;
      }

      if (kind === 'file') {
        if (typeof onSelect === 'function') {
          await onSelect(value);
        } else {
          await store.setActiveCollectionId(value);
        }
        close();
        return;
      }
    });

    menu.append(option);
  }

  function renderMenu() {
    clearMenu();

    const activeId = store.getActiveCollectionId?.();

    const listing = store.listCollectionDir
      ? store.listCollectionDir(currentDir)
      : { dir: currentDir, parentDir: '', folders: [], files: [] };

    if (listing.dir && listing.parentDir !== null) {
      addOption({ label: `<- [${listing.dir}/..]`, kind: 'up', value: listing.parentDir ?? '' });
    }

    for (const folder of listing.folders) {
      const label = folder.label || folder.name || folder.path;
      addOption({ label: `${label}/`, kind: 'folder', value: folder.path });
    }

    for (const file of listing.files) {
      const label = file.label || titleFromFilename(basename(file.key));
      addOption({ label, kind: 'file', value: file.key });
      if (file.key && file.key === activeId) {
        // highlight selected file
        const last = menu.lastElementChild;
        if (last) last.classList.add('selected');
      }
    }

    if (listing.folders.length === 0 && listing.files.length === 0) {
      addOption({ label: '(empty)', kind: 'noop', value: '', disabled: true });
    }
  }

  function positionMenu() {
    const docW = window.innerWidth;
    const docH = window.innerHeight;
    const btnRect = button.getBoundingClientRect();

    const prevDisplay = menu.style.display;
    const prevVisibility = menu.style.visibility;
    menu.style.visibility = 'hidden';
    menu.style.display = 'block';
    const menuRect = menu.getBoundingClientRect();

    let desiredLeft = btnRect.right - menuRect.width;
    if (desiredLeft < 0) desiredLeft = btnRect.left;
    if (desiredLeft + menuRect.width > docW) desiredLeft = Math.max(0, docW - menuRect.width);
    menu.style.left = `${Math.round(desiredLeft)}px`;

    if (btnRect.bottom + menuRect.height > docH && btnRect.top - menuRect.height >= 0) {
      const upwardTop = btnRect.top - menuRect.height;
      menu.style.top = `${Math.round(upwardTop)}px`;
    } else {
      menu.style.top = `${Math.round(btnRect.bottom)}px`;
    }

    menu.style.minWidth = `${Math.max(Math.round(btnRect.width), Math.round(menuRect.width))}px`;

    menu.style.display = prevDisplay;
    menu.style.visibility = prevVisibility;
  }

  function open() {
    syncDirFromState();
    button.textContent = getButtonLabel();
    renderMenu();

    menu.style.display = 'block';
    container.classList.add('open');
    positionMenu();

    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, { passive: true });
    document.addEventListener('ui:closeOverlays', onCloseOverlaysEvent);
  }

  function close() {
    menu.style.display = 'none';
    container.classList.remove('open');
    window.removeEventListener('resize', positionMenu);
    window.removeEventListener('scroll', positionMenu);
    document.removeEventListener('ui:closeOverlays', onCloseOverlaysEvent);
  }

  button.addEventListener('click', (e) => {
    e.stopPropagation();

    // Close other overlays (e.g., autoplay settings) before opening.
    document.dispatchEvent(new CustomEvent('ui:closeOverlays'));

    const isOpen = menu.style.display === 'block';

    document.querySelectorAll('.custom-dropdown-menu').forEach(m => {
      m.style.display = 'none';
    });
    document.querySelectorAll('.custom-dropdown').forEach(d => {
      d.classList.remove('open');
    });

    if (!isOpen) open();
    else close();
  });

  const closeOnClickOutside = (e) => {
    if (!container.contains(e.target) && !menu.contains(e.target)) {
      close();
    }
  };

  setTimeout(() => {
    document.addEventListener('click', closeOnClickOutside);
  }, 0);

  // initial label
  button.textContent = getButtonLabel();

  container.append(button, menu);
  return container;
}
