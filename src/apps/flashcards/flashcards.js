import { nowMs } from '../../utils/time.js';

function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function renderFlashcards({ store }) {
  const el = document.createElement('div');
  el.id = 'flashcards-root';

  const wrapper = document.createElement('div');
  wrapper.className = 'card';
  wrapper.id = 'flashcards-card';

  const active = store.getActiveCollection();
  if (!active) {
    wrapper.innerHTML = '<h2>Flashcards</h2><p class="hint">No active collection.</p>';
    el.append(wrapper);
    return el;
  }

  const settings = store.getActiveAppSettingsData?.('flashcards') ?? {};
  let workingEntries = settings.randomize ? shuffleArray(active.entries) : active.entries;
  let batches = [];
  let currentBatchIndex = 0;
  let index = 0;
  let shownAt = nowMs();
  let submitTimer = null;
  let feedbackMode = false;
  let userAnswer = '';
  let isCorrect = false;

  function createBatches() {
    const batchSize = Math.max(1, settings.batchSize ?? 10);
    batches = [];
    for (let i = 0; i < workingEntries.length; i += batchSize) {
      batches.push(workingEntries.slice(i, i + batchSize));
    }
    if (batches.length === 0) batches = [[]];
  }

  function getCurrentBatchEntries() {
    if (!settings.batchEnabled || batches.length === 0) {
      return workingEntries;
    }
    return batches[currentBatchIndex] ?? [];
  }

  function reshuffleBatches() {
    workingEntries = shuffleArray(active.entries);
    createBatches();
    currentBatchIndex = 0;
    index = 0;
  }

  // Initialize batches if enabled
  if (settings.batchEnabled) {
    createBatches();
  }

  function clampIndex() {
    const batchEntries = getCurrentBatchEntries();
    const total = batchEntries.length;
    if (total === 0) index = 0;
    else index = (index + total) % total;
  }

  function renderStandardCard(body, entry, settings) {
    const wantedKeys = Array.isArray(settings.displayFieldKeys) ? settings.displayFieldKeys : null;
    const fields = Array.isArray(active.metadata.fields) ? active.metadata.fields : [];
    const visible = wantedKeys ? fields.filter((f) => wantedKeys.includes(f.key)) : fields;

    for (const field of visible) {
      const row = document.createElement('div');
      row.className = 'kv';
      const key = document.createElement('div');
      key.className = 'k';
      key.textContent = field.label ?? field.key;

      const val = document.createElement('div');
      val.textContent = entry[field.key] ?? '';

      row.append(key, val);
      body.append(row);
    }
  }

  function renderSimpleCard(body, entry, settings) {
    const questionField = settings.questionField || 'kanji';
    const answerField = settings.answerField || 'reading';
    const questionValue = entry[questionField] ?? '';

    console.log('[SimpleCard] Settings:', settings);
    console.log('[SimpleCard] Question field:', questionField, '=', questionValue);
    console.log('[SimpleCard] Answer field:', answerField, '=', entry[answerField]);

    const container = document.createElement('div');
    container.className = 'simple-card-container';

    const question = document.createElement('div');
    question.className = 'simple-card-question';
    question.textContent = questionValue;

    const inputWrapper = document.createElement('div');
    inputWrapper.className = 'simple-card-input-wrapper';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'simple-card-input';
    input.placeholder = 'Type your answer...';
    input.value = userAnswer;
    input.autocomplete = 'off';

    const submitMethod = settings.submitMethod || 'timer';
    const timerSeconds = settings.submitTimerSeconds || 3;

    console.log('[SimpleCard] Submit method:', submitMethod, 'Timer:', timerSeconds + 's');

    function handleSubmit() {
      if (submitTimer) {
        clearTimeout(submitTimer);
        submitTimer = null;
      }

      const correctAnswer = String(entry[answerField] ?? '').trim();
      userAnswer = input.value.trim();
      isCorrect = userAnswer.toLowerCase() === correctAnswer.toLowerCase();

      store.logEvent({
        type: 'flashcards.answer_submitted',
        collectionId: active.metadata.id,
        entryId: entry?.id ?? null,
        questionField,
        answerField,
        userAnswer,
        correctAnswer,
        isCorrect,
        msOnCard: Math.round(nowMs() - shownAt),
      }).catch(() => {});

      if (settings.autoAdvance && isCorrect) {
        // Auto advance to next card
        userAnswer = '';
        feedbackMode = false;
        index += 1;
        clampIndex();
        shownAt = nowMs();
        render();
      } else {
        feedbackMode = true;
        render();
      }
    }

    function resetTimer() {
      if (submitTimer) {
        clearTimeout(submitTimer);
      }
      if (submitMethod === 'timer' && input.value.trim()) {
        submitTimer = setTimeout(handleSubmit, timerSeconds * 1000);
      }
    }

    input.addEventListener('input', (e) => {
      userAnswer = e.target.value;
      console.log('[SimpleCard] Input:', userAnswer, 'Method:', submitMethod);

      if (submitMethod === 'timer') {
        resetTimer();
      } else if (submitMethod === 'auto_correct') {
        const correctAnswer = String(entry[answerField] ?? '').trim();
        if (userAnswer.toLowerCase() === correctAnswer.toLowerCase()) {
          handleSubmit();
        }
      }
    });

    input.addEventListener('keydown', (e) => {
      if (submitMethod === 'enter' && e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      } else if (submitMethod === 'space' && e.key === ' ') {
        // For space, we submit on keydown to prevent space from being added
        e.preventDefault();
        handleSubmit();
      }
    });

    inputWrapper.append(input);
    container.append(question, inputWrapper);
    body.append(container);

    // Focus input after render
    setTimeout(() => input.focus(), 0);
  }

  function renderSimpleCardFeedback(body, entry, settings) {
    const questionField = settings.questionField || 'kanji';
    const answerField = settings.answerField || 'reading';
    const onSubmitAction = settings.onSubmitAction || 'show_full_card';
    const showFieldsOnSubmit = settings.showFieldsOnSubmit;

    const container = document.createElement('div');
    container.className = 'simple-card-feedback';

    const statusBadge = document.createElement('div');
    statusBadge.className = `feedback-badge ${isCorrect ? 'correct' : 'incorrect'}`;
    statusBadge.textContent = isCorrect ? '✓ Correct' : '✗ Incorrect';
    container.append(statusBadge);

    if (onSubmitAction === 'show_field_only') {
      // Just show the submitted field and whether it's correct
      const answerDisplay = document.createElement('div');
      answerDisplay.className = 'feedback-answer';
      answerDisplay.innerHTML = `
        <div class="feedback-label">Your answer:</div>
        <div class="feedback-value ${isCorrect ? 'correct' : 'incorrect'}">${userAnswer || '(empty)'}</div>
        <div class="feedback-label">Correct answer:</div>
        <div class="feedback-value correct">${entry[answerField] ?? ''}</div>
      `;
      container.append(answerDisplay);
    } else {
      // Show full card with all specified fields
      const fields = Array.isArray(active.metadata.fields) ? active.metadata.fields : [];
      const wantedKeys = Array.isArray(showFieldsOnSubmit) ? showFieldsOnSubmit : null;
      const visible = wantedKeys ? fields.filter((f) => wantedKeys.includes(f.key)) : fields;

      const fieldsContainer = document.createElement('div');
      fieldsContainer.className = 'feedback-fields';

      for (const field of visible) {
        const row = document.createElement('div');
        row.className = 'kv';
        const key = document.createElement('div');
        key.className = 'k';
        key.textContent = field.label ?? field.key;

        const val = document.createElement('div');
        val.textContent = entry[field.key] ?? '';

        // Highlight the answer field
        if (field.key === answerField) {
          val.className = isCorrect ? 'correct' : 'incorrect';
        }

        row.append(key, val);
        fieldsContainer.append(row);
      }

      // Show user's answer if incorrect
      if (!isCorrect) {
        const userRow = document.createElement('div');
        userRow.className = 'kv';
        const key = document.createElement('div');
        key.className = 'k';
        key.textContent = 'Your answer:';

        const val = document.createElement('div');
        val.className = 'incorrect';
        val.textContent = userAnswer || '(empty)';

        userRow.append(key, val);
        fieldsContainer.prepend(userRow);
      }

      container.append(fieldsContainer);
    }

    body.append(container);
  }

  function render() {
    const newSettings = store.getActiveAppSettingsData?.('flashcards') ?? {};
    
    // Re-shuffle if randomize setting changed
    if (newSettings.randomize !== settings.randomize) {
      settings.randomize = newSettings.randomize;
      workingEntries = settings.randomize ? shuffleArray(active.entries) : active.entries;
      if (settings.batchEnabled) {
        createBatches();
        currentBatchIndex = 0;
      }
      index = 0;
    }
    
    // Recreate batches if batch settings changed
    if (newSettings.batchEnabled !== settings.batchEnabled || 
        (newSettings.batchEnabled && newSettings.batchSize !== settings.batchSize)) {
      settings.batchEnabled = newSettings.batchEnabled;
      settings.batchSize = newSettings.batchSize;
      if (settings.batchEnabled) {
        createBatches();
        currentBatchIndex = 0;
      }
      index = 0;
    }
    
    const batchEntries = getCurrentBatchEntries();
    const entry = batchEntries[index];
    const total = batchEntries.length;
    const isSimpleCard = newSettings.style === 'simple_card';

    wrapper.innerHTML = '';

    const headerRow = document.createElement('div');
    headerRow.className = 'row';
    headerRow.id = 'flashcards-header';

    const title = document.createElement('h2');
    title.id = 'flashcards-title';
    title.style.margin = '0';
    title.textContent = `Flashcards — ${active.metadata.name}`;

    const pos = document.createElement('div');
    pos.className = 'badge';
    pos.id = 'flashcards-position';
    pos.textContent = total ? `${index + 1} / ${total}` : 'Empty';

    headerRow.append(title, pos);

    // Batch selector (if batch mode enabled)
    let batchSelector = null;
    if (settings.batchEnabled && batches.length > 0) {
      batchSelector = document.createElement('div');
      batchSelector.className = 'row';
      batchSelector.id = 'flashcards-batch-selector';
      batchSelector.style.marginTop = '10px';
      batchSelector.style.gap = '8px';
      batchSelector.style.alignItems = 'center';

      const batchLabel = document.createElement('span');
      batchLabel.className = 'hint';
      batchLabel.textContent = 'Batch:';

      const batchSelect = document.createElement('select');
      batchSelect.className = 'button';
      batchSelect.style.minWidth = '120px';
      for (let i = 0; i < batches.length; i++) {
        const option = document.createElement('option');
        option.value = String(i);
        option.textContent = `Batch ${i + 1} (${batches[i].length} cards)`;
        if (i === currentBatchIndex) option.selected = true;
        batchSelect.append(option);
      }
      batchSelect.addEventListener('change', () => {
        currentBatchIndex = Number(batchSelect.value);
        index = 0;
        feedbackMode = false;
        render();
      });

      batchSelector.append(batchLabel, batchSelect);

      // Reshuffle button (if randomize is enabled)
      if (settings.randomize) {
        const reshuffleBtn = document.createElement('button');
        reshuffleBtn.className = 'button';
        reshuffleBtn.textContent = '🔀 Reshuffle';
        reshuffleBtn.addEventListener('click', () => {
          reshuffleBatches();
          feedbackMode = false;
          render();
        });
        batchSelector.append(reshuffleBtn);
      }
    }

    const body = document.createElement('div');
    body.id = 'flashcards-body';
    body.style.marginTop = '10px';

    if (!entry) {
      body.innerHTML = '<p class="hint">This collection has no entries yet.</p>';
    } else if (isSimpleCard && !feedbackMode) {
      renderSimpleCard(body, entry, newSettings);
    } else if (isSimpleCard && feedbackMode) {
      renderSimpleCardFeedback(body, entry, newSettings);
    } else {
      renderStandardCard(body, entry, newSettings);
    }

    const controls = document.createElement('div');
    controls.className = 'row';
    controls.id = 'flashcards-controls';
    controls.style.marginTop = '12px';

    if (isSimpleCard && feedbackMode) {
      // In feedback mode, show continue button
      const continueBtn = document.createElement('button');
      continueBtn.className = 'button';
      continueBtn.textContent = 'Continue';
      continueBtn.addEventListener('click', () => {
        feedbackMode = false;
        userAnswer = '';
        index += 1;
        clampIndex();
        shownAt = nowMs();
        render();
      });
      controls.append(continueBtn);
    } else if (isSimpleCard && !feedbackMode) {
      // In answer mode, no prev/next buttons
      // User submits via input field
    } else {
      // Standard flashcard prev/next controls
      const prev = document.createElement('button');
      prev.className = 'button';
      prev.id = 'flashcards-prev';
      prev.name = 'prev';
      prev.textContent = 'Prev';

      const next = document.createElement('button');
      next.className = 'button';
      next.id = 'flashcards-next';
      next.name = 'next';
      next.textContent = 'Next';

      prev.addEventListener('click', async () => {
        await store.logEvent({
          type: 'flashcards.next',
          direction: 'prev',
          collectionId: active.metadata.id,
          entryId: entry?.id ?? null,
          msOnCard: Math.round(nowMs() - shownAt),
        });
        index -= 1;
        clampIndex();
        shownAt = nowMs();
        render();
      });

      next.addEventListener('click', async () => {
        await store.logEvent({
          type: 'flashcards.next',
          direction: 'next',
          collectionId: active.metadata.id,
          entryId: entry?.id ?? null,
          msOnCard: Math.round(nowMs() - shownAt),
        });
        index += 1;
        clampIndex();
        shownAt = nowMs();
        render();
      });

      controls.append(prev, next);
    }

    if (batchSelector) {
      wrapper.append(headerRow, batchSelector, body, controls);
    } else {
      wrapper.append(headerRow, body, controls);
    }
  }

  clampIndex();
  render();

  // Session events
  store.logEvent({ type: 'flashcards.opened', collectionId: active.metadata.id }).catch(() => {});

  el.append(wrapper);
  return el;
}
