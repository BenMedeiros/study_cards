import { createDropdown } from '../utils/dropdown.js';

function safeParseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function jsonStable(value) {
  // Good enough for our small settings objects.
  return JSON.stringify(value ?? {});
}

function canonicalizeSettingsData(data) {
  // Canonicalize for stable "dirty" comparisons.
  // Today our settings are small and shallow; keep it simple but consistent.
  const cloned = deepClone(data ?? {});

  const visit = (node) => {
    if (!node) return;
    if (Array.isArray(node)) {
      // If it's a simple list of primitives, sort for stability.
      const allPrimitive = node.every((v) => v == null || ['string', 'number', 'boolean'].includes(typeof v));
      if (allPrimitive) {
        node.sort((a, b) => String(a ?? '').localeCompare(String(b ?? '')));
      } else {
        for (const v of node) visit(v);
      }
      return;
    }
    if (typeof node === 'object') {
      for (const k of Object.keys(node)) visit(node[k]);
    }
  };

  visit(cloned);
  return cloned;
}

function getAppLabel(appId) {
  if (appId === 'flashcards') return 'Flashcards';
  if (appId === 'crossword') return 'Crossword';
  return appId;
}

export function renderSettings({ store, onNavigate, route }) {
  const el = document.createElement('div');
  el.className = 'card';
  el.id = 'settings-root';

  const activeCollection = store.getActiveCollection();
  const appId = route?.query?.get('app') || (route?.query?.get('tool') || 'flashcards');

  if (!activeCollection) {
    el.innerHTML = '<h2>Settings</h2><p class="hint">No active collection.</p>';
    return el;
  }

  const header = document.createElement('div');
  header.className = 'row';
  header.id = 'settings-header';

  const title = document.createElement('h2');
  title.id = 'settings-title';
  title.style.margin = '0';
  title.textContent = `Settings — ${activeCollection.metadata.name}`;

  const back = document.createElement('button');
  back.className = 'button';
  back.id = 'settings-back';
  back.name = 'back';
  back.textContent = 'Back';
  back.addEventListener('click', () => onNavigate('/'));

  header.append(title, back);

  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.id = 'settings-hint';
  hint.style.marginTop = '8px';
  hint.textContent = 'Settings are per-collection and per-app (game/tool).';

  const body = document.createElement('div');
  body.id = 'settings-body';
  body.style.marginTop = '12px';

  const controls = document.createElement('div');
  controls.className = 'row';
  controls.id = 'settings-controls';

  const appLabel = document.createElement('span');
  appLabel.className = 'hint';
  appLabel.id = 'settings-app-label';
  appLabel.textContent = 'App:';

  const appSelect = createDropdown({
    items: ['flashcards', 'crossword'].map(id => ({ value: id, label: getAppLabel(id) })),
    value: appId,
    onChange: (value) => {
      onNavigate(`/settings?app=${encodeURIComponent(value)}`);
    }
  });
  appSelect.id = 'settings-app-select';

  const presetLabel = document.createElement('span');
  presetLabel.className = 'hint';
  presetLabel.id = 'settings-mode-label';
  presetLabel.textContent = 'Mode:';

  const presets = store.getAppSettingsPresets(appId);
  const activePresetId = store.getActiveAppSettingsPresetId(appId);
  
  const presetSelect = createDropdown({
    items: presets.map(p => ({ value: p.id, label: p.name })),
    value: activePresetId,
    onChange: async (value) => {
      await store.setActiveAppSettingsPresetId(appId, value);
      renderEditor();
    }
  });
  presetSelect.id = 'settings-mode-select';

  const toggleJson = document.createElement('button');
  toggleJson.className = 'button';
  toggleJson.id = 'settings-toggle-json';
  toggleJson.name = 'toggleJson';
  toggleJson.textContent = 'Edit JSON';

  const newBtn = document.createElement('button');
  newBtn.className = 'button';
  newBtn.id = 'settings-new';
  newBtn.name = 'new';
  newBtn.textContent = 'New';

  controls.append(appLabel, appSelect, presetLabel, presetSelect, newBtn, toggleJson);

  const editorWrap = document.createElement('div');
  editorWrap.id = 'settings-editor-wrap';
  editorWrap.style.marginTop = '12px';

  const preset = store.getActiveAppSettingsPreset(appId);
  let jsonMode = false;
  let initialSnapshot = null;
  let draftData = null;
  let jsonTextSnapshot = '';

  const renderEditor = () => {
    editorWrap.innerHTML = '';

    const current = store.getActiveAppSettingsPreset(appId);
    if (!current) {
      editorWrap.innerHTML = '<p class="hint">No settings mode found.</p>';
      return;
    }

    // Disable switching app/mode while editing JSON to avoid mixed edits.
    appSelect.disabled = jsonMode;
    presetSelect.disabled = jsonMode;

    // Reset draft when switching modes
    if (!initialSnapshot || initialSnapshot.id !== current.id) {
      initialSnapshot = { id: current.id, name: current.name, data: canonicalizeSettingsData(current.data ?? {}) };
      draftData = deepClone(initialSnapshot.data);
      jsonTextSnapshot = prettyJson({ id: current.id, name: current.name, data: deepClone(current.data ?? {}) });
    }

    const top = document.createElement('div');
    top.className = 'row';
    top.id = 'settings-editor-top';

    const statusBadge = document.createElement('div');
    statusBadge.className = 'badge';
    statusBadge.id = 'settings-status';

    const renameBtn = document.createElement('button');
    renameBtn.className = 'button';
    renameBtn.id = 'settings-rename';
    renameBtn.name = 'rename';
    renameBtn.textContent = 'Rename';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'button';
    deleteBtn.id = 'settings-delete';
    deleteBtn.name = 'delete';
    deleteBtn.textContent = 'Delete';

    const resetBtn = document.createElement('button');
    resetBtn.className = 'button';
    resetBtn.id = 'settings-reset';
    resetBtn.name = 'reset';
    resetBtn.textContent = 'Reset';
    resetBtn.disabled = true;

    const saveBtn = document.createElement('button');
    saveBtn.className = 'button';
    saveBtn.id = 'settings-save';
    saveBtn.name = 'save';
    saveBtn.textContent = 'Save';
    saveBtn.disabled = true;

    const saveStatus = document.createElement('span');
    saveStatus.className = 'hint';
    saveStatus.id = 'settings-save-status';

    top.append(statusBadge, saveBtn, resetBtn, renameBtn, deleteBtn, saveStatus);

    const uiBox = document.createElement('div');
    uiBox.className = 'card';
    uiBox.id = 'settings-ui-box';
    uiBox.style.marginTop = '12px';

    const h = document.createElement('h3');
    h.style.marginTop = '0';
    h.textContent = `${getAppLabel(appId)} settings`;
    uiBox.append(h);

    const setStatus = (text) => {
      statusBadge.textContent = text;
    };

    const setDirtyState = (isDirty) => {
      // In JSON mode we hide the UI helper and use Apply/Cancel instead.
      saveBtn.disabled = !isDirty || jsonMode;
      resetBtn.disabled = !isDirty || jsonMode;
      if (jsonMode) {
        setStatus('JSON mode');
      } else {
        setStatus(isDirty ? 'Unsaved changes' : '');
      }
    };

    const updateDirtyFromDraft = () => {
      const dirty =
        jsonStable(canonicalizeSettingsData(draftData)) !==
        jsonStable(canonicalizeSettingsData(initialSnapshot.data));
      setDirtyState(dirty);
    };

    // UI helper (simple, app-specific)
    const data = draftData;

    if (appId === 'crossword') {
      const row = document.createElement('div');
      row.className = 'row';
      row.id = 'settings-crossword-row';

      const label = document.createElement('span');
      label.className = 'hint';
      label.id = 'settings-crossword-words-label';
      label.textContent = 'Words:';

      const input = document.createElement('input');
      input.type = 'number';
      input.min = '4';
      input.max = '30';
      input.step = '1';
      input.className = 'button';
      input.style.width = '90px';
      input.id = 'settings-crossword-max-words';
      input.name = 'maxWords';
      input.value = String(Number(data.maxWords ?? 14));

      input.addEventListener('change', () => {
        data.maxWords = Math.max(4, Math.min(30, Math.floor(Number(input.value) || 14)));
        input.value = String(data.maxWords);
        updateDirtyFromDraft();
      });

      row.append(label, input);
      uiBox.append(row);
    }

    if (appId === 'flashcards') {
      const fields = Array.isArray(activeCollection?.metadata?.fields) ? activeCollection.metadata.fields : [];
      
      // Always show style configuration section
      const styleSection = document.createElement('div');
      styleSection.style.display = 'flex';
      styleSection.style.flexDirection = 'column';
      styleSection.style.gap = '16px';
      styleSection.style.marginBottom = '20px';
      
      const styleHeader = document.createElement('h4');
      styleHeader.textContent = 'Card Style';
      styleHeader.style.margin = '0 0 8px 0';
      styleSection.append(styleHeader);
      
      // Style dropdown
      const styleRow = document.createElement('div');
      styleRow.className = 'row';
      styleRow.style.alignItems = 'center';
      const styleLabel = document.createElement('span');
      styleLabel.className = 'hint';
      styleLabel.textContent = 'Style:';
      const styles = [
        { value: '', label: 'Standard (Show All)' },
        { value: 'simple_card', label: 'Simple Card (Type Answer)' }
      ];
      const styleSelect = createDropdown({
        items: styles,
        value: data.style || '',
        onChange: (value) => {
          data.style = value || undefined;
          updateDirtyFromDraft();
          renderEditor();
        }
      });
      styleSelect.style.minWidth = '150px';
      styleRow.append(styleLabel, styleSelect);
      styleSection.append(styleRow);
      
      const isSimpleCard = data.style === 'simple_card';
      
      if (isSimpleCard) {
        // Simple Card settings
        const simpleCardSection = document.createElement('div');
        simpleCardSection.style.display = 'flex';
        simpleCardSection.style.flexDirection = 'column';
        simpleCardSection.style.gap = '16px';
        
        // Question Field dropdown
        const qRow = document.createElement('div');
        qRow.className = 'row';
        qRow.style.alignItems = 'center';
        const qLabel = document.createElement('span');
        qLabel.className = 'hint';
        qLabel.textContent = 'Question Field:';
        const qSelect = createDropdown({
          items: fields.map(f => ({ value: f.key, label: f.label ?? f.key })),
          value: data.questionField,
          onChange: (value) => {
            data.questionField = value;
            updateDirtyFromDraft();
          }
        });
        qSelect.style.minWidth = '150px';
        qRow.append(qLabel, qSelect);
        
        // Answer Field dropdown
        const aRow = document.createElement('div');
        aRow.className = 'row';
        aRow.style.alignItems = 'center';
        const aLabel = document.createElement('span');
        aLabel.className = 'hint';
        aLabel.textContent = 'Answer Field:';
        const aSelect = createDropdown({
          items: fields.map(f => ({ value: f.key, label: f.label ?? f.key })),
          value: data.answerField,
          onChange: (value) => {
            data.answerField = value;
            updateDirtyFromDraft();
          }
        });
        aSelect.style.minWidth = '150px';
        aRow.append(aLabel, aSelect);
        
        // Submit Method dropdown
        const smRow = document.createElement('div');
        smRow.className = 'row';
        smRow.style.alignItems = 'center';
        const smLabel = document.createElement('span');
        smLabel.className = 'hint';
        smLabel.textContent = 'Submit Method:';
        const methods = [
          { value: 'timer', label: 'Auto (Timer)' },
          { value: 'enter', label: 'Enter Key' },
          { value: 'space', label: 'Space Key' },
          { value: 'auto_correct', label: 'Auto (When Correct)' }
        ];
        const smSelect = createDropdown({
          items: methods,
          value: data.submitMethod,
          onChange: (value) => {
            data.submitMethod = value;
            updateDirtyFromDraft();
          }
        });
        smSelect.style.minWidth = '150px';
        smRow.append(smLabel, smSelect);
        
        // Timer Seconds (only show if timer method)
        const tsRow = document.createElement('div');
        tsRow.className = 'row';
        tsRow.style.alignItems = 'center';
        const tsLabel = document.createElement('span');
        tsLabel.className = 'hint';
        tsLabel.textContent = 'Timer Seconds:';
        const tsInput = document.createElement('input');
        tsInput.type = 'number';
        tsInput.min = '1';
        tsInput.max = '10';
        tsInput.className = 'button';
        tsInput.style.width = '80px';
        tsInput.value = String(data.submitTimerSeconds ?? 3);
        tsInput.addEventListener('change', () => {
          data.submitTimerSeconds = Math.max(1, Math.min(10, Number(tsInput.value) || 3));
          tsInput.value = String(data.submitTimerSeconds);
          updateDirtyFromDraft();
        });
        tsRow.append(tsLabel, tsInput);
        const updateTimerVisibility = () => {
          tsRow.style.display = data.submitMethod === 'timer' ? 'flex' : 'none';
        };
        updateTimerVisibility();
        smSelect.addEventListener('change', updateTimerVisibility);
        
        // On Submit Action dropdown
        const saRow = document.createElement('div');
        saRow.className = 'row';
        saRow.style.alignItems = 'center';
        const saLabel = document.createElement('span');
        saLabel.className = 'hint';
        saLabel.textContent = 'On Submit:';
        const actions = [
          { value: 'show_full_card', label: 'Show Full Card' },
          { value: 'show_field_only', label: 'Show Field Only' }
        ];
        const saSelect = createDropdown({
          items: actions,
          value: data.onSubmitAction,
          onChange: (value) => {
            data.onSubmitAction = value;
            updateDirtyFromDraft();
          }
        });
        saSelect.style.minWidth = '150px';
        saRow.append(saLabel, saSelect);
        
        // Randomize checkbox
        const randRow = document.createElement('div');
        randRow.style.display = 'flex';
        randRow.style.alignItems = 'center';
        randRow.style.gap = '8px';
        const randCb = document.createElement('input');
        randCb.type = 'checkbox';
        randCb.id = 'settings-randomize';
        randCb.checked = data.randomize ?? false;
        randCb.addEventListener('change', () => {
          data.randomize = randCb.checked;
          updateDirtyFromDraft();
        });
        const randLabel = document.createElement('label');
        randLabel.htmlFor = 'settings-randomize';
        randLabel.className = 'hint';
        randLabel.textContent = 'Randomize Order';
        randRow.append(randCb, randLabel);
        
        // Auto Advance checkbox
        const aaRow = document.createElement('div');
        aaRow.style.display = 'flex';
        aaRow.style.alignItems = 'center';
        aaRow.style.gap = '8px';
        const aaCb = document.createElement('input');
        aaCb.type = 'checkbox';
        aaCb.id = 'settings-auto-advance';
        aaCb.checked = data.autoAdvance ?? false;
        aaCb.addEventListener('change', () => {
          data.autoAdvance = aaCb.checked;
          updateDirtyFromDraft();
        });
        const aaLabel = document.createElement('label');
        aaLabel.htmlFor = 'settings-auto-advance';
        aaLabel.textContent = 'Auto-advance when correct';
        aaRow.append(aaCb, aaLabel);
        
        // Batch settings section
        const batchSection = document.createElement('div');
        batchSection.style.display = 'flex';
        batchSection.style.flexDirection = 'column';
        batchSection.style.gap = '12px';
        batchSection.style.marginTop = '8px';
        
        const batchEnableRow = document.createElement('div');
        batchEnableRow.style.display = 'flex';
        batchEnableRow.style.alignItems = 'center';
        batchEnableRow.style.gap = '8px';
        const batchCb = document.createElement('input');
        batchCb.type = 'checkbox';
        batchCb.id = 'settings-batch-enabled';
        batchCb.checked = data.batchEnabled ?? false;
        batchCb.addEventListener('change', () => {
          data.batchEnabled = batchCb.checked;
          updateDirtyFromDraft();
          updateBatchSettingsVisibility();
        });
        const batchLabel = document.createElement('label');
        batchLabel.htmlFor = 'settings-batch-enabled';
        batchLabel.className = 'hint';
        batchLabel.textContent = 'Enable Batches';
        batchEnableRow.append(batchCb, batchLabel);
        batchSection.append(batchEnableRow);
        
        // Batch details (only shown when enabled)
        const batchDetails = document.createElement('div');
        batchDetails.style.display = 'flex';
        batchDetails.style.flexDirection = 'column';
        batchDetails.style.gap = '12px';
        batchDetails.style.paddingLeft = '24px';
        batchDetails.style.borderLeft = '2px solid var(--panel)';
        
        const batchSizeRow = document.createElement('div');
        batchSizeRow.className = 'row';
        batchSizeRow.style.alignItems = 'center';
        const batchSizeLabel = document.createElement('span');
        batchSizeLabel.className = 'hint';
        batchSizeLabel.textContent = 'Batch Size:';
        const batchSizeInput = document.createElement('input');
        batchSizeInput.type = 'number';
        batchSizeInput.min = '1';
        batchSizeInput.max = '100';
        batchSizeInput.className = 'button';
        batchSizeInput.style.width = '80px';
        batchSizeInput.value = String(data.batchSize ?? 10);
        batchSizeInput.addEventListener('change', () => {
          data.batchSize = Math.max(1, Math.min(100, Number(batchSizeInput.value) || 10));
          batchSizeInput.value = String(data.batchSize);
          updateDirtyFromDraft();
        });
        batchSizeRow.append(batchSizeLabel, batchSizeInput);
        
        const batchLoopRow = document.createElement('div');
        batchLoopRow.style.display = 'flex';
        batchLoopRow.style.alignItems = 'center';
        batchLoopRow.style.gap = '8px';
        const batchLoopCb = document.createElement('input');
        batchLoopCb.type = 'checkbox';
        batchLoopCb.id = 'settings-batch-loop';
        batchLoopCb.checked = data.batchLoop ?? true;
        batchLoopCb.addEventListener('change', () => {
          data.batchLoop = batchLoopCb.checked;
          updateDirtyFromDraft();
        });
        const batchLoopLabel = document.createElement('label');
        batchLoopLabel.htmlFor = 'settings-batch-loop';
        batchLoopLabel.className = 'hint';
        batchLoopLabel.textContent = 'Loop batch automatically';
        batchLoopRow.append(batchLoopCb, batchLoopLabel);
        
        batchDetails.append(batchSizeRow, batchLoopRow);
        batchSection.append(batchDetails);
        
        const updateBatchSettingsVisibility = () => {
          batchDetails.style.display = data.batchEnabled ? 'flex' : 'none';
        };
        updateBatchSettingsVisibility();
        
        styleSection.append(qRow, aRow, smRow, tsRow, saRow, randRow, aaRow, batchSection);
      }
      
      uiBox.append(styleSection);
      
      // Randomize checkbox (for standard mode or always visible)
      if (!data.style || data.style !== 'simple_card') {
        const standardRandRow = document.createElement('div');
        standardRandRow.style.display = 'flex';
        standardRandRow.style.alignItems = 'center';
        standardRandRow.style.gap = '8px';
        standardRandRow.style.marginBottom = '12px';
        const standardRandCb = document.createElement('input');
        standardRandCb.type = 'checkbox';
        standardRandCb.id = 'settings-randomize-standard';
        standardRandCb.checked = data.randomize ?? false;
        standardRandCb.addEventListener('change', () => {
          data.randomize = standardRandCb.checked;
          updateDirtyFromDraft();
        });
        const standardRandLabel = document.createElement('label');
        standardRandLabel.htmlFor = 'settings-randomize-standard';
        standardRandLabel.className = 'hint';
        standardRandLabel.textContent = 'Randomize Order';
        standardRandRow.append(standardRandCb, standardRandLabel);
        uiBox.append(standardRandRow);
        
        // Batch settings section
        const batchSection = document.createElement('div');
        batchSection.style.display = 'flex';
        batchSection.style.flexDirection = 'column';
        batchSection.style.gap = '12px';
        batchSection.style.marginBottom = '12px';
        
        const batchEnableRow = document.createElement('div');
        batchEnableRow.style.display = 'flex';
        batchEnableRow.style.alignItems = 'center';
        batchEnableRow.style.gap = '8px';
        const batchCb = document.createElement('input');
        batchCb.type = 'checkbox';
        batchCb.id = 'settings-batch-enabled-standard';
        batchCb.checked = data.batchEnabled ?? false;
        batchCb.addEventListener('change', () => {
          data.batchEnabled = batchCb.checked;
          updateDirtyFromDraft();
          updateBatchSettingsVisibility();
        });
        const batchLabel = document.createElement('label');
        batchLabel.htmlFor = 'settings-batch-enabled-standard';
        batchLabel.className = 'hint';
        batchLabel.textContent = 'Enable Batches';
        batchEnableRow.append(batchCb, batchLabel);
        batchSection.append(batchEnableRow);
        
        // Batch details (only shown when enabled)
        const batchDetails = document.createElement('div');
        batchDetails.style.display = 'flex';
        batchDetails.style.flexDirection = 'column';
        batchDetails.style.gap = '12px';
        batchDetails.style.paddingLeft = '24px';
        batchDetails.style.borderLeft = '2px solid var(--panel)';
        
        const batchSizeRow = document.createElement('div');
        batchSizeRow.className = 'row';
        batchSizeRow.style.alignItems = 'center';
        const batchSizeLabel = document.createElement('span');
        batchSizeLabel.className = 'hint';
        batchSizeLabel.textContent = 'Batch Size:';
        const batchSizeInput = document.createElement('input');
        batchSizeInput.type = 'number';
        batchSizeInput.min = '1';
        batchSizeInput.max = '100';
        batchSizeInput.className = 'button';
        batchSizeInput.style.width = '80px';
        batchSizeInput.value = String(data.batchSize ?? 10);
        batchSizeInput.addEventListener('change', () => {
          data.batchSize = Math.max(1, Math.min(100, Number(batchSizeInput.value) || 10));
          batchSizeInput.value = String(data.batchSize);
          updateDirtyFromDraft();
        });
        batchSizeRow.append(batchSizeLabel, batchSizeInput);
        
        const batchLoopRow = document.createElement('div');
        batchLoopRow.style.display = 'flex';
        batchLoopRow.style.alignItems = 'center';
        batchLoopRow.style.gap = '8px';
        const batchLoopCb = document.createElement('input');
        batchLoopCb.type = 'checkbox';
        batchLoopCb.id = 'settings-batch-loop-standard';
        batchLoopCb.checked = data.batchLoop ?? true;
        batchLoopCb.addEventListener('change', () => {
          data.batchLoop = batchLoopCb.checked;
          updateDirtyFromDraft();
        });
        const batchLoopLabel = document.createElement('label');
        batchLoopLabel.htmlFor = 'settings-batch-loop-standard';
        batchLoopLabel.className = 'hint';
        batchLoopLabel.textContent = 'Loop batch automatically';
        batchLoopRow.append(batchLoopCb, batchLoopLabel);
        
        batchDetails.append(batchSizeRow, batchLoopRow);
        batchSection.append(batchDetails);
        
        const updateBatchSettingsVisibility = () => {
          batchDetails.style.display = data.batchEnabled ? 'flex' : 'none';
        };
        updateBatchSettingsVisibility();
        
        uiBox.append(batchSection);
      }
      
      // Display Fields section (only for standard mode)
      if (!data.style || data.style !== 'simple_card') {
        const fieldsHeader = document.createElement('h4');
        fieldsHeader.textContent = 'Display Fields';
        fieldsHeader.style.margin = '20px 0 8px 0';
        uiBox.append(fieldsHeader);
        
        const currentKeys = Array.isArray(data.displayFieldKeys) ? new Set(data.displayFieldKeys) : new Set(fields.map((f) => f.key));

        const list = document.createElement('div');
        list.style.display = 'grid';
        list.style.gridTemplateColumns = 'repeat(auto-fit, minmax(220px, 1fr))';
        list.style.gap = '8px';

        for (const f of fields) {
          const label = document.createElement('label');
          label.style.display = 'flex';
          label.style.alignItems = 'center';
          label.style.gap = '8px';

          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.id = `settings-flashcards-field-${String(f.key ?? '').replace(/[^a-zA-Z0-9_-]+/g, '_')}`;
          cb.name = 'displayFieldKeys';
          cb.checked = currentKeys.has(f.key);
          cb.addEventListener('change', () => {
            if (cb.checked) currentKeys.add(f.key);
            else currentKeys.delete(f.key);
            data.displayFieldKeys = Array.from(currentKeys).filter(Boolean);
            updateDirtyFromDraft();
          });

          const text = document.createElement('span');
          text.id = `settings-flashcards-field-label-${String(f.key ?? '').replace(/[^a-zA-Z0-9_-]+/g, '_')}`;
          text.textContent = f.label ?? f.key;

          label.htmlFor = cb.id;
          label.append(cb, text);
          list.append(label);
        }

        data.displayFieldKeys = Array.from(currentKeys).filter(Boolean);

        uiBox.append(list);
      }
    }

    const jsonBox = document.createElement('div');
    jsonBox.className = 'card';
    jsonBox.id = 'settings-json-box';
    jsonBox.style.marginTop = '12px';

    const jh = document.createElement('h3');
    jh.style.marginTop = '0';
    jh.textContent = 'JSON';

    const textarea = document.createElement('textarea');
    textarea.className = 'textarea';
    textarea.id = 'settings-json-textarea';
    textarea.name = 'settingsJson';
    textarea.value = jsonTextSnapshot;

    const jsonActions = document.createElement('div');
    jsonActions.className = 'row';

    const applyJson = document.createElement('button');
    applyJson.className = 'button';
    applyJson.id = 'settings-json-apply';
    applyJson.name = 'applyJson';
    applyJson.textContent = 'Apply JSON';
    applyJson.disabled = true;

    const cancelJson = document.createElement('button');
    cancelJson.className = 'button';
    cancelJson.id = 'settings-json-cancel';
    cancelJson.name = 'cancelJson';
    cancelJson.textContent = 'Cancel';

    const jsonErr = document.createElement('div');
    jsonErr.className = 'hint';
    jsonErr.id = 'settings-json-error';
    jsonErr.style.marginTop = '6px';

    const updateJsonDirty = () => {
      const dirty = textarea.value !== jsonTextSnapshot;
      applyJson.disabled = !dirty;
    };

    textarea.addEventListener('input', () => {
      updateJsonDirty();
    });

    applyJson.addEventListener('click', async () => {
      const parsed = safeParseJson(textarea.value);
      if (!parsed.ok) {
        jsonErr.textContent = parsed.error;
        return;
      }
      const next = parsed.value;
      if (next?.id && String(next.id) !== String(current.id)) {
        jsonErr.textContent = 'Changing id is not supported. Use the current mode.';
        return;
      }
      if (typeof next?.name === 'string' && String(next.name) !== String(current.name)) {
        jsonErr.textContent = 'To rename, use the Rename button (not JSON).';
        return;
      }
      if (!next || typeof next !== 'object') {
        jsonErr.textContent = 'JSON must be an object.';
        return;
      }
      if (!('data' in next)) {
        jsonErr.textContent = 'JSON must include a data property.';
        return;
      }
      jsonErr.textContent = '';

      draftData = deepClone(next.data ?? {});
      initialSnapshot = { id: current.id, name: current.name, data: canonicalizeSettingsData(draftData) };
      draftData = deepClone(initialSnapshot.data);

      await store.upsertAppSettingsPreset(appId, { id: current.id, name: current.name, data: draftData });

      jsonTextSnapshot = prettyJson({ id: current.id, name: current.name, data: deepClone(draftData) });
      jsonMode = false;
      toggleJson.textContent = 'Edit JSON';
      renderEditor();
    });

    cancelJson.addEventListener('click', () => {
      textarea.value = jsonTextSnapshot;
      jsonErr.textContent = '';
      jsonMode = false;
      toggleJson.textContent = 'Edit JSON';
      renderEditor();
    });

    jsonActions.append(applyJson, cancelJson);
    jsonBox.append(jh, textarea, jsonActions, jsonErr);

    saveBtn.addEventListener('click', async () => {
      await store.upsertAppSettingsPreset(appId, { id: current.id, name: current.name, data });
      initialSnapshot = { id: current.id, name: current.name, data: canonicalizeSettingsData(data) };
      draftData = deepClone(initialSnapshot.data);
      jsonTextSnapshot = prettyJson({ id: current.id, name: current.name, data: deepClone(draftData) });
      updateDirtyFromDraft();
      saveStatus.textContent = 'Saved.';
      setTimeout(() => (saveStatus.textContent = ''), 1200);
    });

    resetBtn.addEventListener('click', () => {
      // Revert unsaved UI edits back to the last saved snapshot.
      if (!initialSnapshot) return;
      draftData = deepClone(initialSnapshot.data);
      renderEditor();
    });

    renameBtn.addEventListener('click', async () => {
      const nextName = window.prompt('Rename mode:', current.name);
      if (!nextName) return;
      await store.renameAppSettingsPreset(appId, current.id, nextName);
      // Reset snapshots since name changed.
      initialSnapshot = null;
      renderEditor();
    });

    deleteBtn.addEventListener('click', async () => {
      const presets = store.getAppSettingsPresets(appId);
      if ((presets?.length ?? 0) <= 1) {
        window.alert('You must keep at least one mode.');
        return;
      }
      const ok = window.confirm(`Delete mode "${current.name}"? This cannot be undone.`);
      if (!ok) return;
      const res = await store.deleteAppSettingsPreset(appId, current.id);
      if (!res?.ok) {
        window.alert('Could not delete this mode.');
        return;
      }
      initialSnapshot = null;
      // Rebuild the mode dropdown options
      presetSelect.innerHTML = '';
      const nextPresets = store.getAppSettingsPresets(appId);
      const nextActiveId = store.getActiveAppSettingsPresetId(appId);
      for (const p of nextPresets) {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        if (p.id === nextActiveId) opt.selected = true;
        presetSelect.append(opt);
      }
      renderEditor();
    });

    updateDirtyFromDraft();

    // When editing JSON, hide the UI helper so the user can't change both.
    editorWrap.append(top);
    if (jsonMode) editorWrap.append(jsonBox);
    else editorWrap.append(uiBox);

    // Keep JSON apply button state correct.
    if (jsonMode) {
      applyJson.disabled = true;
    }
  };

  newBtn.addEventListener('click', async () => {
    const newName = window.prompt('Enter name for new mode:', 'My Custom Mode');
    if (!newName) return;
    
    // Create a new preset with default data structure
    const newId = `custom_${Date.now()}`;
    const defaultData = appId === 'flashcards' 
      ? { displayFieldKeys: '__ALL__' }
      : appId === 'crossword'
      ? { maxWords: 14 }
      : {};
    
    await store.upsertAppSettingsPreset(appId, { 
      id: newId, 
      name: newName, 
      data: defaultData 
    });
    
    await store.setActiveAppSettingsPresetId(appId, newId);
    
    // Rebuild the mode dropdown options
    presetSelect.innerHTML = '';
    const nextPresets = store.getAppSettingsPresets(appId);
    for (const p of nextPresets) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      if (p.id === newId) opt.selected = true;
      presetSelect.append(opt);
    }
    
    initialSnapshot = null;
    renderEditor();
  });

  toggleJson.addEventListener('click', () => {
    jsonMode = !jsonMode;
    toggleJson.textContent = jsonMode ? 'Hide JSON' : 'Edit JSON';

    // When entering JSON mode, treat the current draft as the baseline.
    if (jsonMode) {
      const current = store.getActiveAppSettingsPreset(appId);
      const data = deepClone(draftData ?? current?.data ?? {});
      jsonTextSnapshot = prettyJson({ id: current?.id, name: current?.name, data });
    }

    renderEditor();
  });

  body.append(controls, editorWrap);

  el.append(header, hint, body);

  // Initial render
  if (!preset) {
    const empty = document.createElement('div');
    empty.className = 'hint';
    empty.textContent = 'No modes available.';
    editorWrap.append(empty);
  } else {
    renderEditor();
  }

  return el;
}
