import { el, safeId } from './ui.js';

function asString(v) {
  return (v == null) ? '' : String(v);
}

function deepClone(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch (e) { return value; }
}

function normalizeActionSteps(raw = []) {
  const out = [];
  for (const step of (Array.isArray(raw) ? raw : [])) {
    if (!step || typeof step !== 'object') continue;
    const actionId = asString(step.actionId).trim();
    if (!actionId) continue;
    const delayNum = Number(step.delayMs);
    const delayMs = Number.isFinite(delayNum) ? Math.max(0, Math.round(delayNum)) : 0;
    out.push({ actionId, delayMs });
  }
  return out;
}

export function openViewFooterCustomButtonDialog({
  initialButton = null,
  availableActions = [],
  captureHotkey = null,
} = {}) {
  return new Promise((resolve) => {
    const source = (initialButton && typeof initialButton === 'object') ? deepClone(initialButton) : {};
    const state = {
      id: asString(source.id).trim() || `custom-${safeId(Date.now().toString(36)) || Date.now().toString(36)}`,
      icon: asString(source.icon),
      text: asString(source.text) || 'Custom',
      caption: asString(source.caption),
      shortcut: asString(source.shortcut),
      actions: normalizeActionSteps(source.actions),
    };

    const actionById = new Map();
    const actionList = [];
    for (const raw of (Array.isArray(availableActions) ? availableActions : [])) {
      if (!raw || typeof raw !== 'object') continue;
      const id = asString(raw.id).trim();
      if (!id || actionById.has(id)) continue;
      const item = {
        id,
        text: asString(raw.text) || id,
        controlKey: asString(raw.controlKey),
        state: asString(raw.state),
        fnName: asString(raw.fnName),
      };
      actionById.set(id, item);
      actionList.push(item);
    }

    const backdrop = el('div', { className: 'view-footer-hotkey-backdrop' });
    const dialog = el('div', {
      className: 'view-footer-hotkey-dialog view-footer-custom-dialog',
      attrs: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'Custom footer button',
      }
    });
    dialog.tabIndex = -1;

    const title = el('div', { className: 'view-footer-hotkey-title', text: initialButton ? 'Edit Custom Button' : 'New Custom Button' });
    const topGrid = el('div', { className: 'view-footer-custom-top-grid' });

    const iconInput = el('input', { attrs: { type: 'text', maxlength: '8', placeholder: 'Icon' } });
    const textInput = el('input', { attrs: { type: 'text', maxlength: '40', placeholder: 'Name' } });
    const hotkeyBtn = el('button', { className: 'btn small', text: state.caption || 'Set hotkey' });
    hotkeyBtn.type = 'button';

    iconInput.value = state.icon;
    textInput.value = state.text;

    topGrid.append(
      el('div', { className: 'hint', text: 'Icon' }),
      iconInput,
      el('div', { className: 'hint', text: 'Name' }),
      textInput,
      el('div', { className: 'hint', text: 'Hotkey' }),
      hotkeyBtn,
    );

    const selectedTitle = el('div', { className: 'hint', text: 'Button Actions' });
    const selectedList = el('div', { className: 'view-footer-custom-selected-list' });

    const availableTitle = el('div', { className: 'hint', text: 'Available Actions' });
    const availableListEl = el('div', { className: 'view-footer-custom-available-list' });

    const actions = el('div', { className: 'view-footer-hotkey-actions' });
    const cancelBtn = el('button', { className: 'btn small', text: 'Cancel' });
    cancelBtn.type = 'button';
    const saveBtn = el('button', { className: 'btn small', text: 'Save' });
    saveBtn.type = 'button';

    actions.append(cancelBtn, saveBtn);
    dialog.append(title, topGrid, selectedTitle, selectedList, availableTitle, availableListEl, actions);

    const mount = document.getElementById('shell-root') || document.getElementById('app') || document.body;
    const prevFocus = document.activeElement;
    mount.append(backdrop, dialog);

    function stepLabel(step) {
      const info = actionById.get(step.actionId);
      if (!info) return step.actionId;
      return `${info.text}${info.state ? ` (${info.state})` : ''}`;
    }

    function renderSelected() {
      selectedList.innerHTML = '';
      if (!state.actions.length) {
        selectedList.appendChild(el('div', { className: 'hint', text: 'No actions selected yet.' }));
        return;
      }

      state.actions.forEach((step, index) => {
        const row = el('div', { className: 'view-footer-custom-selected-row' });
        const label = el('div', { className: 'view-footer-custom-action-label', text: stepLabel(step) });

        const minusDelay = el('button', { className: 'btn small', text: '-' });
        minusDelay.type = 'button';
        const delayValue = el('div', { className: 'view-footer-custom-delay-value', text: `${(step.delayMs / 1000).toFixed(1)}s` });
        const plusDelay = el('button', { className: 'btn small', text: '+' });
        plusDelay.type = 'button';

        const upBtn = el('button', { className: 'btn small', text: '↑' });
        upBtn.type = 'button';
        const downBtn = el('button', { className: 'btn small', text: '↓' });
        downBtn.type = 'button';
        const removeBtn = el('button', { className: 'btn small danger', text: 'Remove' });
        removeBtn.type = 'button';

        minusDelay.addEventListener('click', () => {
          step.delayMs = Math.max(0, step.delayMs - 500);
          renderSelected();
        });

        plusDelay.addEventListener('click', () => {
          step.delayMs += 500;
          renderSelected();
        });

        upBtn.addEventListener('click', () => {
          if (index <= 0) return;
          const arr = state.actions.slice();
          const tmp = arr[index - 1];
          arr[index - 1] = arr[index];
          arr[index] = tmp;
          state.actions = arr;
          renderSelected();
        });

        downBtn.addEventListener('click', () => {
          if (index >= state.actions.length - 1) return;
          const arr = state.actions.slice();
          const tmp = arr[index + 1];
          arr[index + 1] = arr[index];
          arr[index] = tmp;
          state.actions = arr;
          renderSelected();
        });

        removeBtn.addEventListener('click', () => {
          state.actions = state.actions.filter((_, i) => i !== index);
          renderSelected();
        });

        row.append(label, minusDelay, delayValue, plusDelay, upBtn, downBtn, removeBtn);
        selectedList.appendChild(row);
      });
    }

    function renderAvailable() {
      availableListEl.innerHTML = '';
      for (const action of actionList) {
        const row = el('div', { className: 'view-footer-custom-available-row' });
        const left = el('div', { className: 'view-footer-custom-action-label', text: `${action.text}${action.state ? ` (${action.state})` : ''}` });
        const fn = el('div', { className: 'view-footer-action-fn', text: action.fnName || action.id });
        const addBtn = el('button', { className: 'btn small', text: 'Add' });
        addBtn.type = 'button';
        addBtn.addEventListener('click', () => {
          state.actions.push({ actionId: action.id, delayMs: 0 });
          renderSelected();
        });
        row.append(left, fn, addBtn);
        availableListEl.appendChild(row);
      }
    }

    iconInput.addEventListener('input', () => {
      state.icon = asString(iconInput.value);
    });

    textInput.addEventListener('input', () => {
      state.text = asString(textInput.value);
    });

    hotkeyBtn.addEventListener('click', async () => {
      if (typeof captureHotkey !== 'function') return;
      const result = await captureHotkey({ currentShortcut: state.shortcut, skipToken: `__custom:${state.id}` });
      if (!result) return;
      state.shortcut = asString(result.shortcut);
      state.caption = asString(result.caption);
      hotkeyBtn.textContent = state.caption || 'Set hotkey';
    });

    let closed = false;
    function close(result = null) {
      if (closed) return;
      closed = true;
      try { document.removeEventListener('keydown', onKeyDown, true); } catch (e) {}
      try { if (dialog.parentNode) dialog.parentNode.removeChild(dialog); } catch (e) {}
      try { if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop); } catch (e) {}
      try { if (prevFocus && prevFocus.focus) prevFocus.focus(); } catch (e) {}
      resolve(result);
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close(null);
      }
    }

    cancelBtn.addEventListener('click', () => close(null));
    saveBtn.addEventListener('click', () => {
      close({
        id: state.id,
        icon: asString(state.icon).trim(),
        text: asString(state.text).trim() || 'Custom',
        caption: asString(state.caption),
        shortcut: asString(state.shortcut),
        actions: normalizeActionSteps(state.actions),
      });
    });
    backdrop.addEventListener('click', () => close(null));

    renderSelected();
    renderAvailable();

    document.addEventListener('keydown', onKeyDown, true);
    try { dialog.focus(); } catch (e) {}
  });
}
