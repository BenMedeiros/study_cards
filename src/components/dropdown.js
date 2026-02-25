/**
 * Create a custom styled dropdown that replaces native <select>
 * @param {Object} options
 * @param {Array<{value: string, label: string}>} options.items - Dropdown items
 * @param {string} options.value - Currently selected value (single-select)
 * @param {string[]} options.values - Currently selected values (multi-select)
 * @param {boolean} options.multi - Enable multi-select
 * @param {Function} options.onChange - Callback when selection changes (value|values)
 * @param {string} options.className - Optional CSS class
 * @param {boolean} options.closeOverlaysOnOpen - If true, dispatches ui:closeOverlays before opening.
 * @param {Function} options.getButtonLabel - Optional function to render button label.
 * @param {Function} options.renderOption - Optional function to render an option row.
 * @returns {HTMLElement} Custom dropdown element
 */
export function createDropdown({
  items,
  value,
  values,
  multi = false,
  onChange,
  className = '',
  closeOverlaysOnOpen = true,
  getButtonLabel = null,
  renderOption = null,
  // If true (multi-select only), defer onChange until the menu closes.
  // This supports "apply on close" UX and avoids triggering expensive work on each click.
  commitOnClose = false,
  // Optional hook fired whenever the menu closes.
  onClose = null,
}) {
  const container = document.createElement('div');
  container.className = `custom-dropdown ${className}`;
  
  const normalizedItems = Array.isArray(items) ? items : [];

  // internal selection state
  let selectedValues = [];
  if (multi) {
    if (Array.isArray(values)) selectedValues = values.map(v => String(v || '')).filter(Boolean);
    else if (value != null && String(value).trim()) selectedValues = [String(value).trim()];
  }

  const selected = normalizedItems.find(item => item.value === value) || normalizedItems[0];
  
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'custom-dropdown-button';
  button.textContent = selected?.label || '';
  
  const menu = document.createElement('div');
  menu.className = 'custom-dropdown-menu';

  // When dropdowns live inside horizontally-scrollable containers (e.g. view header tools),
  // the menu can get clipped by overflow. To avoid this, we "portal" the menu to a top-level
  // mount when opened and position it with fixed coordinates.
  let isPortaled = false;
  let menuHome = null;
  let repositionHandler = null;

  function getPortalMount() {
    return document.getElementById('shell-root') || document.getElementById('app') || document.body;
  }

  function portalMenu() {
    if (isPortaled) return;
    menuHome = {
      parent: container,
      nextSibling: menu.nextSibling,
    };
    const mount = getPortalMount();
    try {
      mount.appendChild(menu);
      isPortaled = true;
      // Ensure the menu is visible even when it is no longer a descendant of `.custom-dropdown.open`.
      menu.style.display = 'block';
      menu.style.position = 'fixed';
      menu.style.zIndex = '1300';
    } catch (e) {
      // If portaling fails for any reason, keep the menu in place.
      isPortaled = false;
      menuHome = null;
      menu.style.display = '';
      menu.style.position = '';
      menu.style.zIndex = '';
    }
  }

  function restoreMenu() {
    if (!isPortaled) return;
    try {
      // Clear fixed positioning styles before restoring.
      menu.style.left = '';
      menu.style.top = '';
      menu.style.zIndex = '';
      menu.style.position = '';
      menu.style.display = '';
    } catch (e) {}

    try {
      const parent = menuHome?.parent || container;
      const next = menuHome?.nextSibling || null;
      if (next && next.parentNode === parent) parent.insertBefore(menu, next);
      else parent.appendChild(menu);
    } catch (e) {
      try { container.appendChild(menu); } catch (e2) {}
    }
    isPortaled = false;
    menuHome = null;
  }

  function positionPortaledMenu() {
    if (!isPortaled) return;
    try {
      const btnRect = button.getBoundingClientRect();
      const margin = 8;
      const gap = 6;

      // Start aligned to the button's left.
      let left = btnRect.left;
      let top = btnRect.bottom + gap;

      // Temporarily set to measure.
      menu.style.left = `${Math.round(left)}px`;
      menu.style.top = `${Math.round(top)}px`;

      const rect = menu.getBoundingClientRect();

      // Clamp horizontally inside the viewport.
      if (rect.right > window.innerWidth - margin) {
        left = Math.max(margin, btnRect.right - rect.width);
      }
      if (left < margin) left = margin;

      // If it would go off the bottom, flip above (when possible).
      if (rect.bottom > window.innerHeight - margin) {
        const aboveTop = btnRect.top - gap - rect.height;
        if (aboveTop >= margin) top = aboveTop;
      }

      menu.style.left = `${Math.round(left)}px`;
      menu.style.top = `${Math.round(top)}px`;
    } catch (e) {
      // ignore
    }
  }

  const isOpen = () => container.classList.contains('open');

  // Track whether we've committed changes for the current open/close cycle.
  let didCommitThisOpen = false;

  function onCloseOverlaysEvent() {
    if (isOpen()) closeMenu({ focusButton: true });
  }

  function closeMenu({ focusButton = false } = {}) {
    const wasOpen = isOpen();
    container.classList.remove('open');
    container.classList.remove('align-right');
    document.removeEventListener('ui:closeOverlays', onCloseOverlaysEvent);

    // If the menu was portaled out, restore it before we remove handlers.
    try {
      if (repositionHandler) {
        window.removeEventListener('scroll', repositionHandler, true);
        window.removeEventListener('resize', repositionHandler);
        repositionHandler = null;
      }
    } catch (e) {}
    restoreMenu();

    // remove dropdown-specific keyboard handler if present
    if (container._ddKeyHandler) {
      document.removeEventListener('keydown', container._ddKeyHandler);
      delete container._ddKeyHandler;
    }
    // For multi-select "apply on close", fire a single commit when the menu closes.
    if (wasOpen && multi && commitOnClose && !didCommitThisOpen) {
      didCommitThisOpen = true;
      try {
        if (typeof onChange === 'function') onChange(selectedValues.slice());
      } catch (e) {}
    }
    // Always notify close hook after commit.
    if (wasOpen && typeof onClose === 'function') {
      try {
        onClose({
          value: (multi ? null : value),
          values: (multi ? selectedValues.slice() : null),
        });
      } catch (e) {}
    }
    if (focusButton) button.focus();
  }

  function setButtonLabel() {
    try {
      if (typeof getButtonLabel === 'function') {
        const set = new Set(selectedValues);
        const selectedItems = normalizedItems.filter(it => set.has(String(it?.value)));
        const selectedItem = (!multi)
          ? (normalizedItems.find(item => item.value === value) || normalizedItems[0] || null)
          : null;
        const rendered = getButtonLabel({
          selectedValues: (multi ? selectedValues.slice() : []),
          selectedItems,
          selectedItem,
          value: (multi ? null : value),
          items: normalizedItems.slice(),
        });
        if (rendered && typeof rendered === 'object' && rendered.nodeType === 1) {
          button.innerHTML = '';
          button.append(rendered);
          button.classList.add('custom-dropdown-button-multiline');
          return;
        }
        if (typeof rendered === 'string') {
          button.textContent = rendered;
          // heuristically treat multi-line strings as multi-line labels
          if (rendered.includes('\n')) button.classList.add('custom-dropdown-button-multiline');
          else button.classList.remove('custom-dropdown-button-multiline');
          return;
        }
      }
    } catch (e) {
      // fallback to default
    }

    // Default label behavior
    if (!multi) {
      const sel = normalizedItems.find(item => item.value === value) || normalizedItems[0];
      button.textContent = sel?.label || '';
      button.classList.remove('custom-dropdown-button-multiline');
      return;
    }

    const set = new Set(selectedValues);
    const selectedItems = normalizedItems.filter(it => set.has(String(it?.value)));
    if (!selectedItems.length) {
      button.textContent = '';
      return;
    }
    button.textContent = selectedItems.map(it => it.label).join(', ');
  }

  function renderOptionNode({ item, isSelected }) {
    if (typeof renderOption === 'function') {
      const node = renderOption({ item, selected: !!isSelected });
      if (node && typeof node === 'object' && node.nodeType === 1) return node;
    }

    // Default: label text, but support optional left/right text columns
    const left = item?.leftText ?? item?.left;
    const right = item?.rightText ?? item?.right;
    if (left != null || right != null) {
      const row = document.createElement('div');
      row.className = 'custom-dropdown-option-row';
      const l = document.createElement('span');
      l.className = 'custom-dropdown-option-left';
      l.textContent = String(left ?? item?.label ?? '');
      const r = document.createElement('span');
      r.className = 'custom-dropdown-option-right';
      r.textContent = String(right ?? '');
      row.append(l, r);
      return row;
    }

    const txt = document.createElement('span');
    txt.textContent = item?.label || '';
    return txt;
  }

  function isSelectableItem(it) {
    const kind = String(it?.kind || '').trim();
    return kind !== 'divider' && kind !== 'action';
  }

  function selectableValues() {
    return normalizedItems
      .filter(isSelectableItem)
      .map(it => String(it?.value ?? ''))
      .filter(Boolean);
  }

  function syncSelectedClasses() {
    try {
      const set = new Set(selectedValues);
      menu.querySelectorAll('.custom-dropdown-option').forEach(opt => {
        const kind = opt?.dataset?.kind;
        if (kind === 'divider' || kind === 'action') return;
        const v = String(opt?.dataset?.value ?? '');
        opt.classList.toggle('selected', set.has(v));
      });
    } catch (e) {
      // ignore
    }
  }
  
  for (const item of normalizedItems) {
    const option = document.createElement('div');
    option.className = 'custom-dropdown-option';
    const itemValue = String(item?.value ?? '');
    const kind = String(item?.kind || '').trim();
    if (kind) option.dataset.kind = kind;

    // Divider row (non-interactive)
    if (kind === 'divider') {
      option.classList.add('divider');
      option.textContent = item?.label || '—';
      menu.append(option);
      continue;
    }

    const isSelected = (multi && isSelectableItem(item))
      ? selectedValues.includes(itemValue)
      : (itemValue === String(value ?? ''));

    if (isSelected) option.classList.add('selected');
    option.innerHTML = '';
    option.append(renderOptionNode({ item, isSelected }));
    option.dataset.value = item.value;
    
    option.addEventListener('click', () => {
      // Action rows (None / All) for multi-select
      if (multi && kind === 'action') {
        const action = String(item?.action || '').trim().toLowerCase();
        if (action === 'none') {
          selectedValues = [];
          syncSelectedClasses();
          setButtonLabel();
          if (!commitOnClose && onChange) onChange(selectedValues.slice());
          return;
        }
        if (action === 'all') {
          selectedValues = selectableValues();
          syncSelectedClasses();
          setButtonLabel();
          if (!commitOnClose && onChange) onChange(selectedValues.slice());
          return;
        }
        if (action === 'toggleallnone') {
          const all = selectableValues();
          const set = new Set(selectedValues);
          const isAll = all.length > 0 && all.every(v => set.has(v));
          selectedValues = isAll ? [] : all;
          syncSelectedClasses();
          setButtonLabel();
          if (!commitOnClose && onChange) onChange(selectedValues.slice());
          return;
        }
        return;
      }

      if (!multi) {
        // Keep internal value in sync for keyboard navigation
        value = item.value;

        // Update selected state
        menu.querySelectorAll('.custom-dropdown-option').forEach(opt => {
          opt.classList.remove('selected');
        });
        option.classList.add('selected');

        setButtonLabel();
        closeMenu();
        if (onChange) onChange(item.value);
        return;
      }

      // Multi-select: toggle and keep open
      const v = itemValue;
      const set = new Set(selectedValues);
      if (set.has(v)) set.delete(v);
      else set.add(v);
      selectedValues = Array.from(set);

      // Update selected state
      option.classList.toggle('selected', set.has(v));
      setButtonLabel();
      if (!commitOnClose && onChange) onChange(selectedValues.slice());
    });
    
    menu.append(option);
  }

  // Initialize button label after options built
  setButtonLabel();
  
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    // Close other overlays (e.g., autoplay settings) before opening.
    // Some dropdowns live inside overlays (e.g. shell settings) and should not close them.
    if (closeOverlaysOnOpen) {
      document.dispatchEvent(new CustomEvent('ui:closeOverlays'));
    }

    const open = isOpen();
    
    // Close all other dropdowns and clear their alignment
    document.querySelectorAll('.custom-dropdown.open').forEach(d => {
      if (d !== container) {
        d.classList.remove('open');
        d.classList.remove('align-right');
      }
    });

    // Toggle this dropdown
    if (!open) {
      container.classList.add('open');
      didCommitThisOpen = false;
      document.addEventListener('ui:closeOverlays', onCloseOverlaysEvent);

      // Portal the menu so it isn't clipped by overflow containers.
      portalMenu();
      positionPortaledMenu();

      // Keep it positioned correctly on scroll/resize while open.
      repositionHandler = () => positionPortaledMenu();
      window.addEventListener('scroll', repositionHandler, true);
      window.addEventListener('resize', repositionHandler);

      // After opening, measure the menu and align to the right if it would overflow the viewport.
      // Use a microtask to ensure styles are applied and menu is rendered.
      Promise.resolve().then(() => {
        // If the menu is portaled, we already clamp it.
        if (isPortaled) {
          positionPortaledMenu();
          return;
        }

        const rect = menu.getBoundingClientRect();
        const margin = 8; // keep a small gap from the viewport edge
        if (rect.right > (window.innerWidth - margin) || rect.left < 0) {
          container.classList.add('align-right');
        } else {
          container.classList.remove('align-right');
        }
      });
      // Setup keyboard navigation for the opened menu
      Promise.resolve().then(() => {
        const options = Array.from(menu.querySelectorAll('.custom-dropdown-option'));
        const selIndex = options.findIndex(o => o.classList.contains('selected'));
        const initIndex = selIndex >= 0 ? selIndex : (options.length ? 0 : -1);
        if (initIndex >= 0) {
          options.forEach(o => o.classList.remove('keyboard-focus'));
          options[initIndex].classList.add('keyboard-focus');
          container.dataset.kbIndex = String(initIndex);
        }

        const ddKeyHandler = (e) => {
          if (!container.classList.contains('open')) return;
          const key = e.key;
          if (!['ArrowDown','ArrowUp','Enter',' '].includes(key)) return;
          e.preventDefault();
          e.stopPropagation();

          const opts = Array.from(menu.querySelectorAll('.custom-dropdown-option'));
          if (opts.length === 0) return;
          let idx = Number(container.dataset.kbIndex);
          if (!Number.isFinite(idx) || idx < 0 || idx >= opts.length) {
            const s = opts.findIndex(o => o.classList.contains('selected'));
            idx = s >= 0 ? s : 0;
          }

          if (key === 'ArrowDown') {
            idx = Math.min(idx + 1, opts.length - 1);
            opts.forEach(o => o.classList.remove('keyboard-focus'));
            opts[idx].classList.add('keyboard-focus');
            opts[idx].scrollIntoView({ block: 'nearest' });
            container.dataset.kbIndex = String(idx);
            return;
          }

          if (key === 'ArrowUp') {
            idx = Math.max(idx - 1, 0);
            opts.forEach(o => o.classList.remove('keyboard-focus'));
            opts[idx].classList.add('keyboard-focus');
            opts[idx].scrollIntoView({ block: 'nearest' });
            container.dataset.kbIndex = String(idx);
            return;
          }

          if (key === 'Enter' || key === ' ') {
            const opt = opts[idx];
            if (opt) opt.click();
            delete container.dataset.kbIndex;
            return;
          }
        };

        container._ddKeyHandler = ddKeyHandler;
        document.addEventListener('keydown', ddKeyHandler);
      });
    } else {
      closeMenu();
    }
  });
  
  // Close dropdown when clicking outside
  const closeOnClickOutside = (e) => {
    if (!container.contains(e.target) && !menu.contains(e.target)) {
      closeMenu();
    }
  };
  
  // Attach listener when dropdown is added to DOM
  setTimeout(() => {
    document.addEventListener('click', closeOnClickOutside);
  }, 0);
  
  // Keyboard navigation
  button.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      button.click();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (multi) return;
      const currentIndex = normalizedItems.findIndex(item => item.value === value);
      const nextIndex = e.key === 'ArrowDown' 
        ? Math.min(currentIndex + 1, normalizedItems.length - 1)
        : Math.max(currentIndex - 1, 0);
      
      const nextItem = normalizedItems[nextIndex];
      if (nextItem && onChange) {
        onChange(nextItem.value);
        value = nextItem.value;
        setButtonLabel();
        
        // Update selected state
        menu.querySelectorAll('.custom-dropdown-option').forEach((opt, i) => {
          opt.classList.toggle('selected', i === nextIndex);
        });
      }
    }
  });
  
  container.append(button, menu);
  return container;
}
