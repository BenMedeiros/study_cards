import { nowMs } from '../../utils/time.js';

function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function isVowel(ch) {
  return ch === 'a' || ch === 'i' || ch === 'u' || ch === 'e' || ch === 'o';
}

function isHiraganaOrKatakana(ch) {
  return /[\u3040-\u30ff]/.test(ch);
}

// Romaji -> hiragana mapping
const ROMAJI_MAP = {
  a: 'あ', i: 'い', u: 'う', e: 'え', o: 'お',

  ka: 'か', ki: 'き', ku: 'く', ke: 'け', ko: 'こ',
  sa: 'さ', shi: 'し', si: 'し', su: 'す', se: 'せ', so: 'そ',
  ta: 'た', chi: 'ち', ti: 'ち', tsu: 'つ', tu: 'つ', te: 'て', to: 'と',
  na: 'な', ni: 'に', nu: 'ぬ', ne: 'ね', no: 'の',
  ha: 'は', hi: 'ひ', fu: 'ふ', hu: 'ふ', he: 'へ', ho: 'ほ',
  ma: 'ま', mi: 'み', mu: 'む', me: 'め', mo: 'も',
  ya: 'や', yu: 'ゆ', yo: 'よ',
  ra: 'ら', ri: 'り', ru: 'る', re: 'れ', ro: 'ろ',
  wa: 'わ', wo: 'を', n: 'ん',

  ga: 'が', gi: 'ぎ', gu: 'ぐ', ge: 'げ', go: 'ご',
  za: 'ざ', ji: 'じ', zi: 'じ', zu: 'ず', ze: 'ぜ', zo: 'ぞ',
  da: 'だ', di: 'ぢ', du: 'づ', de: 'で', do: 'ど',
  ba: 'ば', bi: 'び', bu: 'ぶ', be: 'べ', bo: 'ぼ',
  pa: 'ぱ', pi: 'ぴ', pu: 'ぷ', pe: 'ぺ', po: 'ぽ',

  kya: 'きゃ', kyu: 'きゅ', kyo: 'きょ',
  gya: 'ぎゃ', gyu: 'ぎゅ', gyo: 'ぎょ',
  sha: 'しゃ', shu: 'しゅ', sho: 'しょ',
  sya: 'しゃ', syu: 'しゅ', syo: 'しょ',
  ja: 'じゃ', ju: 'じゅ', jo: 'じょ',
  jya: 'じゃ', jyu: 'じゅ', jyo: 'じょ',
  cha: 'ちゃ', chu: 'ちゅ', cho: 'ちょ',
  cya: 'ちゃ', cyu: 'ちゅ', cyo: 'ちょ',
  nya: 'にゃ', nyu: 'にゅ', nyo: 'にょ',
  hya: 'ひゃ', hyu: 'ひゅ', hyo: 'ひょ',
  bya: 'びゃ', byu: 'びゅ', byo: 'びょ',
  pya: 'ぴゃ', pyu: 'ぴゅ', pyo: 'ぴょ',
  mya: 'みゃ', myu: 'みゅ', myo: 'みょ',
  rya: 'りゃ', ryu: 'りゅ', ryo: 'りょ',

  xa: 'ぁ', xi: 'ぃ', xu: 'ぅ', xe: 'ぇ', xo: 'ぉ',
  la: 'ぁ', li: 'ぃ', lu: 'ぅ', le: 'ぇ', lo: 'ぉ',
  xya: 'ゃ', xyu: 'ゅ', xyo: 'ょ',
  lya: 'ゃ', lyu: 'ゅ', lyo: 'ょ',
  xtsu: 'っ', ltsu: 'っ',
};

function convertRomajiIncremental(buffer) {
  let i = 0;
  let out = '';
  const s = String(buffer ?? '').toLowerCase();

  while (i < s.length) {
    const ch = s[i];

    if (!/[a-z]/.test(ch)) {
      i++;
      continue;
    }

    if (ch === 'n') {
      const next = s[i + 1];
      if (!next) {
        return { kana: out, rest: s.slice(i) };
      }
      if (next === 'n') {
        out += 'ん';
        i += 2;
        continue;
      }
      if (isVowel(next) || next === 'y') {
        // Part of syllable
      } else {
        out += 'ん';
        i += 1;
        continue;
      }
    }

    const next = s[i + 1];
    if (next && ch === next && !isVowel(ch) && ch !== 'n') {
      out += 'っ';
      i += 1;
      continue;
    }

    const tri = s.slice(i, i + 3);
    const bi = s.slice(i, i + 2);
    const uni = s.slice(i, i + 1);

    if (ROMAJI_MAP[tri]) {
      out += ROMAJI_MAP[tri];
      i += 3;
      continue;
    }
    if (ROMAJI_MAP[bi]) {
      out += ROMAJI_MAP[bi];
      i += 2;
      continue;
    }
    if (ROMAJI_MAP[uni]) {
      out += ROMAJI_MAP[uni];
      i += 1;
      continue;
    }

    return { kana: out, rest: s.slice(i) };
  }

  return { kana: out, rest: '' };
}

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

export function renderQaCards({ store }) {
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
  
  function resetBatchResults() {
    batchResults = [];
    batchStartTime = nowMs();
    batchCompleted = false;
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
    input.dataset.romajiBuffer = '';

    const submitMethod = settings.submitMethod || 'timer';
    const timerSeconds = settings.submitTimerSeconds || 3;

    function handleSubmit() {
      if (submitTimer) {
        clearTimeout(submitTimer);
        submitTimer = null;
      }

      const correctAnswer = String(entry[answerField] ?? '').trim();
      userAnswer = input.value.trim();
      isCorrect = userAnswer.toLowerCase() === correctAnswer.toLowerCase();
      
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
          entry,
          timeMs: timeOnCard,
          wasCorrect: isCorrect,
          userAnswer,
          correctAnswer
        });
      }

      if (settings.autoAdvance && isCorrect) {
        userAnswer = '';
        feedbackMode = false;
        index += 1;
        const completed = clampIndex();
        if (completed) {
          batchCompleted = true;
          index -= 1;
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
        setTimeout(() => {
          userAnswer = input.value;
          input.dataset.romajiBuffer = '';
        }, 0);
        return;
      }
      
      if (isHiraganaOrKatakana(key)) {
        e.preventDefault();
        userAnswer = input.value + key;
        input.value = userAnswer;
        input.dataset.romajiBuffer = '';
        
        if (submitMethod === 'timer') {
          resetTimer();
        } else if (submitMethod === 'auto_correct') {
          const correctAnswer = String(entry[answerField] ?? '').trim();
          if (userAnswer.toLowerCase() === correctAnswer.toLowerCase()) {
            handleSubmit();
          }
        }
        return;
      }
      
      if (/^[a-zA-Z]$/.test(key)) {
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
          const correctAnswer = String(entry[answerField] ?? '').trim();
          if (rest === '' && userAnswer.toLowerCase() === correctAnswer.toLowerCase()) {
            handleSubmit();
          }
        }
        return;
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

    const container = document.createElement('div');
    container.className = 'simple-card-feedback';

    const statusBadge = document.createElement('div');
    statusBadge.className = `feedback-badge ${isCorrect ? 'correct' : 'incorrect'}`;
    statusBadge.textContent = isCorrect ? '✓ Correct' : '✗ Incorrect';
    container.append(statusBadge);

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
      resultsList.style.maxHeight = '400px';
      resultsList.style.overflowY = 'auto';
      
      const fields = Array.isArray(active.metadata.fields) ? active.metadata.fields : [];
      const questionField = settings.questionField || (fields[0]?.key ?? '');
      const answerField = settings.answerField || (fields[1]?.key ?? '');
      
      for (let i = 0; i < batchResults.length; i++) {
        const result = batchResults[i];
        const cardDiv = document.createElement('div');
        cardDiv.className = 'kv';
        cardDiv.style.padding = '8px';
        cardDiv.style.backgroundColor = 'var(--panel)';
        cardDiv.style.borderRadius = '4px';
        
        const questionValue = result.entry[questionField] ?? '';
        const answerValue = result.entry[answerField] ?? '';
        const displayValue = `${questionValue} → ${answerValue}`;
        
        const cardInfo = document.createElement('div');
        cardInfo.style.flex = '1';
        cardInfo.style.display = 'flex';
        cardInfo.style.alignItems = 'center';
        cardInfo.style.gap = '8px';
        
        const cardNumber = document.createElement('span');
        cardNumber.style.fontWeight = 'bold';
        cardNumber.style.minWidth = '30px';
        cardNumber.textContent = `${i + 1}.`;
        
        const cardContent = document.createElement('span');
        cardContent.textContent = String(displayValue).substring(0, 70);
        if (String(displayValue).length > 70) cardContent.textContent += '...';
        
        cardInfo.append(cardNumber, cardContent);
        
        const correctBadge = document.createElement('span');
        correctBadge.style.marginLeft = '8px';
        correctBadge.style.fontSize = '14px';
        correctBadge.textContent = result.wasCorrect ? '✓' : '✗';
        correctBadge.style.color = result.wasCorrect ? '#4ade80' : '#ef4444';
        cardInfo.append(correctBadge);
        
        const timeSpan = document.createElement('div');
        timeSpan.className = 'badge';
        const cardSeconds = Math.round(result.timeMs / 1000);
        timeSpan.textContent = cardSeconds < 60 ? `${cardSeconds}s` : `${Math.floor(cardSeconds / 60)}m ${cardSeconds % 60}s`;
        
        cardDiv.append(cardInfo, timeSpan);
        resultsList.append(cardDiv);
      }
      
      summary.append(resultsList);
    }
    
    body.append(summary);
    
    const restartBtn = document.createElement('button');
    restartBtn.className = 'button';
    restartBtn.textContent = 'Restart Batch';
    restartBtn.addEventListener('click', () => {
      index = 0;
      feedbackMode = false;
      userAnswer = '';
      resetBatchResults();
      shownAt = nowMs();
      render();
    });
    
    controls.append(restartBtn);
  }

  function render() {
    const batchEntries = getCurrentBatchEntries();
    const entry = batchEntries[index];
    const total = batchEntries.length;

    wrapper.innerHTML = '';

    const headerRow = document.createElement('div');
    headerRow.className = 'row';
    headerRow.id = 'qa-cards-header';

    const title = document.createElement('h2');
    title.id = 'qa-cards-title';
    title.style.margin = '0';
    title.textContent = `QA Cards — ${active.metadata.name}`;

    const pos = document.createElement('div');
    pos.className = 'badge';
    pos.id = 'qa-cards-position';
    pos.textContent = total ? `${index + 1} / ${total}` : 'Empty';

    headerRow.append(title, pos);

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
    controls.style.marginTop = '12px';

    if (batchCompleted) {
      renderBatchSummary(body, controls);
      if (batchSelector) {
        wrapper.append(headerRow, batchSelector, body, controls);
      } else {
        wrapper.append(headerRow, body, controls);
      }
      return;
    }

    if (!entry) {
      body.innerHTML = '<p class="hint">This collection has no entries yet.</p>';
    } else if (feedbackMode) {
      renderFeedback(body, entry, settings);
    } else {
      renderCard(body, entry, settings);
    }

    if (feedbackMode) {
      const handleContinue = () => {
        feedbackMode = false;
        userAnswer = '';
        index += 1;
        const completed = clampIndex();
        if (completed) {
          index -= 1;
          batchCompleted = true;
          render();
          return;
        }
        shownAt = nowMs();
        render();
      };
      
      const continueBtn = document.createElement('button');
      continueBtn.className = 'button';
      continueBtn.textContent = 'Continue';
      continueBtn.addEventListener('click', handleContinue);
      controls.append(continueBtn);
      
      // Allow typing to continue to next card
      const keyHandler = (e) => {
        if (/^[a-zA-Z]$/.test(e.key) || isHiraganaOrKatakana(e.key)) {
          e.preventDefault();
          handleContinue();
        }
      };
      wrapper.addEventListener('keydown', keyHandler);
      
      // Clean up listener when moving to next card
      const originalRender = render;
      render = function() {
        wrapper.removeEventListener('keydown', keyHandler);
        render = originalRender;
        originalRender();
      };
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
