import { nowMs } from '../utils/helpers.js';
import { isHiraganaOrKatakana, convertRomajiIncremental, normalizeJapanese } from '../utils/japanese.js';
import { createDropdown } from '../components/dropdown.js';
import { createSpeakerButton } from '../components/ui.js';
import { createViewHeaderTools } from '../components/viewHeaderTools.js';

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
  let entries = [];
  let index = 0;
  let uiStateRestored = false;
  let shownAt = nowMs();
  let feedbackMode = false;
  let userAnswer = '';
  let isCorrect = false;
  let completed = false;

  function ensureQAFieldsAreValid() {
    const keys = new Set((Array.isArray(fields) ? fields : []).map(f => String(f?.key ?? '').trim()).filter(Boolean));
    if (!keys.size) return;
    if (!keys.has(String(questionField || '').trim())) questionField = String(fields[0]?.key ?? 'question');
    if (!keys.has(String(answerField || '').trim())) answerField = String(fields[1]?.key ?? fields[0]?.key ?? 'answer');
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
        const keys = new Set((Array.isArray(fields) ? fields : []).map(f => String(f?.key ?? '').trim()).filter(Boolean));
        if (typeof savedQ === 'string' && keys.has(savedQ)) questionField = savedQ;
        if (typeof savedA === 'string' && keys.has(savedA)) answerField = savedA;
      } catch (e) {}
    }
    const nextEntries = Array.isArray(res?.view?.entries) ? res.view.entries : [];
    entries = nextEntries;
    // Restore saved index once (prefer app-scoped bucket)
    if (!uiStateRestored) {
      const savedIndex = (collState && collState.qaCardsView && typeof collState.qaCardsView.currentIndex === 'number')
        ? collState.qaCardsView.currentIndex
        : collState.currentIndex;
      if (typeof savedIndex === 'number' && Number.isFinite(savedIndex)) {
        index = Math.max(0, Math.min(entries.length - 1, Math.round(savedIndex)));
      }
      uiStateRestored = true;
    }
    index = Math.min(Math.max(0, index), Math.max(0, entries.length - 1));
  }

  function renderHeader({ showContinue = false, onContinue = null } = {}) {
    headerTools.innerHTML = '';

    const selectorsWrap = document.createElement('div');
    selectorsWrap.className = 'qa-header-selectors';

    // Helper to build a dropdown wrapped like the data-expansion-group pattern
    function buildFieldDropdown(currentValue, onChange, captionText = null) {
      const dd = createDropdown({
        items: fields.map(f => ({ value: f.key, label: f.label ?? f.key })),
        value: currentValue,
        onChange: onChange
      });
      dd.style.minWidth = '120px';

      const group = document.createElement('div');
      group.className = 'data-expansion-group';

      // The dropdown returned by createDropdown already has class 'custom-dropdown'
      // append it directly so structure matches existing components.
      group.appendChild(dd);

      const caption = document.createElement('div');
      caption.className = 'data-expansion-caption';
      const sel = fields.find(f => f.key === currentValue);
      caption.textContent = (typeof captionText === 'string' && captionText) ? captionText : (sel?.label ?? String(currentValue || ''));
      group.appendChild(caption);

      return { group, dropdown: dd, caption };
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

    selectorsWrap.append(q.group, a.group);

    const spacer = document.createElement('div');
    spacer.className = 'qa-header-spacer';

    // Collection-level shuffle (shared action via collectionsManager)
    const shuffleBtn = document.createElement('button');
    shuffleBtn.type = 'button';
    shuffleBtn.className = 'btn small';
    shuffleBtn.textContent = 'Shuffle';
    shuffleBtn.addEventListener('click', () => {
      try {
        if (store?.collections && typeof store.collections.shuffleCollection === 'function') {
          store.collections.shuffleCollection(active?.key);
          rebuildEntriesFromCollectionState();
          index = 0;
          try { store.collections.saveCollectionState?.(active?.key, { currentIndex: 0 }, { app: 'qaCardsView' }); } catch (e) {}
          shownAt = nowMs();
          feedbackMode = false;
          userAnswer = '';
          completed = false;
          render();
        }
      } catch (e) {
        // ignore
      }
    });

    const shuffleGroup = document.createElement('div');
    shuffleGroup.className = 'data-expansion-group';
    const shuffleCaption = document.createElement('div');
    shuffleCaption.className = 'data-expansion-caption';
    shuffleCaption.textContent = 'col.shuffle';
    shuffleGroup.append(shuffleBtn, shuffleCaption);

    headerTools.append(selectorsWrap, spacer, shuffleGroup);

    if (showContinue) {
      const continueBtn = document.createElement('button');
      continueBtn.type = 'button';
      continueBtn.className = 'btn small';
      continueBtn.textContent = 'Continue';
      continueBtn.addEventListener('click', (e) => {
        if (typeof onContinue === 'function') onContinue(e);
      });
      headerTools.append(continueBtn);
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
      const currentEntry = entries[index];
      if (!currentEntry) return;
      
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
        feedbackMode = false;
        userAnswer = '';
        index += 1;
        try { store.collections.saveCollectionState?.(active?.key, { currentIndex: index }, { app: 'qaCardsView' }); } catch (e) {}
        shownAt = nowMs();
        render();
      } else {
        // Last card - show completion
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
        if (e.key === 'Enter') {
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
        </div>
      `;
      setTimeout(() => {
        const restartBtn = document.getElementById('restart-btn');
        if (restartBtn) {
          restartBtn.addEventListener('click', () => {
            index = 0;
            try { store.collections.saveCollectionState?.(active?.key, { currentIndex: 0 }, { app: 'qaCardsView' }); } catch (e) {}
            feedbackMode = false;
            userAnswer = '';
            completed = false;
            shownAt = nowMs();
            render();
          });
        }
      }, 0);
    } else if (!entry) {
      body.innerHTML = '<p class="hint">This collection has no entries yet.</p>';
    } else if (feedbackMode) {
      renderFeedback(body, entry);
    } else {
      renderCard(body, entry);
    }

    wrapper.append(cornerCaption, body);
  }

  rebuildEntriesFromCollectionState();

  if (!active) {
    wrapper.innerHTML = '<h2>QA Cards</h2><p class="hint">No active collection.</p>';
    el.append(wrapper);
    return el;
  }

  render();

  el.append(headerTools, wrapper);
  return el;
}
