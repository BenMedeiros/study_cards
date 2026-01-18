import { nowMs } from '../../utils/time.js';

function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function getDefaultSettings() {
  return {
    displayFieldKeys: null,  // null = show all fields
    randomize: false,
    batchEnabled: false,
    batchSize: 10,
    batchLoop: true,
  };
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

  const settings = store.getAppSettings('flashcards');
  
  let workingEntries = settings.randomize ? shuffleArray(active.entries) : active.entries;
  let batches = [];
  let currentBatchIndex = 0;
  let index = 0;
  let shownAt = nowMs();
  let batchStartTime = nowMs();
  let batchCompleted = false;
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
      const firstField = fields[0]?.key ?? '';
      
      for (let i = 0; i < batchResults.length; i++) {
        const result = batchResults[i];
        const cardDiv = document.createElement('div');
        cardDiv.className = 'kv';
        cardDiv.style.padding = '8px';
        cardDiv.style.backgroundColor = 'var(--panel)';
        cardDiv.style.borderRadius = '4px';
        
        const displayValue = result.entry[firstField] ?? '';
        
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
          render();
        });
        batchSelector.append(reshuffleBtn);
      }
    }

    const body = document.createElement('div');
    body.id = 'flashcards-body';
    body.style.marginTop = '10px';
    
    const controls = document.createElement('div');
    controls.className = 'row';
    controls.id = 'flashcards-controls';
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
    } else {
      renderCard(body, entry, settings);
    }

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
        type: 'flashcards.prev',
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
      const timeOnCard = Math.round(nowMs() - shownAt);
      await store.logEvent({
        type: 'flashcards.next',
        collectionId: active.metadata.id,
        entryId: entry?.id ?? null,
        msOnCard: timeOnCard,
      });
      
      if (settings.batchEnabled) {
        batchResults.push({
          entry,
          timeMs: timeOnCard,
        });
      }
      
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
    });

    controls.append(prev, next);

    if (batchSelector) {
      wrapper.append(headerRow, batchSelector, body, controls);
    } else {
      wrapper.append(headerRow, body, controls);
    }
  }

  clampIndex();
  render();

  store.logEvent({ type: 'flashcards.opened', collectionId: active.metadata.id }).catch(() => {});

  el.append(wrapper);
  return el;
}
