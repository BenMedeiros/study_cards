import { el } from '../../utils/browser/ui.js';
import { createDropdown } from '../shared/dropdown.js';

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

function resolveGroupedActionMeta(action) {
  const fnName = asString(action?.fnName).trim();
  const actionField = asString(action?.actionField).trim();
  const actionId = asString(action?.id).trim();

  if (fnName === 'entry.speakField') {
    const fieldKey = actionField.startsWith('entry.') ? actionField.slice('entry.'.length) : '';
    const normalized = fieldKey || asString(action?.id).replace(/^sound\./, '');
    return {
      groupKey: 'entry.speakField',
      groupFnName: 'entry.speakField',
      optionLabel: normalized ? `entry.${normalized}` : asString(action?.id),
      optionSort: normalized || asString(action?.id),
    };
  }

  const entryFieldsMatch = fnName.match(/^app\.kanjiStudyCardView\.entryFields\.(setOff|setOn|toggle)\[(.+)\]$/);
  if (entryFieldsMatch) {
    const op = asString(entryFieldsMatch[1]).trim();
    const fieldKey = asString(entryFieldsMatch[2]).trim();
    return {
      groupKey: `app.kanjiStudyCardView.entryFields.${op}`,
      groupFnName: `app.kanjiStudyCardView.entryFields.${op}`,
      optionLabel: fieldKey ? `entry.${fieldKey}` : asString(action?.id),
      optionSort: fieldKey || asString(action?.id),
    };
  }

  const linkMatch = fnName.match(/^link\.open\[(.+)\]$/);
  if (linkMatch) {
    const linkKey = asString(linkMatch[1]).trim();
    return {
      groupKey: 'link.open',
      groupFnName: 'link.open',
      optionLabel: linkKey || asString(action?.id),
      optionSort: linkKey || asString(action?.id),
    };
  }

  if (fnName === 'action.delay') {
    return {
      groupKey: 'action.delay',
      groupFnName: 'action.delay',
      optionLabel: actionField || actionId,
      optionSort: actionField || actionId,
    };
  }

  if (
    fnName === 'manager.studyProgress.setState'
    || ['setStateFocus', 'setStateLearned', 'setStateNull'].includes(actionId)
  ) {
    return {
      groupKey: 'manager.studyProgress.setState',
      groupFnName: 'manager.studyProgress.setState',
      optionLabel: actionField || actionId,
      optionSort: actionField || actionId,
    };
  }

  if (
    fnName === 'manager.studyProgress.toggleState'
    || fnName === 'manager.studyProgress.toggleKanjiFocus'
    || fnName === 'manager.studyProgress.toggleKanjiLearned'
    || ['practice', 'learned'].includes(actionId)
  ) {
    const toggleKey = actionId === 'practice' ? 'focus'
      : actionId === 'learned' ? 'learned'
      : (fnName.endsWith('Focus') ? 'focus' : 'learned');
    return {
      groupKey: 'manager.studyProgress.toggleState',
      groupFnName: 'manager.studyProgress.toggleState',
      optionLabel: toggleKey,
      optionSort: toggleKey,
    };
  }

  return null;
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

      // Derive a human-friendly "action-field" for the UI.
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
        actionField = 'app.kanjiStudyCardView';
      } else if (/^action\.delay\./i.test(id)) {
        actionField = 'sequence';
      } else if (/^(learned|practice)$/i.test(id) || /^toggle/i.test(id) || /^setstate/i.test(id) || /^togglekanji/i.test(id)) {
        actionField = 'manager.studyProgress';
      } else if (rawNs) {
        actionField = rawNs;
      } else {
        actionField = inferNamespace(raw);
      }

      const item = {
        id,
        text: asString(raw.fnName) || id,
        controlKey: asString(raw.controlKey),
        fnName: asString(raw.fnName),
        actionField,
      };
      actionById.set(id, item);
      actionList.push(item);
    }

    // Keep existing broad ordering behavior before grouping.
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
      if (aIsSound && bIsSound) return aId.localeCompare(bId);
      return String(a.text || '').localeCompare(String(b.text || ''));
    });

    // Collapse a few action families into one row + dropdown selector.
    const groupedByKey = new Map();
    const displayRows = [];
    for (const action of actionList) {
      const grouped = resolveGroupedActionMeta(action);
      if (!grouped) {
        displayRows.push({ type: 'single', action });
        continue;
      }

      let row = groupedByKey.get(grouped.groupKey);
      if (!row) {
        row = {
          type: 'group',
          key: grouped.groupKey,
          fnName: grouped.groupFnName,
          multi: ![
            'action.delay',
            'manager.studyProgress.setState',
            'manager.studyProgress.toggleState',
          ].includes(grouped.groupKey),
          options: [],
        };
        groupedByKey.set(grouped.groupKey, row);
        displayRows.push(row);
      }

      row.options.push({
        actionId: action.id,
        optionLabel: grouped.optionLabel,
        optionSort: grouped.optionSort,
      });
    }

    for (const row of displayRows) {
      if (row.type !== 'group') continue;
      row.options.sort((a, b) => {
        if (row.key === 'action.delay') {
          const aNum = Number(String(a.optionSort || '').replace(/[^0-9.]/g, '')) || 0;
          const bNum = Number(String(b.optionSort || '').replace(/[^0-9.]/g, '')) || 0;
          return aNum - bNum;
        }
        return String(a.optionSort || '').localeCompare(String(b.optionSort || ''));
      });
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

    const title = el('div', { className: 'view-footer-hotkey-title', text: 'Add Action to Custom Button' });

    const availableTitle = el('div', { className: 'hint', text: 'Available Actions' });
    const availableListEl = el('div', { className: 'view-footer-custom-available-list' });
    let validationMessage = '';

    function setValidationMessage(message = '') {
      validationMessage = asString(message).trim();
      availableTitle.textContent = validationMessage || 'Available Actions';
      availableTitle.style.color = validationMessage ? 'var(--danger, #dc2626)' : '';
    }

    const actions = el('div', { className: 'view-footer-hotkey-actions' });
    const cancelBtn = el('button', { className: 'btn small', text: 'Cancel' });
    cancelBtn.type = 'button';

    actions.append(cancelBtn);
    dialog.append(title, availableTitle, availableListEl, actions);

    const mount = document.getElementById('shell-root') || document.getElementById('app') || document.body;
    const prevFocus = document.activeElement;
    mount.append(backdrop, dialog);
    try { console.debug('[dialog] open viewFooterCustomButtonDialog', { availableCount: actionList.length, displayCount: displayRows.length }); } catch (e) {}

    function renderAvailable() {
      availableListEl.innerHTML = '';
      const header = el('div', { className: 'view-footer-custom-available-header' });
      header.append(
        el('div', { className: 'view-footer-custom-action-label header', text: 'Function' }),
        el('div', { className: 'view-footer-action-field header', text: 'Field' })
      );
      availableListEl.appendChild(header);

      for (const rowData of displayRows) {
        const row = el('div', { className: 'view-footer-custom-available-row' });

        if (rowData.type === 'group') {
          const left = el('div', { className: 'view-footer-custom-action-label', text: rowData.fnName });
          const fieldCell = el('div', { className: 'view-footer-action-field' });
          const groupedItems = rowData.options
            .filter(opt => {
              const actionId = asString(opt?.actionId).trim();
              const optionLabel = asString(opt?.optionLabel).trim();
              return !actionId.includes('__toggle__') && !optionLabel.includes('__toggle__');
            })
            .map(opt => ({
              value: asString(opt.actionId),
              label: asString(opt.optionLabel),
            }));
          if (!groupedItems.length) continue;
          const initialSingleValue = rowData.multi === false ? asString(groupedItems[0]?.value).trim() : '';
          const dropdown = createDropdown({
            items: groupedItems,
            value: initialSingleValue,
            values: [],
            multi: rowData.multi !== false,
            commitOnClose: false,
            includeAllNone: true,
            className: 'view-footer-custom-group-dropdown',
            closeOverlaysOnOpen: false,
            portalZIndex: 1400,
            onChange: () => {
              setValidationMessage('');
              syncSelectButton();
            },
          });
          fieldCell.appendChild(dropdown);

          const selectBtn = el('button', { className: 'btn small', text: 'Select' });
          selectBtn.type = 'button';
          const getChosen = () => (
            rowData.multi === false
              ? [asString(dropdown?.getValue ? dropdown.getValue() : '').trim()].filter(Boolean)
              : (dropdown?.getValues ? dropdown.getValues() : [])
                .map(value => asString(value).trim())
                .filter(Boolean)
          );
          const syncSelectButton = () => {
            const chosen = getChosen();
            selectBtn.disabled = chosen.length === 0;
          };
          selectBtn.addEventListener('click', () => {
            const chosen = getChosen();
            if (!chosen.length) {
              setValidationMessage('Select an action before adding it.');
              syncSelectButton();
              return;
            }
            setValidationMessage('');
            if (rowData.multi === false) {
              close({ actionId: chosen[0] });
              return;
            }
            close({ actionIds: chosen });
          });
          syncSelectButton();

          row.append(left, fieldCell, selectBtn);
          availableListEl.appendChild(row);
          continue;
        }

        const action = rowData.action;
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

      if (!displayRows.length) {
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


