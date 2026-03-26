import { el } from '../../utils/browser/ui.js';
import { createDropdown } from '../../components/shared/dropdown.js';
import { createJsonViewer } from '../../components/shared/jsonViewer.js';

function normalizeFieldItems(fields) {
  const items = Array.isArray(fields) ? fields : [];
  const out = [];
  const seen = new Set();
  for (const raw of items) {
    const key = String(raw?.key ?? raw?.value ?? '').trim();
    if (!key || key.startsWith('__') || raw?.kind === 'action' || seen.has(key)) continue;
    seen.add(key);
    const label = String(raw?.label ?? raw?.left ?? key).trim() || key;
    out.push({ key, label });
  }
  return out;
}

function buildInitialState(items, selectedFields) {
  const selectedList = Array.isArray(selectedFields) ? selectedFields.map((field) => String(field || '').trim()).filter(Boolean) : [];
  const selectedSet = new Set(selectedList);
  const itemByKey = new Map(items.map((item) => [item.key, item]));
  const out = [];
  const seen = new Set();

  for (const key of selectedList) {
    const item = itemByKey.get(key);
    if (!item || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...item, enabled: true });
  }
  for (const item of items) {
    if (seen.has(item.key)) continue;
    out.push({ ...item, enabled: selectedSet.has(item.key) });
  }
  return out;
}

function getLayoutValue(layout, slotKey, fallbackLayout) {
  const slot = String(slotKey || '').trim();
  if (!slot) return '';
  if (layout && typeof layout === 'object' && Object.prototype.hasOwnProperty.call(layout, slot)) {
    return String(layout[slot] || '').trim();
  }
  if (fallbackLayout && typeof fallbackLayout === 'object' && Object.prototype.hasOwnProperty.call(fallbackLayout, slot)) {
    return String(fallbackLayout[slot] || '').trim();
  }
  return '';
}

export function openGenericFlatCardConfigDialog({
  title = 'Generic Card Settings',
  fields = [],
  selectedFields = [],
  layoutSlots = [],
  selectedLayout = {},
  defaultLayout = {},
} = {}) {
  const items = normalizeFieldItems(fields);
  const slots = Array.isArray(layoutSlots)
    ? layoutSlots.map((raw) => ({
      key: String(raw?.key || '').trim(),
      label: String(raw?.label || raw?.key || '').trim(),
      allowEmpty: raw?.allowEmpty !== false,
    })).filter((item) => item.key)
    : [];
  const mount = document.body || document.documentElement;
  if (!mount) return Promise.resolve(null);

  return new Promise((resolve) => {
    let state = buildInitialState(items, selectedFields);
    let layoutState = slots.map((slot) => ({
      ...slot,
      value: getLayoutValue(selectedLayout, slot.key, defaultLayout),
    }));
    const isLayoutMode = slots.length > 0;
    let isJsonMode = false;

    const backdrop = el('div', { className: 'kanji-study-card-config-backdrop' });
    const dialog = el('div', {
      className: 'kanji-study-card-config-dialog card',
      attrs: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': String(title || 'Generic Card Settings'),
      },
    });
    dialog.tabIndex = -1;

    const titleEl = el('h2', { text: String(title || 'Generic Card Settings') });
    const subtitleEl = el('p', {
      className: 'hint',
      text: isLayoutMode
        ? 'Choose which collection field appears in each fixed position on the card.'
        : 'Choose which fields appear on the generic card and arrange their top-to-bottom order.',
    });
    const summaryEl = el('div', { className: 'kanji-study-card-config-summary' });
    const jsonBtn = el('button', {
      className: 'btn small table-card-settings-btn kanji-study-card-config-json-btn',
      text: 'JSON',
      attrs: {
        type: 'button',
        title: 'Toggle JSON viewer for this card config',
      },
    });
    const headerActions = el('div', {
      className: 'kanji-study-card-config-header-actions',
      children: [jsonBtn],
    });
    const header = el('div', {
      className: 'kanji-study-card-config-header',
      children: [el('div', { children: [titleEl, subtitleEl, summaryEl] }), headerActions],
    });

    const list = el('div', { className: 'kanji-study-card-config-list' });
    const body = el('div', { className: 'kanji-study-card-config-body', children: [list] });

    const resetBtn = el('button', { className: 'btn', text: 'Reset', attrs: { type: 'button' } });
    const cancelBtn = el('button', { className: 'btn', text: 'Cancel', attrs: { type: 'button' } });
    const saveBtn = el('button', { className: 'btn primary', text: 'Save', attrs: { type: 'button' } });
    const footer = el('div', {
      className: 'kanji-study-card-config-footer',
      children: [
        el('div', { className: 'kanji-study-card-config-footer-left', children: [resetBtn] }),
        el('div', { className: 'kanji-study-card-config-footer-right', children: [cancelBtn, saveBtn] }),
      ],
    });

    dialog.append(header, body, footer);

    function moveItem(fromIndex, toIndex) {
      if (fromIndex === toIndex) return;
      if (fromIndex < 0 || fromIndex >= state.length) return;
      if (toIndex < 0 || toIndex >= state.length) return;
      const next = state.slice();
      const [item] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, item);
      state = next;
      render();
    }

    function getSelectedFieldOrder() {
      return state.filter((item) => item.enabled).map((item) => item.key);
    }

    function getSelectedLayout() {
      const out = {};
      layoutState.forEach((item) => {
        out[item.key] = String(item.value || '').trim();
      });
      return out;
    }

    function getCurrentConfigSnapshot() {
      return isLayoutMode
        ? { layout: getSelectedLayout() }
        : { fields: getSelectedFieldOrder() };
    }

    function render() {
      jsonBtn.classList.toggle('is-active', isJsonMode);
      jsonBtn.setAttribute('aria-pressed', isJsonMode ? 'true' : 'false');
      if (isLayoutMode) {
        const mappedCount = layoutState.filter((item) => item.value).length;
        summaryEl.textContent = `${mappedCount} mapped of ${layoutState.length}`;
      } else {
        const visibleCount = state.filter((item) => item.enabled).length;
        summaryEl.textContent = `${visibleCount} visible of ${state.length}`;
      }
      list.innerHTML = '';

      if (isJsonMode) {
        const viewer = createJsonViewer(getCurrentConfigSnapshot(), {
          expanded: true,
          maxChars: 200000,
          maxLines: 10000,
          previewLen: 400,
        });
        viewer.classList.add('kanji-study-card-config-json-viewer');
        list.append(viewer);
        return;
      }

      if (isLayoutMode && !layoutState.length) {
        list.append(el('p', { className: 'hint kanji-study-card-config-empty', text: 'No card positions are available for this card.' }));
        return;
      }
      if (!items.length) {
        list.append(el('p', { className: 'hint kanji-study-card-config-empty', text: 'No schema fields are available for this collection.' }));
        return;
      }

      if (isLayoutMode) {
        layoutState.forEach((item, index) => {
          const dropdown = createDropdown({
            items: [
              ...(item.allowEmpty ? [{ value: '', label: 'None' }] : []),
              ...items.map((fieldItem) => ({
                value: fieldItem.key,
                label: fieldItem.label,
                right: fieldItem.key,
              })),
            ],
            value: String(item.value || '').trim(),
            className: 'kanji-study-card-config-select',
            closeOverlaysOnOpen: false,
            onChange: (nextValue) => {
              layoutState[index] = { ...item, value: String(nextValue || '').trim() };
              render();
            },
          });

          list.append(el('div', {
            className: 'kanji-study-card-config-item',
            children: [
              el('div', {
                className: 'kanji-study-card-config-item-copy',
                children: [
                  el('div', { className: 'kanji-study-card-config-item-label', text: item.label }),
                  el('div', { className: 'kanji-study-card-config-item-key hint', text: item.key }),
                ],
              }),
              el('div', {
                className: 'kanji-study-card-config-item-controls',
                children: [dropdown],
              }),
            ],
          }));
        });
        return;
      }

      state.forEach((item, index) => {
        const checkbox = el('input', {
          attrs: {
            type: 'checkbox',
            'aria-label': `Show ${item.label}`,
          },
        });
        checkbox.checked = !!item.enabled;
        checkbox.addEventListener('change', () => {
          state[index] = { ...item, enabled: !!checkbox.checked };
          render();
        });

        const labelWrap = el('label', {
          className: 'kanji-study-card-config-item-main',
          children: [
            checkbox,
            el('div', {
              className: 'kanji-study-card-config-item-copy',
              children: [
                el('div', { className: 'kanji-study-card-config-item-label', text: item.label }),
                el('div', { className: 'kanji-study-card-config-item-key hint', text: item.key }),
              ],
            }),
          ],
        });

        const upBtn = el('button', {
          className: 'icon-button kanji-study-card-config-move',
          text: '↑',
          attrs: { type: 'button', 'aria-label': `Move ${item.label} up` },
        });
        upBtn.disabled = index === 0;
        upBtn.addEventListener('click', () => moveItem(index, index - 1));

        const downBtn = el('button', {
          className: 'icon-button kanji-study-card-config-move',
          text: '↓',
          attrs: { type: 'button', 'aria-label': `Move ${item.label} down` },
        });
        downBtn.disabled = index === state.length - 1;
        downBtn.addEventListener('click', () => moveItem(index, index + 1));

        list.append(el('div', {
          className: 'kanji-study-card-config-item',
          children: [
            labelWrap,
            el('div', {
              className: 'kanji-study-card-config-item-controls',
              children: [upBtn, downBtn],
            }),
          ],
        }));
      });
    }

    function cleanup(result) {
      document.removeEventListener('keydown', onKeyDown, true);
      backdrop.removeEventListener('click', onBackdropClick);
      try { dialog.remove(); } catch (e) {}
      try { backdrop.remove(); } catch (e) {}
      resolve(result);
    }

    function onBackdropClick(event) {
      if (event.target !== backdrop) return;
      cleanup(null);
    }

    function onKeyDown(event) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      cleanup(null);
    }

    jsonBtn.addEventListener('click', () => {
      isJsonMode = !isJsonMode;
      render();
    });
    resetBtn.addEventListener('click', () => {
      if (isLayoutMode) {
        layoutState = slots.map((slot) => ({
          ...slot,
          value: String(defaultLayout?.[slot.key] || '').trim(),
        }));
      }
      else state = items.map((item) => ({ ...item, enabled: true }));
      render();
    });
    cancelBtn.addEventListener('click', () => cleanup(null));
    saveBtn.addEventListener('click', () => cleanup(
      isLayoutMode
        ? { layout: getSelectedLayout() }
        : { fields: getSelectedFieldOrder() }
    ));

    backdrop.append(dialog);
    mount.append(backdrop);
    backdrop.addEventListener('click', onBackdropClick);
    document.addEventListener('keydown', onKeyDown, true);

    render();
    setTimeout(() => {
      try { dialog.focus(); } catch (e) {}
    }, 0);
  });
}

export default { openGenericFlatCardConfigDialog };
