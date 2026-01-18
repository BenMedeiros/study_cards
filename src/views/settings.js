import { createDropdown } from '../components/dropdown.js';

function getAppLabel(appId) {
  const labels = {
    flashcards: 'Flashcards',
    qaCards: 'QA Cards',
    crossword: 'Crossword',
  };
  return labels[appId] || appId;
}

export function renderSettings({ store, onNavigate, route }) {
  const el = document.createElement('div');
  el.className = 'card';
  el.id = 'settings-root';

  const activeCollection = store.getActiveCollection();
  const appId = route?.query?.get('app') || 'flashcards';

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
  back.addEventListener('click', () => history.back());

  header.append(title, back);

  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.id = 'settings-hint';
  hint.style.marginTop = '8px';
  hint.textContent = 'Settings are per-collection and per-app.';

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
    items: [
      { value: 'flashcards', label: 'Flashcards' },
      { value: 'qaCards', label: 'QA Cards' },
      { value: 'crossword', label: 'Crossword' },
    ],
    value: appId,
    onChange: (value) => {
      onNavigate(`/settings?app=${encodeURIComponent(value)}`);
    }
  });
  appSelect.id = 'settings-app-select';

  controls.append(appLabel, appSelect);

  const editorWrap = document.createElement('div');
  editorWrap.id = 'settings-editor-wrap';
  editorWrap.style.marginTop = '12px';

  let currentSettings = store.getAppSettings(appId);
  let isDirty = false;

  const renderEditor = () => {
    editorWrap.innerHTML = '';

    const top = document.createElement('div');
    top.className = 'row';
    top.id = 'settings-editor-top';

    const statusBadge = document.createElement('div');
    statusBadge.className = 'badge';
    statusBadge.id = 'settings-status';
    statusBadge.textContent = isDirty ? 'Modified' : 'Saved';

    const resetBtn = document.createElement('button');
    resetBtn.className = 'button';
    resetBtn.id = 'settings-reset';
    resetBtn.name = 'reset';
    resetBtn.textContent = 'Reset to Defaults';
    resetBtn.disabled = !isDirty;

    const saveBtn = document.createElement('button');
    saveBtn.className = 'button';
    saveBtn.id = 'settings-save';
    saveBtn.name = 'save';
    saveBtn.textContent = 'Save';
    saveBtn.disabled = !isDirty;

    top.append(statusBadge, saveBtn, resetBtn);

    const uiBox = document.createElement('div');
    uiBox.className = 'card';
    uiBox.id = 'settings-ui-box';
    uiBox.style.marginTop = '12px';

    const h = document.createElement('h3');
    h.style.marginTop = '0';
    h.textContent = `${getAppLabel(appId)} Settings`;
    uiBox.append(h);

    const markDirty = () => {
      isDirty = true;
      statusBadge.textContent = 'Modified';
      saveBtn.disabled = false;
      resetBtn.disabled = false;
    };

    // Render settings UI based on app
    if (appId === 'flashcards') {
      renderFlashcardsSettings(uiBox, currentSettings, markDirty, activeCollection);
    } else if (appId === 'qaCards') {
      renderQaCardsSettings(uiBox, currentSettings, markDirty, activeCollection);
    } else if (appId === 'crossword') {
      renderCrosswordSettings(uiBox, currentSettings, markDirty);
    }

    saveBtn.addEventListener('click', async () => {
      for (const [key, value] of Object.entries(currentSettings)) {
        await store.setAppSetting(appId, key, value);
      }
      isDirty = false;
      currentSettings = store.getAppSettings(appId);
      renderEditor();
    });

    resetBtn.addEventListener('click', async () => {
      await store.resetAppSettings(appId);
      isDirty = false;
      currentSettings = store.getAppSettings(appId);
      renderEditor();
    });

    editorWrap.append(top, uiBox);
  };

  body.append(controls, editorWrap);
  el.append(header, hint, body);

  renderEditor();

  return el;
}

function renderFlashcardsSettings(container, settings, onChange, collection) {
  const fields = Array.isArray(collection?.metadata?.fields) ? collection.metadata.fields : [];

  // Randomize
  const randomizeRow = document.createElement('div');
  randomizeRow.style.display = 'flex';
  randomizeRow.style.alignItems = 'center';
  randomizeRow.style.gap = '8px';
  randomizeRow.style.marginBottom = '12px';
  
  const randomizeCb = document.createElement('input');
  randomizeCb.type = 'checkbox';
  randomizeCb.id = 'settings-randomize';
  randomizeCb.checked = settings.randomize ?? false;
  randomizeCb.addEventListener('change', () => {
    settings.randomize = randomizeCb.checked;
    onChange();
  });
  
  const randomizeLabel = document.createElement('label');
  randomizeLabel.htmlFor = 'settings-randomize';
  randomizeLabel.textContent = 'Randomize Order';
  randomizeRow.append(randomizeCb, randomizeLabel);

  // Batch settings
  const batchSection = document.createElement('div');
  batchSection.style.display = 'flex';
  batchSection.style.flexDirection = 'column';
  batchSection.style.gap = '12px';
  batchSection.style.marginTop = '16px';
  
  const batchEnableRow = document.createElement('div');
  batchEnableRow.style.display = 'flex';
  batchEnableRow.style.alignItems = 'center';
  batchEnableRow.style.gap = '8px';
  
  const batchCb = document.createElement('input');
  batchCb.type = 'checkbox';
  batchCb.id = 'settings-batch-enabled';
  batchCb.checked = settings.batchEnabled ?? false;
  batchCb.addEventListener('change', () => {
    settings.batchEnabled = batchCb.checked;
    onChange();
    updateBatchDetailsVisibility();
  });
  
  const batchLabel = document.createElement('label');
  batchLabel.htmlFor = 'settings-batch-enabled';
  batchLabel.textContent = 'Enable Batches';
  batchEnableRow.append(batchCb, batchLabel);
  
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
  batchSizeInput.value = String(settings.batchSize ?? 10);
  batchSizeInput.addEventListener('change', () => {
    settings.batchSize = Math.max(1, Math.min(100, Number(batchSizeInput.value) || 10));
    batchSizeInput.value = String(settings.batchSize);
    onChange();
  });
  batchSizeRow.append(batchSizeLabel, batchSizeInput);
  
  const batchLoopRow = document.createElement('div');
  batchLoopRow.style.display = 'flex';
  batchLoopRow.style.alignItems = 'center';
  batchLoopRow.style.gap = '8px';
  
  const batchLoopCb = document.createElement('input');
  batchLoopCb.type = 'checkbox';
  batchLoopCb.id = 'settings-batch-loop';
  batchLoopCb.checked = settings.batchLoop ?? true;
  batchLoopCb.addEventListener('change', () => {
    settings.batchLoop = batchLoopCb.checked;
    onChange();
  });
  
  const batchLoopLabel = document.createElement('label');
  batchLoopLabel.htmlFor = 'settings-batch-loop';
  batchLoopLabel.textContent = 'Loop batch automatically';
  batchLoopRow.append(batchLoopCb, batchLoopLabel);
  
  batchDetails.append(batchSizeRow, batchLoopRow);
  batchSection.append(batchEnableRow, batchDetails);
  
  const updateBatchDetailsVisibility = () => {
    batchDetails.style.display = settings.batchEnabled ? 'flex' : 'none';
  };
  updateBatchDetailsVisibility();

  // Display Fields (optional - show all by default)
  const displayFieldsSection = document.createElement('div');
  displayFieldsSection.style.marginTop = '16px';
  
  const displayFieldsHeader = document.createElement('h4');
  displayFieldsHeader.textContent = 'Display Fields (optional)';
  displayFieldsHeader.style.marginBottom = '8px';
  
  const displayFieldsHint = document.createElement('div');
  displayFieldsHint.className = 'hint';
  displayFieldsHint.textContent = 'Leave empty to show all fields';
  displayFieldsHint.style.marginBottom = '8px';
  
  displayFieldsSection.append(displayFieldsHeader, displayFieldsHint);
  
  for (const field of fields) {
    const fieldRow = document.createElement('div');
    fieldRow.style.display = 'flex';
    fieldRow.style.alignItems = 'center';
    fieldRow.style.gap = '8px';
    fieldRow.style.marginBottom = '4px';
    
    const fieldCb = document.createElement('input');
    fieldCb.type = 'checkbox';
    fieldCb.id = `field-${field.key}`;
    
    const currentDisplayKeys = settings.displayFieldKeys;
    if (currentDisplayKeys === null) {
      fieldCb.checked = true;
    } else if (Array.isArray(currentDisplayKeys)) {
      fieldCb.checked = currentDisplayKeys.includes(field.key);
    }
    
    fieldCb.addEventListener('change', () => {
      if (!Array.isArray(settings.displayFieldKeys)) {
        settings.displayFieldKeys = fields.map(f => f.key);
      }
      
      if (fieldCb.checked) {
        if (!settings.displayFieldKeys.includes(field.key)) {
          settings.displayFieldKeys.push(field.key);
        }
      } else {
        settings.displayFieldKeys = settings.displayFieldKeys.filter(k => k !== field.key);
      }
      
      // If all fields selected, set to null
      if (settings.displayFieldKeys.length === fields.length) {
        settings.displayFieldKeys = null;
      }
      
      onChange();
    });
    
    const fieldLabel = document.createElement('label');
    fieldLabel.htmlFor = `field-${field.key}`;
    fieldLabel.textContent = field.label || field.key;
    
    fieldRow.append(fieldCb, fieldLabel);
    displayFieldsSection.append(fieldRow);
  }

  container.append(randomizeRow, batchSection, displayFieldsSection);
}

function renderQaCardsSettings(container, settings, onChange, collection) {
  const fields = Array.isArray(collection?.metadata?.fields) ? collection.metadata.fields : [];

  // Question Field
  const qRow = document.createElement('div');
  qRow.className = 'row';
  qRow.style.alignItems = 'center';
  qRow.style.marginBottom = '12px';
  
  const qLabel = document.createElement('span');
  qLabel.className = 'hint';
  qLabel.textContent = 'Question Field:';
  
  const qSelect = createDropdown({
    items: fields.map(f => ({ value: f.key, label: f.label ?? f.key })),
    value: settings.questionField || (fields[0]?.key ?? ''),
    onChange: (value) => {
      settings.questionField = value;
      onChange();
    }
  });
  qSelect.style.minWidth = '150px';
  qRow.append(qLabel, qSelect);

  // Answer Field
  const aRow = document.createElement('div');
  aRow.className = 'row';
  aRow.style.alignItems = 'center';
  aRow.style.marginBottom = '12px';
  
  const aLabel = document.createElement('span');
  aLabel.className = 'hint';
  aLabel.textContent = 'Answer Field:';
  
  const aSelect = createDropdown({
    items: fields.map(f => ({ value: f.key, label: f.label ?? f.key })),
    value: settings.answerField || (fields[1]?.key ?? ''),
    onChange: (value) => {
      settings.answerField = value;
      onChange();
    }
  });
  aSelect.style.minWidth = '150px';
  aRow.append(aLabel, aSelect);

  // Submit Method
  const smRow = document.createElement('div');
  smRow.className = 'row';
  smRow.style.alignItems = 'center';
  smRow.style.marginBottom = '12px';
  
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
    value: settings.submitMethod || 'timer',
    onChange: (value) => {
      settings.submitMethod = value;
      onChange();
      updateTimerVisibility();
    }
  });
  smSelect.style.minWidth = '150px';
  smRow.append(smLabel, smSelect);

  // Timer Seconds
  const tsRow = document.createElement('div');
  tsRow.className = 'row';
  tsRow.style.alignItems = 'center';
  tsRow.style.marginBottom = '12px';
  
  const tsLabel = document.createElement('span');
  tsLabel.className = 'hint';
  tsLabel.textContent = 'Timer Seconds:';
  
  const tsInput = document.createElement('input');
  tsInput.type = 'number';
  tsInput.min = '1';
  tsInput.max = '10';
  tsInput.className = 'button';
  tsInput.style.width = '80px';
  tsInput.value = String(settings.submitTimerSeconds ?? 3);
  tsInput.addEventListener('change', () => {
    settings.submitTimerSeconds = Math.max(1, Math.min(10, Number(tsInput.value) || 3));
    tsInput.value = String(settings.submitTimerSeconds);
    onChange();
  });
  tsRow.append(tsLabel, tsInput);

  const updateTimerVisibility = () => {
    tsRow.style.display = settings.submitMethod === 'timer' ? 'flex' : 'none';
  };
  updateTimerVisibility();

  // On Submit Action
  const saRow = document.createElement('div');
  saRow.className = 'row';
  saRow.style.alignItems = 'center';
  saRow.style.marginBottom = '12px';
  
  const saLabel = document.createElement('span');
  saLabel.className = 'hint';
  saLabel.textContent = 'On Submit:';
  
  const actions = [
    { value: 'show_full_card', label: 'Show Full Card' },
    { value: 'show_field_only', label: 'Show Field Only' }
  ];
  
  const saSelect = createDropdown({
    items: actions,
    value: settings.onSubmitAction || 'show_full_card',
    onChange: (value) => {
      settings.onSubmitAction = value;
      onChange();
    }
  });
  saSelect.style.minWidth = '150px';
  saRow.append(saLabel, saSelect);

  // Randomize
  const randRow = document.createElement('div');
  randRow.style.display = 'flex';
  randRow.style.alignItems = 'center';
  randRow.style.gap = '8px';
  randRow.style.marginBottom = '12px';
  
  const randCb = document.createElement('input');
  randCb.type = 'checkbox';
  randCb.id = 'settings-randomize';
  randCb.checked = settings.randomize ?? false;
  randCb.addEventListener('change', () => {
    settings.randomize = randCb.checked;
    onChange();
  });
  
  const randLabel = document.createElement('label');
  randLabel.htmlFor = 'settings-randomize';
  randLabel.textContent = 'Randomize Order';
  randRow.append(randCb, randLabel);

  // Auto Advance
  const aaRow = document.createElement('div');
  aaRow.style.display = 'flex';
  aaRow.style.alignItems = 'center';
  aaRow.style.gap = '8px';
  aaRow.style.marginBottom = '16px';
  
  const aaCb = document.createElement('input');
  aaCb.type = 'checkbox';
  aaCb.id = 'settings-auto-advance';
  aaCb.checked = settings.autoAdvance ?? false;
  aaCb.addEventListener('change', () => {
    settings.autoAdvance = aaCb.checked;
    onChange();
  });
  
  const aaLabel = document.createElement('label');
  aaLabel.htmlFor = 'settings-auto-advance';
  aaLabel.textContent = 'Auto-advance when correct';
  aaRow.append(aaCb, aaLabel);

  // Batch settings (same as flashcards)
  const batchSection = document.createElement('div');
  batchSection.style.display = 'flex';
  batchSection.style.flexDirection = 'column';
  batchSection.style.gap = '12px';
  
  const batchEnableRow = document.createElement('div');
  batchEnableRow.style.display = 'flex';
  batchEnableRow.style.alignItems = 'center';
  batchEnableRow.style.gap = '8px';
  
  const batchCb = document.createElement('input');
  batchCb.type = 'checkbox';
  batchCb.id = 'settings-batch-enabled';
  batchCb.checked = settings.batchEnabled ?? false;
  batchCb.addEventListener('change', () => {
    settings.batchEnabled = batchCb.checked;
    onChange();
    updateBatchDetailsVisibility();
  });
  
  const batchLabel = document.createElement('label');
  batchLabel.htmlFor = 'settings-batch-enabled';
  batchLabel.textContent = 'Enable Batches';
  batchEnableRow.append(batchCb, batchLabel);
  
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
  batchSizeInput.value = String(settings.batchSize ?? 10);
  batchSizeInput.addEventListener('change', () => {
    settings.batchSize = Math.max(1, Math.min(100, Number(batchSizeInput.value) || 10));
    batchSizeInput.value = String(settings.batchSize);
    onChange();
  });
  batchSizeRow.append(batchSizeLabel, batchSizeInput);
  
  const batchLoopRow = document.createElement('div');
  batchLoopRow.style.display = 'flex';
  batchLoopRow.style.alignItems = 'center';
  batchLoopRow.style.gap = '8px';
  
  const batchLoopCb = document.createElement('input');
  batchLoopCb.type = 'checkbox';
  batchLoopCb.id = 'settings-batch-loop';
  batchLoopCb.checked = settings.batchLoop ?? true;
  batchLoopCb.addEventListener('change', () => {
    settings.batchLoop = batchLoopCb.checked;
    onChange();
  });
  
  const batchLoopLabel = document.createElement('label');
  batchLoopLabel.htmlFor = 'settings-batch-loop';
  batchLoopLabel.textContent = 'Loop batch automatically';
  batchLoopRow.append(batchLoopCb, batchLoopLabel);
  
  batchDetails.append(batchSizeRow, batchLoopRow);
  batchSection.append(batchEnableRow, batchDetails);
  
  const updateBatchDetailsVisibility = () => {
    batchDetails.style.display = settings.batchEnabled ? 'flex' : 'none';
  };
  updateBatchDetailsVisibility();

  container.append(qRow, aRow, smRow, tsRow, saRow, randRow, aaRow, batchSection);
}

function renderCrosswordSettings(container, settings, onChange) {
  const row = document.createElement('div');
  row.className = 'row';
  row.style.alignItems = 'center';

  const label = document.createElement('span');
  label.className = 'hint';
  label.textContent = 'Max Words:';

  const input = document.createElement('input');
  input.type = 'number';
  input.min = '4';
  input.max = '30';
  input.step = '1';
  input.className = 'button';
  input.style.width = '90px';
  input.value = String(settings.maxWords ?? 14);
  
  input.addEventListener('change', () => {
    settings.maxWords = Math.max(4, Math.min(30, Number(input.value) || 14));
    input.value = String(settings.maxWords);
    onChange();
  });

  row.append(label, input);
  container.append(row);
}
