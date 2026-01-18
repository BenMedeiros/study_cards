import { nowMs } from '../../utils/helpers.js';
import { shuffleArray } from '../../utils/arrays.js';
import { isHiraganaOrKatakana, convertRomajiIncremental, normalizeJapanese } from '../../utils/japanese.js';

export function getDefaultSettings() {
  return {
    questionField: null,  // First field if null
    answerField: null,    // Second field if null
    submitMethod: 'timer',
    submitTimerSeconds: 3,
    onSubmitAction: 'show_full_card',
    showFieldsOnSubmit: null,  // All fields if null
    randomize: false,
    autoAdvance: false,
    batchEnabled: false,
    batchSize: 10,
    batchLoop: true,
  };
}

export function renderQaCards({ store, onNavigate }) {
  const el = document.createElement('div');
  el.id = 'qa-cards-root';

  const wrapper = document.createElement('div');
  wrapper.className = 'card';
  wrapper.id = 'qa-cards-card';

  const active = store.getActiveCollection();
  if (!active) {
    wrapper.innerHTML = '<h2>QA Cards</h2><p class="hint">No active collection.</p>';
    el.append(wrapper);
    return el;
  }

  const settings = store.getAppSettings('qaCards');
  
  let workingEntries = settings.randomize ? shuffleArray(active.entries) : active.entries;
  let batches = [];
  let currentBatchIndex = 0;
  let index = 0;
  let shownAt = nowMs();
  let batchStartTime = nowMs();
  let submitTimer = null;
  let feedbackMode = false;
  let batchCompleted = false;
  let userAnswer = '';
  let isCorrect = false;
  let batchResults = [];
  let cardsCompletedInBatch = 0;
  let currentRenderState = null; // Track what we last rendered
  
  function resetBatchResults() {
    batchResults = [];
    batchStartTime = nowMs();
    batchCompleted = false;
    cardsCompletedInBatch = 0;
  }

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
    resetBatchResults();
  }

  if (settings.batchEnabled) {
    createBatches();
  }

  function clampIndex() {
    const batchEntries = getCurrentBatchEntries();
    const total = batchEntries.length;
    if (total === 0) {
      index = 0;
      return false;
    }
    
    if (index >= total) {
      const shouldLoop = settings.batchLoop !== false;
      if (settings.batchEnabled && !shouldLoop) {
        index = total - 1;
        return true;
      }
      index = index % total;
    } else if (index < 0) {
      index = (index + total) % total;
    }
    return false;
  }

  function renderCard(body, entry, settings) {
    const fields = Array.isArray(active.metadata.fields) ? active.metadata.fields : [];
    const questionField = settings.questionField || (fields[0]?.key ?? 'question');
    const answerField = settings.answerField || (fields[1]?.key ?? 'answer');
    const questionValue = entry[questionField] ?? '';
    const correctAnswer = String(entry[answerField] ?? '').trim();
    
    // Only enable romaji conversion if the answer contains Japanese characters
    const answerIsJapanese = /[\u3040-\u30ff]/.test(correctAnswer);

    const container = document.createElement('div');
    container.className = 'simple-card-container';
    container.style.position = 'relative';

    const question = document.createElement('div');
    question.className = 'simple-card-question';
    question.textContent = questionValue;

    const inputWrapper = document.createElement('div');
    inputWrapper.className = 'simple-card-input-wrapper';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'simple-card-input';
    const answerFieldObj = fields.find(f => f.key === answerField);
    input.placeholder = `Answer: ${answerFieldObj?.label || answerField}`;
    input.value = userAnswer;
    input.autocomplete = 'off';
    input.dataset.romajiBuffer = '';

    const submitMethod = settings.submitMethod || 'timer';
    const timerSeconds = settings.submitTimerSeconds || 3;

    function handleSubmit() {
      if (submitTimer) {
        clearTimeout(submitTimer);
        submitTimer = null;
      }

      // Read current entry dynamically
      const currentEntry = getCurrentBatchEntries()[index];
      if (!currentEntry) return;
      
      const fields = Array.isArray(active.metadata.fields) ? active.metadata.fields : [];
      const answerField = settings.answerField || (fields[1]?.key ?? 'answer');
      const correctAnswer = String(currentEntry[answerField] ?? '').trim();
      const answerIsJapanese = /[\u3040-\u30ff]/.test(correctAnswer);
      
      userAnswer = input.value.trim();
      
      // Use normalized comparison for Japanese text, case-insensitive for others
      if (answerIsJapanese) {
        isCorrect = normalizeJapanese(userAnswer) === normalizeJapanese(correctAnswer);
      } else {
        isCorrect = userAnswer.toLowerCase() === correctAnswer.toLowerCase();
      }
      
      const timeOnCard = Math.round(nowMs() - shownAt);

      store.logEvent({
        type: 'qa_cards.answer_submitted',
        collectionId: active.metadata.id,
        entryId: entry?.id ?? null,
        questionField,
        answerField,
        userAnswer,
        correctAnswer,
        isCorrect,
        msOnCard: timeOnCard,
      }).catch(() => {});
      
      if (settings.batchEnabled) {
        batchResults.push({
          entry: currentEntry,
          timeMs: timeOnCard,
          wasCorrect: isCorrect,
          userAnswer,
          correctAnswer
        });
        cardsCompletedInBatch++;
      }

      if (settings.autoAdvance && isCorrect) {
        userAnswer = '';
        feedbackMode = false;
        // Check if we've completed all cards and trying to advance
        const batchEntries = getCurrentBatchEntries();
        if (settings.batchEnabled && cardsCompletedInBatch >= batchEntries.length) {
          batchCompleted = true;
        } else {
          index += 1;
          clampIndex();
        }
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

    input.addEventListener('keydown', (e) => {
      const key = e.key;
      
      if (submitMethod === 'enter' && key === 'Enter') {
        e.preventDefault();
        handleSubmit();
        return;
      } else if (submitMethod === 'space' && key === ' ') {
        e.preventDefault();
        handleSubmit();
        return;
      }
      
      if (key === 'Backspace') {
        if (answerIsJapanese) {
          const buffer = input.dataset.romajiBuffer ?? '';
          if (buffer.length > 0) {
            e.preventDefault();
            const nextBuf = buffer.slice(0, -1);
            input.dataset.romajiBuffer = nextBuf;
            const { kana } = convertRomajiIncremental(nextBuf);
            input.value = kana;
            userAnswer = kana;
            return;
          }
        }
        setTimeout(() => {
          userAnswer = input.value;
          input.dataset.romajiBuffer = '';
        }, 0);
        return;
      }
      
      if (answerIsJapanese && isHiraganaOrKatakana(key)) {
        e.preventDefault();
        userAnswer = input.value + key;
        input.value = userAnswer;
        input.dataset.romajiBuffer = '';
        
        if (submitMethod === 'timer') {
          resetTimer();
        } else if (submitMethod === 'auto_correct') {
          if (normalizeJapanese(userAnswer) === normalizeJapanese(correctAnswer)) {
            handleSubmit();
          }
        }
        return;
      }
      
      // Handle dash/hyphen for long vowel mark
      if (answerIsJapanese && (key === '-' || key === 'ー')) {
        e.preventDefault();
        userAnswer = input.value + 'ー';
        input.value = userAnswer;
        input.dataset.romajiBuffer = '';
        
        if (submitMethod === 'timer') {
          resetTimer();
        } else if (submitMethod === 'auto_correct') {
          if (normalizeJapanese(userAnswer) === normalizeJapanese(correctAnswer)) {
            handleSubmit();
          }
        }
        return;
      }
      
      if (answerIsJapanese && /^[a-zA-Z]$/.test(key)) {
        e.preventDefault();
        const buffer = (input.dataset.romajiBuffer ?? '') + key.toLowerCase();
        const { kana, rest } = convertRomajiIncremental(buffer);
        
        input.dataset.romajiBuffer = rest;
        userAnswer = input.value.substring(0, input.value.length - (input.dataset.previousRest?.length ?? 0)) + kana + rest;
        input.value = userAnswer;
        input.dataset.previousRest = rest;
        
        if (submitMethod === 'timer') {
          resetTimer();
        } else if (submitMethod === 'auto_correct') {
          if (rest === '' && normalizeJapanese(userAnswer) === normalizeJapanese(correctAnswer)) {
            handleSubmit();
          }
        }
        return;
      }
      
      // For non-Japanese answers, handle normally
      if (!answerIsJapanese) {
        setTimeout(() => {
          userAnswer = input.value;
          if (submitMethod === 'timer') {
            resetTimer();
          } else if (submitMethod === 'auto_correct') {
            if (userAnswer.trim().toLowerCase() === correctAnswer.toLowerCase()) {
              handleSubmit();
            }
          }
        }, 0);
      }
    });

    // Handle input event for mobile keyboards
    input.addEventListener('input', (e) => {
      // Skip if we already handled this via keydown
      if (e.inputType === 'deleteContentBackward') {
        return; // Already handled in keydown
      }
      
      // Read current entry and answer dynamically
      const currentEntry = getCurrentBatchEntries()[index];
      if (!currentEntry) return;
      
      const fields = Array.isArray(active.metadata.fields) ? active.metadata.fields : [];
      const answerField = settings.answerField || (fields[1]?.key ?? 'answer');
      const correctAnswer = String(currentEntry[answerField] ?? '').trim();
      const answerIsJapanese = /[\u3040-\u30ff]/.test(correctAnswer);
      
      // For non-Japanese answers on mobile, update userAnswer and check auto-correct
      if (!answerIsJapanese) {
        userAnswer = input.value;
        
        if (submitMethod === 'timer') {
          resetTimer();
        } else if (submitMethod === 'auto_correct') {
          if (userAnswer.trim().toLowerCase() === correctAnswer.toLowerCase()) {
            handleSubmit();
          }
        }
      } else {
        // For Japanese answers, check if user typed Japanese directly (mobile IME)
        const currentValue = input.value;
        const hasJapanese = /[\u3040-\u30ff]/.test(currentValue);
        
        if (hasJapanese && currentValue !== userAnswer) {
          // User typed Japanese directly (not via romaji)
          userAnswer = currentValue;
          input.dataset.romajiBuffer = '';
          
          if (submitMethod === 'timer') {
            resetTimer();
          } else if (submitMethod === 'auto_correct') {
            if (normalizeJapanese(userAnswer) === normalizeJapanese(correctAnswer)) {
              handleSubmit();
            }
          }
        }
      }
    });

    inputWrapper.append(input);
    container.append(question, inputWrapper);
    body.append(container);

    setTimeout(() => input.focus(), 0);
  }

  function renderFeedback(body, entry, settings) {
    const fields = Array.isArray(active.metadata.fields) ? active.metadata.fields : [];
    const questionField = settings.questionField || (fields[0]?.key ?? 'question');
    const answerField = settings.answerField || (fields[1]?.key ?? 'answer');
    const onSubmitAction = settings.onSubmitAction || 'show_full_card';
    const showFieldsOnSubmit = settings.showFieldsOnSubmit;
    const questionValue = entry[questionField] ?? '';

    const container = document.createElement('div');
    container.className = 'simple-card-feedback';
    container.style.position = 'relative';
    
    // Show question field prominently
    const question = document.createElement('div');
    question.className = 'simple-card-question';
    question.textContent = questionValue;
    container.append(question);

    if (onSubmitAction === 'show_field_only') {
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

        if (field.key === answerField) {
          val.className = isCorrect ? 'correct' : 'incorrect';
        }

        row.append(key, val);
        fieldsContainer.append(row);
      }

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
  
  function renderBatchSummary(body, controls) {
    const totalTime = nowMs() - batchStartTime;
    const totalSeconds = Math.round(totalTime / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    
    body.innerHTML = '';
    controls.innerHTML = '';
    
    const summary = document.createElement('div');
    summary.style.padding = '20px';
    
    const header = document.createElement('h3');
    header.textContent = 'Batch Complete!';
    header.style.textAlign = 'center';
    header.style.marginBottom = '20px';
    summary.append(header);
    
    const totalTimeDiv = document.createElement('div');
    totalTimeDiv.style.textAlign = 'center';
    totalTimeDiv.style.marginBottom = '20px';
    totalTimeDiv.style.fontSize = '18px';
    totalTimeDiv.innerHTML = `<strong>Total Time:</strong> ${minutes}m ${seconds}s`;
    summary.append(totalTimeDiv);
    
    if (batchResults.length > 0) {
      const resultsHeader = document.createElement('h4');
      resultsHeader.textContent = 'Card Times:';
      resultsHeader.style.marginBottom = '12px';
      summary.append(resultsHeader);
      
      const resultsList = document.createElement('div');
      resultsList.style.display = 'flex';
      resultsList.style.flexDirection = 'column';
      resultsList.style.gap = '8px';
      
      const fields = Array.isArray(active.metadata.fields) ? active.metadata.fields : [];
      const questionField = settings.questionField || (fields[0]?.key ?? '');
      const answerField = settings.answerField || (fields[1]?.key ?? '');
      
      for (let i = 0; i < batchResults.length; i++) {
        const result = batchResults[i];
        const cardDiv = document.createElement('div');
        cardDiv.style.display = 'flex';
        cardDiv.style.alignItems = 'center';
        cardDiv.style.gap = '12px';
        cardDiv.style.padding = '8px 12px';
        cardDiv.style.backgroundColor = 'var(--panel)';
        cardDiv.style.borderRadius = '4px';
        
        const questionValue = result.entry[questionField] ?? '';
        const answerValue = result.entry[answerField] ?? '';
        const displayValue = `${questionValue} → ${answerValue}`;
        
        const cardNumber = document.createElement('span');
        cardNumber.style.fontWeight = 'bold';
        cardNumber.style.minWidth = '25px';
        cardNumber.style.flexShrink = '0';
        cardNumber.textContent = `${i + 1}.`;
        
        const cardContent = document.createElement('span');
        cardContent.style.flex = '1';
        cardContent.style.minWidth = '0';
        cardContent.style.overflow = 'hidden';
        cardContent.style.textOverflow = 'ellipsis';
        cardContent.style.whiteSpace = 'nowrap';
        cardContent.textContent = displayValue;
        
        const correctBadge = document.createElement('span');
        correctBadge.style.fontSize = '16px';
        correctBadge.style.flexShrink = '0';
        correctBadge.textContent = result.wasCorrect ? '✓' : '✗';
        correctBadge.style.color = result.wasCorrect ? '#4ade80' : '#ef4444';
        
        const timeSpan = document.createElement('div');
        timeSpan.className = 'badge';
        timeSpan.style.minWidth = '45px';
        timeSpan.style.flexShrink = '0';
        timeSpan.style.textAlign = 'right';
        const cardSeconds = Math.round(result.timeMs / 1000);
        timeSpan.textContent = cardSeconds < 60 ? `${cardSeconds}s` : `${Math.floor(cardSeconds / 60)}m ${cardSeconds % 60}s`;
        
        cardDiv.append(cardNumber, cardContent, correctBadge, timeSpan);
        resultsList.append(cardDiv);
      }
      
      summary.append(resultsList);
    }
    
    body.append(summary);
    
    const restartBtn = document.createElement('button');
    restartBtn.className = 'button';
    restartBtn.textContent = 'Restart Batch';
    const handleRestart = () => {
      index = 0;
      feedbackMode = false;
      userAnswer = '';
      resetBatchResults();
      shownAt = nowMs();
      render();
    };
    restartBtn.addEventListener('click', handleRestart);
    
    const cardTypeLabel = document.createElement('span');
    cardTypeLabel.id = 'qa-cards-summary-card-label';
    cardTypeLabel.style.fontSize = '11px';
    cardTypeLabel.style.color = 'var(--muted)';
    cardTypeLabel.style.opacity = '0.6';
    cardTypeLabel.style.marginLeft = 'auto';
    cardTypeLabel.textContent = 'SummaryCard';
    
    controls.append(restartBtn, cardTypeLabel);
    
    // Allow Enter key to restart batch
    const keyHandler = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleRestart();
      }
    };
    wrapper.addEventListener('keydown', keyHandler);
  }

  function render() {
    const batchEntries = getCurrentBatchEntries();
    const entry = batchEntries[index];
    const total = batchEntries.length;
    
    const newState = batchCompleted ? 'summary' : (feedbackMode ? 'feedback' : 'question');
    const stateChanged = currentRenderState !== newState;
    
    // Update position badge if it already exists (for quick updates)
    const existingPos = document.getElementById('qa-cards-position');
    if (existingPos) {
      existingPos.textContent = total ? `${index + 1} / ${total}` : 'Empty';
    }

    // If state hasn't changed and we're in question mode, just update the question text
    if (!stateChanged && newState === 'question' && entry) {
      const fields = Array.isArray(active.metadata.fields) ? active.metadata.fields : [];
      const questionField = settings.questionField || (fields[0]?.key ?? 'question');
      const questionValue = entry[questionField] ?? '';
      const questionDiv = document.querySelector('.simple-card-question');
      const inputField = document.querySelector('.simple-card-input');
      if (questionDiv && inputField) {
        questionDiv.textContent = questionValue;
        inputField.value = '';
        inputField.dataset.romajiBuffer = '';
        inputField.dataset.previousRest = '';
        userAnswer = '';
        setTimeout(() => inputField.focus(), 0);
        currentRenderState = newState;
        return; // Don't rebuild, just updated the question
      }
    }
    
    currentRenderState = newState;

    wrapper.innerHTML = '';

    const headerRow = document.createElement('div');
    headerRow.className = 'row';
    headerRow.id = 'qa-cards-header';

    const title = document.createElement('h2');
    title.id = 'qa-cards-title';
    title.style.margin = '0';
    title.style.fontSize = '18px';
    title.textContent = `QA Cards — ${active.metadata.name}`;

    const pos = document.createElement('div');
    pos.className = 'badge';
    pos.id = 'qa-cards-position';
    pos.textContent = total ? `${index + 1} / ${total}` : 'Empty';

    const settingsGear = document.createElement('button');
    settingsGear.className = 'icon-button';
    settingsGear.id = 'qa-cards-settings-gear';
    settingsGear.type = 'button';
    settingsGear.title = 'Edit settings';
    settingsGear.textContent = '⚙';
    settingsGear.style.marginLeft = 'auto';
    if (onNavigate) {
      settingsGear.addEventListener('click', () => {
        onNavigate('/settings?app=qaCards');
      });
    }

    headerRow.append(title, pos, settingsGear);

    let batchSelector = null;
    if (settings.batchEnabled && batches.length > 0) {
      batchSelector = document.createElement('div');
      batchSelector.className = 'row';
      batchSelector.id = 'qa-cards-batch-selector';
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
        resetBatchResults();
        render();
      });

      batchSelector.append(batchLabel, batchSelect);

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
    body.id = 'qa-cards-body';
    body.style.marginTop = '10px';
    
    const controls = document.createElement('div');
    controls.className = 'row';
    controls.id = 'qa-cards-controls';
    controls.style.marginTop = '6px';

    if (!entry) {
      body.innerHTML = '<p class="hint">This collection has no entries yet.</p>';
    } else if (feedbackMode) {
      renderFeedback(body, entry, settings);
    } else if (batchCompleted) {
      renderBatchSummary(body, controls);
      if (batchSelector) {
        wrapper.append(headerRow, batchSelector, body, controls);
      } else {
        wrapper.append(headerRow, body, controls);
      }
      return;
    } else {
      renderCard(body, entry, settings);
      
      // Add card type label
      const cardTypeLabel = document.createElement('span');
      cardTypeLabel.id = 'qa-cards-question-card-label';
      cardTypeLabel.style.fontSize = '11px';
      cardTypeLabel.style.color = 'var(--muted)';
      cardTypeLabel.style.opacity = '0.6';
      cardTypeLabel.style.marginLeft = 'auto';
      cardTypeLabel.textContent = 'QuestionCard';
      
      // Add "Show Answer" button when in question mode
      const showAnswerBtn = document.createElement('button');
      showAnswerBtn.className = 'button';
      showAnswerBtn.textContent = 'Show Answer';
      showAnswerBtn.style.opacity = '0.7';
      showAnswerBtn.addEventListener('click', () => {
        // Mark as incorrect and show feedback
        isCorrect = false;
        const timeOnCard = Math.round(nowMs() - shownAt);
        
        store.logEvent({
          type: 'qa_cards.answer_shown',
          collectionId: active.metadata.id,
          entryId: entry?.id ?? null,
          msOnCard: timeOnCard,
        }).catch(() => {});
        
        if (settings.batchEnabled) {
          const fields = Array.isArray(active.metadata.fields) ? active.metadata.fields : [];
          const answerField = settings.answerField || (fields[1]?.key ?? 'answer');
          const correctAnswer = String(entry[answerField] ?? '').trim();
          
          batchResults.push({
            entry,
            timeMs: timeOnCard,
            wasCorrect: false,
            userAnswer: '(shown)',
            correctAnswer
          });
          cardsCompletedInBatch++;
        }
        
        feedbackMode = true;
        render();
      });
      controls.append(showAnswerBtn, cardTypeLabel);
    }

    if (feedbackMode) {
      const handleContinue = () => {
        feedbackMode = false;
        userAnswer = '';
        // Check if we've completed all cards and trying to advance
        const batchEntries = getCurrentBatchEntries();
        if (settings.batchEnabled && cardsCompletedInBatch >= batchEntries.length) {
          batchCompleted = true;
        } else {
          index += 1;
          clampIndex();
        }
        shownAt = nowMs();
        render();
      };
      
      const continueBtn = document.createElement('button');
      continueBtn.className = 'button';
      continueBtn.textContent = 'Continue';
      continueBtn.addEventListener('click', handleContinue);
      
      const cardTypeLabel = document.createElement('span');
      cardTypeLabel.id = 'qa-cards-feedback-card-label';
      cardTypeLabel.style.fontSize = '11px';
      cardTypeLabel.style.color = 'var(--muted)';
      cardTypeLabel.style.opacity = '0.6';
      cardTypeLabel.style.marginLeft = 'auto';
      cardTypeLabel.textContent = 'FeedbackCard';
      
      controls.append(continueBtn, cardTypeLabel);
      
      // Allow typing or Enter to continue to next card
      const keyHandler = (e) => {
        if (e.key === 'Enter' || /^[a-zA-Z]$/.test(e.key) || isHiraganaOrKatakana(e.key)) {
          e.preventDefault();
          wrapper.removeEventListener('keydown', keyHandler);
          handleContinue();
        }
      };
      wrapper.addEventListener('keydown', keyHandler);
    }

    if (batchSelector) {
      wrapper.append(headerRow, batchSelector, body, controls);
    } else {
      wrapper.append(headerRow, body, controls);
    }
  }

  clampIndex();
  render();

  store.logEvent({ type: 'qa_cards.opened', collectionId: active.metadata.id }).catch(() => {});

  el.append(wrapper);
  return el;
}
