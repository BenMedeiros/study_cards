import { el } from '../ui.js';

function asString(v) {
  return (v == null) ? '' : String(v);
}

function inferNamespace(raw) {
  if (!raw || typeof raw !== 'object') return 'unknown';
  const id = (raw.id || '').toLowerCase();
  const fn = (raw.fnName || '').toLowerCase();
  const text = (raw.text || '').toLowerCase();

  // heuristics
  if (fn.includes('kanji') || id.includes('kanji') || text.includes('kanji') || fn.includes('study')) return 'app';
  if (fn.includes('toggle') || fn.includes('learned') || fn.includes('focus') || id.includes('progress') || id.includes('kanji')) return 'collection';
  if (fn.includes('speak') || fn.includes('sound') || id.includes('speak') || text.includes('sound')) return 'entry';
  if (fn.startsWith('show') || id.startsWith('show') || text.startsWith('show')) return 'app';
  return raw.namespace || 'unknown';
}

export function openViewFooterCustomButtonDialog({
  availableActions = [],
} = {}) {
  return new Promise((resolve) => {
    const actionById = new Map();
    const actionList = [];
    for (const raw of (Array.isArray(availableActions) ? availableActions : [])) {
      if (!raw || typeof raw !== 'object') continue;
      const id = asString(raw.id).trim();
      if (!id || actionById.has(id)) continue;
      // Do not include state-specific actions (e.g. reveal/hide states)
      const stateVal = asString(raw.state);
      if (stateVal) continue;

        // Derive a human-friendly "action-field" for the UI. For sound actions
        // prefer `entry.<field>` (e.g. `entry.reading`, `entry.kanji`). Fall back
        // to the supplied namespace or an inferred namespace otherwise.
        let actionField = '';
        const rawNs = asString(raw.namespace);
      const rawActionField = asString(raw.actionField);
      if (rawActionField) {
        actionField = rawActionField;
      } else if (id.toLowerCase().startsWith('sound.')) {
        const parts = id.split('.');
        const field = parts[1] || '';
        actionField = field ? `entry.${field}` : 'entry';
      } else if (id === 'prev' || id === 'next') {
        // navigation controls belong to the kanji study app
        actionField = 'app.kanjiStudyCardView';
      } else if (/^(learned|practice)$/i.test(id) || /^toggle/i.test(id) || /^setstate/i.test(id) || /^togglekanji/i.test(id)) {
        // learned/practice/toggle/setState actions map to the study progress manager
        actionField = 'manager.studyProgress';
      } else if (rawNs) {
        actionField = rawNs;
      } else {
        actionField = inferNamespace(raw);
      }

        const item = {
          id,
          // prefer fnName for display; actionDefinitions no longer provide `text`
          text: asString(raw.fnName) || id,
          controlKey: asString(raw.controlKey),
          fnName: asString(raw.fnName),
          actionField,
        };
      actionById.set(id, item);
      actionList.push(item);
    }

      // Sort available actions: put all `sound.*` actions together at the top
      // (sorted by field), then the rest alphabetically by text.
      actionList.sort((a, b) => {
        const aId = String(a.id || '');
        const bId = String(b.id || '');
        const aIsSound = aId.startsWith('sound.');
        const bIsSound = bId.startsWith('sound.');
        if (aIsSound !== bIsSound) return aIsSound ? -1 : 1;
        const aIsApp = String(a.actionField || '').startsWith('app.');
        const bIsApp = String(b.actionField || '').startsWith('app.');
        if (aIsApp !== bIsApp) return aIsApp ? -1 : 1;
        const aIsManager = String(a.actionField || '').startsWith('manager.');
        const bIsManager = String(b.actionField || '').startsWith('manager.');
        if (aIsManager !== bIsManager) return aIsManager ? -1 : 1;
        // within each category sort by id (sound) or text otherwise
        if (aIsSound && bIsSound) return aId.localeCompare(bId);
        return String(a.text || '').localeCompare(String(b.text || ''));
      });

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

    const title = el('div', { className: 'view-footer-hotkey-title', text: 'Add Action to Custom Button' });

    const availableTitle = el('div', { className: 'hint', text: 'Available Actions' });
    const availableListEl = el('div', { className: 'view-footer-custom-available-list' });

    const actions = el('div', { className: 'view-footer-hotkey-actions' });
    const cancelBtn = el('button', { className: 'btn small', text: 'Cancel' });
    cancelBtn.type = 'button';

    actions.append(cancelBtn);
    dialog.append(title, availableTitle, availableListEl, actions);

    const mount = document.getElementById('shell-root') || document.getElementById('app') || document.body;
    const prevFocus = document.activeElement;
    mount.append(backdrop, dialog);
    try { console.debug('[dialog] open viewFooterCustomButtonDialog', { availableCount: actionList.length }); } catch (e) {}

    function renderAvailable() {
      availableListEl.innerHTML = '';
      // header row for columns: Function | Field
      const header = el('div', { className: 'view-footer-custom-available-header' });
      header.append(
        el('div', { className: 'view-footer-custom-action-label header', text: 'Function' }),
        el('div', { className: 'view-footer-action-field header', text: 'Field' })
      );
      availableListEl.appendChild(header);
      for (const action of actionList) {
        const row = el('div', { className: 'view-footer-custom-available-row' });
          const left = el('div', { className: 'view-footer-custom-action-label', text: action.fnName || action.id });
          const ns = el('div', { className: 'view-footer-action-field', text: action.actionField });
        const selectBtn = el('button', { className: 'btn small', text: 'Select' });
        selectBtn.type = 'button';
        selectBtn.addEventListener('click', () => {
          close({ actionId: action.id });
        });
        row.append(left, ns, selectBtn);
        availableListEl.appendChild(row);
      }
      if (!actionList.length) {
        availableListEl.appendChild(el('div', { className: 'hint', text: 'No available actions.' }));
      }
    }

    let closed = false;
    function close(result = null) {
      if (closed) return;
      closed = true;
      try { console.debug('[dialog] close viewFooterCustomButtonDialog', { result }); } catch (e) {}
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
    backdrop.addEventListener('click', () => close(null));

    renderAvailable();

    document.addEventListener('keydown', onKeyDown, true);
    try { dialog.focus(); } catch (e) {}
  });
}
