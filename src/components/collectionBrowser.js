/**
 * Folder-browsing dropdown for selecting a collection JSON file.
 *
 * This is intentionally separate from `createDropdown` (used elsewhere)
 * because this needs hierarchical navigation (folders + up-dir).
 */

import { basename, dirname, titleFromFilename } from '../utils/helpers.js';

function isCollectionSetsFileKey(key) {
  return basename(key) === '_collectionSets.json';
}

function isCollectionSetsVirtualDir(dirPath) {
  const p = String(dirPath || '').replace(/^\/+/, '').replace(/\/+$/, '');
  return p === '__collectionSets' || p.endsWith('/__collectionSets');
}

function safeFolderLabelFromCollectionSets(cs) {
  const raw = cs && typeof cs === 'object' ? (cs.name || cs.label || cs.title) : null;
  const s = (typeof raw === 'string') ? raw.trim() : '';
  return s || 'Collection Sets';
}

export function createCollectionBrowserDropdown({ store, className = '', onSelect }) {
  const container = document.createElement('div');
  container.className = `custom-dropdown ${className}`;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'custom-dropdown-button';

  const menu = document.createElement('div');
  menu.className = 'custom-dropdown-menu';
  // menu.tabIndex = -1; // make focusable so we can capture key events when open
  // tab index was making a weird focus ring appear 
  function onCloseOverlaysEvent() {
    if (container.classList.contains('open')) {
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
    // Only respect an explicit, non-empty path from the store. Empty
    // string means "no preference" so fall back to the active collection.
    if (typeof fromStore === 'string' && fromStore.length > 0) {
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
        // Remember the directory we are leaving so when we re-render the
        // parent listing we can focus the folder we came from.
        container.dataset.kbDesired = currentDir || '';
        setCurrentDir(value);
        renderMenu();
        return;
      }

      if (kind === 'folder') {
        // When entering a folder, focus the 'up' option in the new listing.
        container.dataset.kbDesired = 'up';
        setCurrentDir(value);
        renderMenu();
        return;
      }

      if (kind === 'sets-folder') {
        // Ensure sets are loaded for this folder before entering the virtual listing.
        try {
          const baseFolder = dirname(value);
          if (store && typeof store.loadCollectionSetsForFolder === 'function') {
            await store.loadCollectionSetsForFolder(baseFolder);
          }

          // Eagerly prefetch the entire base folder in the background.
          if (store && typeof store.prefetchCollectionsInFolder === 'function') {
            store.prefetchCollectionsInFolder(baseFolder);
          }
        } catch (err) {
          // ignore load error; menu will show empty
        }
        container.dataset.kbDesired = 'up';
        setCurrentDir(value);
        renderMenu();
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
      // Special-case: show per-folder collection sets as a virtual folder.
      if (file.key && isCollectionSetsFileKey(file.key)) {
        const baseFolder = dirname(file.key);
        const vdir = baseFolder ? `${baseFolder}/__collectionSets` : '__collectionSets';

        let folderLabel = 'Collection Sets';
        if (store && typeof store.getCachedCollectionSetsForFolder === 'function') {
          const cs = store.getCachedCollectionSetsForFolder(baseFolder);
          if (cs) folderLabel = safeFolderLabelFromCollectionSets(cs);
          // If it isn't cached yet (undefined), load in the background and re-render.
          if (typeof cs === 'undefined' && typeof store.loadCollectionSetsForFolder === 'function' && container.classList.contains('open')) {
            Promise.resolve()
              .then(() => store.loadCollectionSetsForFolder(baseFolder))
              .then(() => {
                if (container.classList.contains('open')) renderMenu();
              })
              .catch(() => {});
          }
        }

        addOption({ label: `${folderLabel}/`, kind: 'sets-folder', value: vdir });
        continue;
      }
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

    // Restore keyboard-focused index if requested, otherwise keep existing index
    const desired = container.dataset.kbDesired;
    let focusIndex = -1;
    const options = Array.from(menu.querySelectorAll('.custom-dropdown-option'));
    if (typeof desired === 'string' && desired.length > 0) {
      if (desired === 'up') {
        focusIndex = options.findIndex(o => o.dataset.kind === 'up');
      } else {
        // desired is a path: focus the folder option matching that path
        focusIndex = options.findIndex(o => o.dataset.value === desired);
      }
    }

    // If no desired index, try to reuse previous index stored on container
    if (focusIndex === -1 && typeof container.dataset.kbIndex === 'string') {
      const prev = Number(container.dataset.kbIndex);
      if (Number.isFinite(prev) && prev >= 0 && prev < options.length) focusIndex = prev;
    }

    // If still nothing, default to the selected file or first option
    if (focusIndex === -1) {
      const sel = options.findIndex(o => o.classList.contains('selected'));
      focusIndex = sel >= 0 ? sel : (options.length ? 0 : -1);
    }

    // Apply keyboard-focus class
    options.forEach(o => o.classList.remove('keyboard-focus'));
    if (focusIndex >= 0 && options[focusIndex]) {
      options[focusIndex].classList.add('keyboard-focus');
      container.dataset.kbIndex = String(focusIndex);
      options[focusIndex].scrollIntoView({ block: 'nearest' });
    } else {
      delete container.dataset.kbIndex;
    }

    // Clear desired flag after applying
    delete container.dataset.kbDesired;
  }

  function open() {
    syncDirFromState();
    button.textContent = getButtonLabel();
    renderMenu();
    container.classList.add('open');
    document.addEventListener('ui:closeOverlays', onCloseOverlaysEvent);

    // If we're currently inside the virtual Collection Sets dir, ensure its data
    // is loaded and then re-render (so reopen after refresh isn't empty).
    if (isCollectionSetsVirtualDir(currentDir) && store && typeof store.loadCollectionSetsForFolder === 'function') {
      const baseFolder = dirname(currentDir);
      Promise.resolve()
        .then(() => store.loadCollectionSetsForFolder(baseFolder))
        .then(() => {
          if (container.classList.contains('open')) renderMenu();
        })
        .catch(() => {
          // ignore
        });
    }

    // focus the menu so it receives key events first and they don't leak to the app
    setTimeout(() => {
      try { menu.focus(); } catch (err) {}
    }, 0);

    // attach a local key handler on the menu to intercept navigation keys
    if (!menu._localKeyHandler) {
      menu._localKeyHandler = (e) => {
        const navKeys = ['ArrowUp','ArrowDown','Enter',' ','ArrowLeft','ArrowRight','Escape'];
        if (!navKeys.includes(e.key)) return;
        e.preventDefault();
        e.stopPropagation();

        const options = Array.from(menu.querySelectorAll('.custom-dropdown-option'));
        if (options.length === 0) return;

        let idx = Number(container.dataset.kbIndex);
        if (!Number.isFinite(idx) || idx < 0 || idx >= options.length) {
          const sel = options.findIndex(o => o.classList.contains('selected'));
          idx = sel >= 0 ? sel : 0;
        }

        if (e.key === 'ArrowDown') {
          idx = Math.min(idx + 1, options.length - 1);
          options.forEach(o => o.classList.remove('keyboard-focus'));
          options[idx].classList.add('keyboard-focus');
          options[idx].scrollIntoView({ block: 'nearest' });
          container.dataset.kbIndex = String(idx);
          return;
        }

        if (e.key === 'ArrowUp') {
          idx = Math.max(idx - 1, 0);
          options.forEach(o => o.classList.remove('keyboard-focus'));
          options[idx].classList.add('keyboard-focus');
          options[idx].scrollIntoView({ block: 'nearest' });
          container.dataset.kbIndex = String(idx);
          return;
        }

        if (e.key === 'Enter' || e.key === ' ') {
          const opt = options[idx];
          if (opt) opt.click();
          return;
        }

        if (e.key === 'ArrowRight') {
          const opt = options[idx];
          if (opt && opt.dataset.kind === 'folder') {
            opt.click();
          }
          return;
        }

        if (e.key === 'ArrowLeft') {
          const upOpt = menu.querySelector('.custom-dropdown-option[data-kind="up"]');
          if (upOpt) upOpt.click();
          return;
        }

        if (e.key === 'Escape') {
          close();
          button.focus();
          return;
        }
      };
      menu.addEventListener('keydown', menu._localKeyHandler);
    }

    // Also add a document-level capturing handler so keys are intercepted
    // before other document listeners (e.g., flashcards) can react.
    if (!container._captureKeyHandler) {
      container._captureKeyHandler = (e) => {
        const navKeys = ['ArrowUp','ArrowDown','Enter',' ','ArrowLeft','ArrowRight','Escape'];
        if (!navKeys.includes(e.key)) return;
        // Allow events that originate inside this dropdown (so the menu handlers run).
        // Only intercept keys when the active element is outside the container.
        if (container.classList.contains('open') && !container.contains(document.activeElement)) {
          e.preventDefault();
          e.stopPropagation();
        }
      };
      document.addEventListener('keydown', container._captureKeyHandler, true);
    }
  }

  function close() {
    container.classList.remove('open');
    // cleanup keyboard focus metadata and classes
    delete container.dataset.kbIndex;
    delete container.dataset.kbDesired;
    if (menu) menu.querySelectorAll('.custom-dropdown-option').forEach(o => o.classList.remove('keyboard-focus'));
    // remove local key handler and blur menu so background gets keys again
    if (menu && menu._localKeyHandler) {
      menu.removeEventListener('keydown', menu._localKeyHandler);
      delete menu._localKeyHandler;
    }
    // remove the capturing document handler
    if (container && container._captureKeyHandler) {
      document.removeEventListener('keydown', container._captureKeyHandler, true);
      delete container._captureKeyHandler;
    }
    try { menu.blur(); } catch (err) {}
    // Clear ephemeral store path so next open defaults to active collection
    try {
      if (store && typeof store.setCollectionBrowserPath === 'function') {
        store.setCollectionBrowserPath('');
      }
    } catch (err) {}
    document.removeEventListener('ui:closeOverlays', onCloseOverlaysEvent);
  }

  button.addEventListener('click', (e) => {
    e.stopPropagation();

    // Close other overlays (e.g., autoplay settings) before opening.
    document.dispatchEvent(new CustomEvent('ui:closeOverlays'));

    const isOpen = container.classList.contains('open');

    document.querySelectorAll('.custom-dropdown.open').forEach(d => {
      if (d !== container) d.classList.remove('open');
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
