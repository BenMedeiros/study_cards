import { nowMs } from '../utils/helpers.js';
import { isHiraganaOrKatakana, convertRomajiIncremental, normalizeJapanese } from '../utils/japanese.js';
import { createDropdown } from '../components/dropdown.js';
import { createSpeakerButton } from '../components/ui.js';
import { createViewHeaderTools } from '../components/viewHeaderTools.js';
import { addShuffleControls } from '../components/collectionControls.js';

export function renderQaCards({ store }) {
  const el = document.createElement('div');
  el.id = 'qa-cards-root';

  // Header tools (standardized across views)
  const headerTools = createViewHeaderTools();
  headerTools.classList.add('qa-header-tools');

  const wrapper = document.createElement('div');
  wrapper.className = 'card';
  wrapper.id = 'qa-cards-card';

  let active = null;
  let collState = {};
  let fields = [];
  let questionField = 'question';
  let answerField = 'answer';
  let submitMethod = 'enter';
  let entries = [];
  let index = 0;
  let uiStateRestored = false;
  let shownAt = nowMs();
  let feedbackMode = false;
  let userAnswer = '';
  let isCorrect = false;
  let completed = false;
  function getEntryTimingKey(entry) {
    const k = String(store?.collections?.getEntryStudyKey?.(entry) || '').trim();
    if (k) return k;
    return String(entry?.pattern || '').trim();
  }

  const progressTracker = store?.kanjiProgress?.createCardProgressTracker?.({
    appId: 'qaCardsView',
    getCollectionKey: () => String(active?.key || '').trim(),
    getEntryKey: () => {
      if (completed) return '';
      const entry = entries && entries.length ? entries[index] : null;
      return getEntryTimingKey(entry);
    },
  });

  function ensureQAFieldsAreValid() {
    const keys = (Array.isArray(fields) ? fields : [])
      .map(f => String(f?.key ?? '').trim())
      .filter(Boolean);

    if (keys.length === 0) {
      questionField = 'question';
      answerField = 'answer';
      return;
    }

    if (!keys.includes(questionField)) {
      questionField = keys[0];
    }

    if (!keys.includes(answerField)) {
      const firstDifferent = keys.find(k => k !== questionField);
      answerField = firstDifferent || keys[0];
    }
  }

  function rebuildEntriesFromCollectionState() {
    const res = store.collections.getActiveCollectionView({ windowSize: 10 });
    active = res?.collection || null;
    collState = (res?.collState && typeof res.collState === 'object') ? res.collState : {};

    fields = Array.isArray(active?.metadata?.fields) ? active.metadata.fields : [];
    ensureQAFieldsAreValid();
    // Restore saved question/answer field choices once (store field keys, not labels)
    if (!uiStateRestored) {
      try {
        const savedQ = collState?.qaCardsView?.questionField;
        const savedA = collState?.qaCardsView?.answerField;
        const savedSubmit = collState?.qaCardsView?.submitMethod;
        const keys = new Set((Array.isArray(fields) ? fields : []).map(f => String(f?.key ?? '').trim()).filter(Boolean));
        if (typeof savedQ === 'string' && keys.has(savedQ)) questionField = savedQ;
        if (typeof savedA === 'string' && keys.has(savedA)) answerField = savedA;
        if (typeof savedSubmit === 'string' && (savedSubmit === 'enter' || savedSubmit === 'space')) submitMethod = savedSubmit;
      } catch (e) {}
    }
    const nextEntries = Array.isArray(res?.view?.entries) ? res.view.entries : [];
    entries = nextEntries;
    // Restore saved index once from app-scoped bucket only
    if (!uiStateRestored) {
      const savedIndex = (collState && collState.qaCardsView && typeof collState.qaCardsView.currentIndex === 'number')
        ? collState.qaCardsView.currentIndex
        : undefined;
      if (typeof savedIndex === 'number' && Number.isFinite(savedIndex)) {
        index = Math.max(0, Math.min(entries.length - 1, Math.round(savedIndex)));
      }
      uiStateRestored = true;
    }
    index = Math.min(Math.max(0, index), Math.max(0, entries.length - 1));
  }

  function renderHeader({ showContinue = false, onContinue = null } = {}) {
    headerTools.clear();

    const selectorsWrap = document.createElement('div');
    selectorsWrap.className = 'qa-header-selectors';

    // Helper to build a dropdown wrapped like the data-expansion-group pattern
    function buildFieldDropdown(currentValue, onChange, captionText = null) {
      const items = fields.map(f => ({ value: f.key, label: f.label ?? f.key }));
      const key = `qa-field-${captionText || currentValue}`;
      headerTools.removeControl && headerTools.removeControl(key);
      const rec = headerTools.addElement({
        type: 'dropdown', key, items, value: currentValue, onChange,
        className: '', caption: (typeof captionText === 'string' && captionText) ? captionText : null
      });
      // move the created group into the local selectorsWrap so structure matches previous layout
      if (rec && rec.group) {
        if (rec.group.parentNode) rec.group.parentNode.removeChild(rec.group);
        selectorsWrap.appendChild(rec.group);
        const dd = rec.control;
        dd.style.minWidth = '120px';
        const sel = fields.find(f => f.key === currentValue);
        return { group: rec.group, dropdown: dd, caption: rec.group.querySelector('.data-expansion-caption') };
      }
      // If headerTools.addElement didn't provide a group, throw so the error surfaces
      // (we prefer failing early rather than silently falling back to ad-hoc DOM).
      throw new Error(`headerTools.addElement did not return a group for dropdown key=${key}`);
    }

    const q = buildFieldDropdown(questionField, (value) => {
      questionField = value;
      feedbackMode = false;
      userAnswer = '';
      completed = false;
      try { store.collections.saveCollectionState?.(active?.key, { questionField: value }, { app: 'qaCardsView' }); } catch (e) {}
      render();
    }, 'Question');

    const a = buildFieldDropdown(answerField, (value) => {
      answerField = value;
      feedbackMode = false;
      userAnswer = '';
      completed = false;
      try { store.collections.saveCollectionState?.(active?.key, { answerField: value }, { app: 'qaCardsView' }); } catch (e) {}
      render();
    }, 'Answer');

    // Submit method dropdown (enter / space)
    const submitItems = [
      { value: 'enter', label: 'Enter' },
      { value: 'space', label: 'Space' },
    ];
      // Submit method dropdown
      headerTools.removeControl && headerTools.removeControl('qa-submit-method');
      const submitRec = headerTools.addElement({
        type: 'dropdown', key: 'qa-submit-method', items: submitItems, value: submitMethod,
        onChange: (value) => {
          submitMethod = value || 'enter';
          feedbackMode = false; userAnswer = ''; completed = false;
          try { store.collections.saveCollectionState?.(active?.key, { qaCardsView: { submitMethod: submitMethod } }); } catch (e) {}
          render();
        },
        className: '',
        caption: 'submit-method'
      });
      if (submitRec && submitRec.group) { if (submitRec.group.parentNode) submitRec.group.parentNode.removeChild(submitRec.group); selectorsWrap.append(submitRec.group); const dd = submitRec.control; dd.style.minWidth = '120px'; }

    const spacer = document.createElement('div');
    spacer.className = 'qa-header-spacer';


    headerTools.append(selectorsWrap, spacer);
    // Collection-level shuffle/clear-shuffle controls (use shared helper)
    try {
      addShuffleControls(headerTools, {
        store,
        onShuffle: () => {
          try { progressTracker?.flush?.({ immediate: true }); } catch (e) {}
          try { if (store?.collections && typeof store.collections.shuffleCollection === 'function') store.collections.shuffleCollection(active?.key); } catch (e) {}
          try { rebuildEntriesFromCollectionState(); } catch (e) {}
          index = 0;
          try { store.collections.saveCollectionState?.(active?.key, { currentIndex: 0 }, { app: 'qaCardsView' }); } catch (e) {}
          shownAt = nowMs();
          feedbackMode = false;
          userAnswer = '';
          completed = false;
          render();
        },
        onClearShuffle: () => {
          try { progressTracker?.flush?.({ immediate: true }); } catch (e) {}
          try { rebuildEntriesFromCollectionState(); } catch (e) {}
          index = Math.min(index, Math.max(0, entries.length - 1));
          try { store.collections.saveCollectionState?.(active?.key, { currentIndex: index }, { app: 'qaCardsView' }); } catch (e) {}
          shownAt = nowMs();
          feedbackMode = false;
          userAnswer = '';
          completed = false;
          render();
        },
      });
    } catch (e) {}

    if (showContinue) {
      headerTools.addElement({ type: 'button', key: 'continue', label: 'Continue', onClick: (e) => { if (typeof onContinue === 'function') onContinue(e); } });
    }
  }

  function renderCard(body, entry) {
    const questionValue = entry[questionField] ?? '';
    const correctAnswer = String(entry[answerField] ?? '').trim();
    
    // Only enable romaji conversion if the answer contains Japanese characters
    const answerIsJapanese = /[\u3040-\u30ff]/.test(correctAnswer);

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
    const answerFieldObj = fields.find(f => f.key === answerField);
    input.placeholder = `Answer: ${answerFieldObj?.label || answerField}`;
    input.value = userAnswer;
    input.autocomplete = 'off';
    input.dataset.romajiBuffer = '';

    function handleSubmit() {
      // Do not submit empty answers
      const trimmed = String(input.value || '').trim();
      if (!trimmed) return;

      const currentEntry = entries[index];
      if (!currentEntry) return;

      const correctAnswer = String(currentEntry[answerField] ?? '').trim();
      const answerIsJapanese = /[\u3040-\u30ff]/.test(correctAnswer);

      userAnswer = trimmed;
      
      // Use normalized comparison for Japanese text, case-insensitive for others
      if (answerIsJapanese) {
        isCorrect = normalizeJapanese(userAnswer) === normalizeJapanese(correctAnswer);
      } else {
        isCorrect = userAnswer.toLowerCase() === correctAnswer.toLowerCase();
      }
      
      const timeOnCard = Math.round(nowMs() - shownAt);

      feedbackMode = true;
      render();
    }

    input.addEventListener('keydown', (e) => {
      const key = e.key;
      
      // Only Enter key submits
      if (key === 'Enter') {
        e.preventDefault();
        e.stopPropagation(); // Prevent event from bubbling to wrapper
        handleSubmit();
        return;
      }

      // Space can act as a submit method when configured
      if ((key === ' ' || key === 'Spacebar' || key === 'Space') && submitMethod === 'space') {
        // Decide hard vs soft check based on whether the correct answer contains a space
        // Prevent submission if input is empty
        const trimmed = String(input.value || '').trim();
        if (!trimmed) return;

        const currentEntry = entries[index];
        const correctAnswer = String(currentEntry?.[answerField] ?? '').trim();
        if (!correctAnswer.includes(' ')) {
          e.preventDefault();
          e.stopPropagation();
          handleSubmit();
          return;
        }
        // If correct answer contains spaces, allow the space to be inserted (soft check)
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
        return;
      }
      
      // Handle dash/hyphen for long vowel mark
      if (answerIsJapanese && (key === '-' || key === 'ー')) {
        e.preventDefault();
        userAnswer = input.value + 'ー';
        input.value = userAnswer;
        input.dataset.romajiBuffer = '';
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
        return;
      }
      
      // For non-Japanese answers, handle normally
      if (!answerIsJapanese) {
        setTimeout(() => {
          userAnswer = input.value;
        }, 0);
      }
    });

    // Handle input event for mobile keyboards
    input.addEventListener('input', (e) => {
      if (e.inputType === 'deleteContentBackward') {
        return; // Already handled in keydown
      }
      
      const currentEntry = entries[index];
      if (!currentEntry) return;
      
      const correctAnswer = String(currentEntry[answerField] ?? '').trim();
      const answerIsJapanese = /[\u3040-\u30ff]/.test(correctAnswer);
      
      // For non-Japanese answers on mobile, update userAnswer
      if (!answerIsJapanese) {
        userAnswer = input.value;
      } else {
        // For Japanese answers, check if user typed Japanese directly (mobile IME)
        const currentValue = input.value;
        const hasJapanese = /[\u3040-\u30ff]/.test(currentValue);
        
        if (hasJapanese && currentValue !== userAnswer) {
          // User typed Japanese directly (not via romaji)
          userAnswer = currentValue;
          input.dataset.romajiBuffer = '';
        }
      }
    });

    inputWrapper.append(input);
    container.append(question, inputWrapper);
    body.append(container);

    setTimeout(() => input.focus(), 0);
  }

  function renderFeedback(body, entry) {
    const questionValue = entry[questionField] ?? '';

    const container = document.createElement('div');
    container.className = 'simple-card-feedback';
    container.style.position = 'relative';
    
    // Show question field prominently
    const question = document.createElement('div');
    question.className = 'simple-card-question';
    question.textContent = questionValue;
    container.append(question);

    // Show all fields
    const fieldsContainer = document.createElement('div');
    fieldsContainer.className = 'feedback-fields';

    for (const field of fields) {
      const row = document.createElement('div');
      row.className = 'kv';
      const key = document.createElement('div');
      key.className = 'k';
      key.textContent = field.label ?? field.key;

      const val = document.createElement('div');
      const fieldValue = entry[field.key] ?? '';
      val.textContent = fieldValue;

      if (field.key === answerField) {
        val.className = isCorrect ? 'correct' : 'incorrect';
      }

      // Add speaker button for Japanese fields only
      const shouldHaveSpeaker = ['kanji', 'reading', 'japaneseName'].includes(field.key);
      if (shouldHaveSpeaker && fieldValue) {
        const speakerBtn = createSpeakerButton({
          text: fieldValue,
          fieldKey: field.key,
          collectionCategory: active.metadata.category
        });
        
        const valWrapper = document.createElement('div');
        valWrapper.style.display = 'flex';
        valWrapper.style.alignItems = 'center';
        valWrapper.appendChild(val);
        valWrapper.appendChild(speakerBtn);
        row.append(key, valWrapper);
      } else {
        row.append(key, val);
      }

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
    body.append(container);
  }

  function render() {
    const entry = entries[index];
    const total = entries.length;

    wrapper.innerHTML = '';
    wrapper.tabIndex = 0; // Make wrapper focusable for Enter key

    const cornerCaption = document.createElement('div');
    cornerCaption.className = 'card-corner-caption';
    cornerCaption.textContent = total ? `${index + 1} / ${total}` : 'Empty';

    const handleContinue = () => {
      if (index < total - 1) {
        try { progressTracker?.flush?.({ immediate: true }); } catch (e) {}
        feedbackMode = false;
        userAnswer = '';
        index += 1;
        try { store.collections.saveCollectionState?.(active?.key, { currentIndex: index }, { app: 'qaCardsView' }); } catch (e) {}
        shownAt = nowMs();
        render();
      } else {
        // Last card - show completion
        try { progressTracker?.flush?.({ immediate: true }); } catch (e) {}
        completed = true;
        try { store.collections.saveCollectionState?.(active?.key, { currentIndex: index }, { app: 'qaCardsView' }); } catch (e) {}
        render();
      }
    };

    // Header tools (question/answer selectors + shuffle + continue)
    renderHeader({ showContinue: !!feedbackMode && !completed, onContinue: handleContinue });

    if (feedbackMode && !completed) {
      // Allow Enter to continue to next card
      const keyHandler = (e) => {
        if (e.key === 'Enter' || (submitMethod === 'space' && (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Space'))) {
          e.preventDefault();
          wrapper.removeEventListener('keydown', keyHandler);
          handleContinue();
        }
      };
      wrapper.addEventListener('keydown', keyHandler);

      // Focus wrapper so Enter key works immediately
      setTimeout(() => wrapper.focus(), 0);
    }

    const body = document.createElement('div');
    body.id = 'qa-cards-body';

    if (completed) {
      body.innerHTML = `
        <div class="simple-card-feedback">
          <h3>🎉 Completed!</h3>
          <p>You've finished all ${total} cards in this collection.</p>
          <button class="button" id="restart-btn" >Start Over</button>
          <div class="hint small">Press Space or Enter to start over</div>
        </div>
      `;
      setTimeout(() => {
        const restartBtn = document.getElementById('restart-btn');
        if (restartBtn) {
          restartBtn.addEventListener('click', () => {
            try { progressTracker?.flush?.({ immediate: true }); } catch (e) {}
            index = 0;
            try { store.collections.saveCollectionState?.(active?.key, { currentIndex: 0 }, { app: 'qaCardsView' }); } catch (e) {}
            feedbackMode = false;
            userAnswer = '';
            completed = false;
            shownAt = nowMs();
            render();
          });
        }
        // Allow Enter or Space to restart as well
        const keyHandlerRestart = (e) => {
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar' || e.key === 'Space') {
            e.preventDefault();
            wrapper.removeEventListener('keydown', keyHandlerRestart);
            try { progressTracker?.flush?.({ immediate: true }); } catch (e) {}
            index = 0;
            try { store.collections.saveCollectionState?.(active?.key, { currentIndex: 0 }, { app: 'qaCardsView' }); } catch (e) {}
            feedbackMode = false;
            userAnswer = '';
            completed = false;
            shownAt = nowMs();
            render();
          }
        };
        wrapper.addEventListener('keydown', keyHandlerRestart);
        setTimeout(() => wrapper.focus(), 0);
      }, 0);
    } else if (!entry) {
      body.innerHTML = '<p class="hint">This collection has no entries yet.</p>';
    } else if (feedbackMode) {
      renderFeedback(body, entry);
    } else {
      renderCard(body, entry);
    }

    wrapper.append(cornerCaption, body);
    try { progressTracker?.syncToCurrent?.(); } catch (e) {}
  }

  rebuildEntriesFromCollectionState();

  if (!active) {
    wrapper.innerHTML = '<h2>QA Cards</h2><p class="hint">No active collection.</p>';
    el.append(wrapper);
    return el;
  }

  render();

  // Cleanup on unmount
  const observer = new MutationObserver(() => {
    if (!document.body.contains(el)) {
      try { progressTracker?.teardown?.(); } catch (e) {}
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  el.append(headerTools, wrapper);
  return el;
}
