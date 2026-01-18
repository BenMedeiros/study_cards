import { isHiraganaOrKatakana, convertRomajiIncremental, splitKana } from '../../utils/japanese.js';

function normalizeAnswer(reading) {
  // Minimal: keep only kana; remove spaces/slashes/etc.
  const chars = splitKana(reading).filter((c) => isHiraganaOrKatakana(c));
  return chars.join('');
}

function tryPlaceWord(grid, wordChars, row, col, dir) {
  const size = grid.length;
  const dr = dir === 'down' ? 1 : 0;
  const dc = dir === 'across' ? 1 : 0;

  // Bounds
  const endRow = row + dr * (wordChars.length - 1);
  const endCol = col + dc * (wordChars.length - 1);
  if (row < 0 || col < 0 || endRow >= size || endCol >= size) return false;

  // Check conflicts and require at least one overlap when placing after the first.
  let overlaps = 0;
  for (let i = 0; i < wordChars.length; i++) {
    const r = row + dr * i;
    const c = col + dc * i;
    const existing = grid[r][c];
    if (existing && existing !== wordChars[i]) return false;
    if (existing === wordChars[i]) overlaps++;
  }

  // Light adjacency rule (avoid touching words without crossing)
  // For each letter cell, ensure perpendicular neighbors are empty unless crossing.
  for (let i = 0; i < wordChars.length; i++) {
    const r = row + dr * i;
    const c = col + dc * i;
    const isCrossing = grid[r][c] === wordChars[i];

    if (dir === 'across') {
      const up = r - 1;
      const down = r + 1;
      if (!isCrossing) {
        if (up >= 0 && grid[up][c]) return false;
        if (down < size && grid[down][c]) return false;
      }
    } else {
      const left = c - 1;
      const right = c + 1;
      if (!isCrossing) {
        if (left >= 0 && grid[r][left]) return false;
        if (right < size && grid[r][right]) return false;
      }
    }
  }

  // Ensure cells just before/after are empty (word boundaries)
  const beforeR = row - dr;
  const beforeC = col - dc;
  const afterR = endRow + dr;
  const afterC = endCol + dc;
  if (beforeR >= 0 && beforeC >= 0 && beforeR < size && beforeC < size && grid[beforeR][beforeC]) return false;
  if (afterR >= 0 && afterC >= 0 && afterR < size && afterC < size && grid[afterR][afterC]) return false;

  // Place
  for (let i = 0; i < wordChars.length; i++) {
    const r = row + dr * i;
    const c = col + dc * i;
    grid[r][c] = wordChars[i];
  }

  return { overlaps };
}

function buildCrossword(words, { size = 13, maxWords = 12 } = {}) {
  const grid = Array.from({ length: size }, () => Array.from({ length: size }, () => null));

  const answerLen = (answer) => splitKana(answer).length;

  const shuffleInPlace = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  const candidates = words
    .map((w) => ({ ...w, answer: normalizeAnswer(w.reading) }))
    .filter((w) => answerLen(w.answer) >= 2);

  // Shuffle first so we don't get the exact same puzzle every time.
  shuffleInPlace(candidates);
  // Prefer longer first, but break ties randomly.
  candidates.sort((a, b) => {
    const d = answerLen(b.answer) - answerLen(a.answer);
    if (d !== 0) return d;
    return Math.random() < 0.5 ? -1 : 1;
  });

  const placed = [];
  if (candidates.length === 0) return { size, grid, placed: [] };

  // First word in center, across.
  // Pick randomly from the top few to vary puzzles.
  const firstPool = candidates.slice(0, Math.min(8, candidates.length));
  const first = firstPool[Math.floor(Math.random() * firstPool.length)];
  const firstChars = splitKana(first.answer);
  const startRow = Math.floor(size / 2);
  const startCol = Math.floor((size - firstChars.length) / 2);
  const ok = tryPlaceWord(grid, firstChars, startRow, startCol, 'across');
  if (!ok) return { size, grid, placed: [] };
  placed.push({
    id: first.id,
    kanji: first.kanji,
    meaning: first.meaning,
    reading: first.reading,
    answer: first.answer,
    row: startRow,
    col: startCol,
    dir: 'across',
    number: 0,
  });

  const rest = candidates.filter((c) => c.id !== first.id);
  for (const w of rest) {
    if (placed.length >= maxWords) break;
    const chars = splitKana(w.answer);

    let best = null;

    // Find intersections with existing letters (randomize scan order so puzzles vary).
    const filled = [];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (grid[r][c]) filled.push([r, c]);
      }
    }
    shuffleInPlace(filled);

    const dirOrder = Math.random() < 0.5 ? ['across', 'down'] : ['down', 'across'];

    for (const [r, c] of filled) {
      const existing = grid[r][c];
      if (!existing) continue;

      const idxs = chars.map((_, i) => i);
      shuffleInPlace(idxs);

      for (const i of idxs) {
        if (chars[i] !== existing) continue;

        for (const dir of dirOrder) {
          if (dir === 'across') {
            const acrossCol = c - i;
            const across = tryPlaceWord(grid, chars, r, acrossCol, 'across');
            if (across) {
              best = { row: r, col: acrossCol, dir: 'across', overlaps: across.overlaps };
              placed.push({
                id: w.id,
                kanji: w.kanji,
                meaning: w.meaning,
                reading: w.reading,
                answer: w.answer,
                row: r,
                col: acrossCol,
                dir: 'across',
                number: 0,
              });
              best = null;
              break;
            }
          } else {
            const downRow = r - i;
            const down = tryPlaceWord(grid, chars, downRow, c, 'down');
            if (down) {
              placed.push({
                id: w.id,
                kanji: w.kanji,
                meaning: w.meaning,
                reading: w.reading,
                answer: w.answer,
                row: downRow,
                col: c,
                dir: 'down',
                number: 0,
              });
              best = null;
              break;
            }
          }
        }
        if (best === null && placed.length && placed[placed.length - 1].id === w.id) break;
      }
      if (placed.length && placed[placed.length - 1].id === w.id) break;
    }
  }

  // Trim empty borders (optional). Keep simple: compute used bounds and return a smaller view.
  let minR = size, minC = size, maxR = -1, maxC = -1;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r][c]) {
        minR = Math.min(minR, r);
        minC = Math.min(minC, c);
        maxR = Math.max(maxR, r);
        maxC = Math.max(maxC, c);
      }
    }
  }

  if (maxR < 0) return { size, grid, placed: [] };

  const outH = maxR - minR + 1;
  const outW = maxC - minC + 1;
  const outGrid = Array.from({ length: outH }, (_, rr) =>
    Array.from({ length: outW }, (_, cc) => grid[minR + rr][minC + cc])
  );

  const outPlaced = placed.map((p) => ({ ...p, row: p.row - minR, col: p.col - minC }));

  // Standard crossword numbering:
  // A number is assigned to a START cell (row-major). If both an Across and Down
  // word start at the same cell, they share the same number.
  const startCells = new Map();
  for (const p of outPlaced) {
    const key = `${p.row},${p.col}`;
    if (!startCells.has(key)) startCells.set(key, { row: p.row, col: p.col });
  }

  const sortedStarts = Array.from(startCells.values()).sort((a, b) => (a.row - b.row) || (a.col - b.col));
  const numberByKey = new Map();
  for (let i = 0; i < sortedStarts.length; i++) {
    const s = sortedStarts[i];
    numberByKey.set(`${s.row},${s.col}`, i + 1);
  }

  const numberedPlaced = outPlaced.map((p) => ({ ...p, number: numberByKey.get(`${p.row},${p.col}`) ?? 0 }));

  return { size: Math.max(outH, outW), width: outW, height: outH, grid: outGrid, placed: numberedPlaced };
}

export function renderCrossword({ store }) {
  const el = document.createElement('div');
  el.id = 'crossword-root';
  const active = store.getActiveCollection();

  const wrapper = document.createElement('div');
  wrapper.className = 'card';
  wrapper.id = 'crossword-card';

  if (!active) {
    wrapper.innerHTML = '<h2>Crossword</h2><p class="hint">No active collection.</p>';
    el.append(wrapper);
    return el;
  }

  let maxWords = 14; // Default max words

  function getWordList() {
    return (active.entries ?? []).map((e) => ({
      id: e.id,
      kanji: e.kanji,
      reading: e.reading,
      meaning: e.meaning,
    }));
  }

  function generatePuzzle() {
    const list = getWordList();

    const valid = list
      .map((w) => ({ ...w, answer: normalizeAnswer(w.reading) }))
      .filter((w) => splitKana(w.answer).length >= 2);

    const actualMaxWords = Math.max(4, Math.min(Math.floor(maxWords || 14), valid.length || 4));

    // The placement is heuristic, so one attempt may place fewer than maxWords.
    // Try multiple randomized builds and keep the best result.
    let best = null;
    const attempts = 30;
    for (let i = 0; i < attempts; i++) {
      const p = buildCrossword(valid, { size: 13, maxWords: actualMaxWords });
      if (!best || (p?.placed?.length ?? 0) > (best?.placed?.length ?? 0)) best = p;
      if ((best?.placed?.length ?? 0) >= actualMaxWords) break;
    }

    best.maxWords = actualMaxWords;
    best.requestedMaxWords = maxWords;
    return best;
  }

  let puzzle = null;

  function renderPuzzle() {
    wrapper.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'row';
    header.id = 'crossword-header';

    const title = document.createElement('h2');
    title.id = 'crossword-title';
    title.style.margin = '0';
    title.textContent = `Crossword — ${active.metadata.name}`;

    const actions = document.createElement('div');
    actions.className = 'row';
    actions.id = 'crossword-actions';

    const maxWordsLabel = document.createElement('span');
    maxWordsLabel.className = 'hint';
    maxWordsLabel.textContent = 'Max words:';

    const maxWordsInput = document.createElement('input');
    maxWordsInput.type = 'number';
    maxWordsInput.className = 'button';
    maxWordsInput.style.width = '60px';
    maxWordsInput.min = '4';
    maxWordsInput.max = '30';
    maxWordsInput.value = String(maxWords);
    maxWordsInput.addEventListener('change', () => {
      const val = parseInt(maxWordsInput.value, 10);
      if (val >= 4 && val <= 30) {
        maxWords = val;
      }
    });

    const newBtn = document.createElement('button');
    newBtn.className = 'button';
    newBtn.id = 'crossword-new';
    newBtn.name = 'newPuzzle';
    newBtn.textContent = 'New puzzle';

    const checkBtn = document.createElement('button');
    checkBtn.className = 'button';
    checkBtn.id = 'crossword-check';
    checkBtn.name = 'check';
    checkBtn.textContent = 'Check';

    const revealBtn = document.createElement('button');
    revealBtn.className = 'button';
    revealBtn.id = 'crossword-reveal';
    revealBtn.name = 'reveal';
    revealBtn.textContent = 'Reveal';

    actions.append(maxWordsLabel, maxWordsInput, newBtn, checkBtn, revealBtn);
    header.append(title, actions);

    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.id = 'crossword-hint';
    hint.style.marginTop = '8px';
    const placedCount = puzzle?.placed?.length ?? 0;
    const targetMaxWords = puzzle?.maxWords ?? maxWords;
    hint.textContent = `Clue = kanji. Fill = reading (kana). Type romaji (e.g. kyo -> きょ). Placed: ${placedCount}/${targetMaxWords}`;

    const body = document.createElement('div');
    body.className = 'crossword';
    body.id = 'crossword-body';

    if (!puzzle || puzzle.placed.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = 'Not enough valid kana readings to build a crossword.';
      wrapper.append(header, hint, empty);
      return;
    }

    // Build cell -> number mapping
    const numberAt = new Map();
    for (const p of puzzle.placed) {
      const key = `${p.row},${p.col}`;
      if (!numberAt.has(key)) numberAt.set(key, p.number);
    }

    const gridEl = document.createElement('div');
    gridEl.className = 'crossword-grid';
    gridEl.id = 'crossword-grid';
    gridEl.style.setProperty('--cw-cols', String(puzzle.width));

    for (let r = 0; r < puzzle.height; r++) {
      for (let c = 0; c < puzzle.width; c++) {
        const sol = puzzle.grid[r][c];
        const cell = document.createElement('div');
        cell.className = sol ? 'cw-cell' : 'cw-cell cw-block';

        if (sol) {
          const n = numberAt.get(`${r},${c}`);
          if (n) {
            const nEl = document.createElement('div');
            nEl.className = 'cw-num';
            nEl.textContent = String(n);
            cell.append(nEl);
          }

          const input = document.createElement('input');
          input.className = 'cw-input';
          input.setAttribute('inputmode', 'text');
          input.autocomplete = 'off';
          input.spellcheck = false;
          // Allow multi-letter romaji sequences (e.g. "kyo") to be typed into a cell.
          // We'll convert to kana and auto-advance when we have enough input.
          input.maxLength = 10;
          input.dataset.r = String(r);
          input.dataset.c = String(c);
          input.dataset.solution = sol;
          input.dataset.buffer = '';
          cell.append(input);
        }

        gridEl.append(cell);
      }
    }

    const clues = document.createElement('div');
    clues.className = 'crossword-clues';
    clues.id = 'crossword-clues';

    const across = puzzle.placed.filter((p) => p.dir === 'across').sort((a, b) => a.number - b.number);
    const down = puzzle.placed.filter((p) => p.dir === 'down').sort((a, b) => a.number - b.number);

    const mkList = (titleText, list) => {
      const box = document.createElement('div');
      box.className = 'card';
      const h = document.createElement('h3');
      h.textContent = titleText;
      h.style.marginTop = '0';
      box.append(h);

      for (const p of list) {
        const row = document.createElement('div');
        row.className = 'cw-clue';
        row.textContent = `${p.number}. ${p.kanji}`;
        box.append(row);
      }

      return box;
    };

    clues.append(mkList('Across', across), mkList('Down', down));

    body.append(gridEl, clues);

    // Romaji-to-kana typing support
    // IMPORTANT: query from gridEl (inputs aren't appended to wrapper until later).
    const inputs = Array.from(gridEl.querySelectorAll('input.cw-input'));
    const inputByPos = new Map();
    for (const input of inputs) {
      const r = input.dataset.r;
      const c = input.dataset.c;
      if (r != null && c != null) inputByPos.set(`${r},${c}`.toString(), input);
    }

    function focusInputAtIndex(idx) {
      const el = inputs[idx];
      if (el) el.focus();
    }

    function indexOfInput(input) {
      return inputs.indexOf(input);
    }

    function nextInput(input, step) {
      const i = indexOfInput(input);
      if (i < 0) return null;
      const j = i + step;
      return inputs[j] ?? null;
    }

    function advanceByCell(input, delta) {
      // delta = +1/-1 linear navigation
      const n = nextInput(input, delta);
      if (n) n.focus();
    }

    function advanceByRowCol(input, dr, dc) {
      const r = Number(input.dataset.r);
      const c = Number(input.dataset.c);
      if (!Number.isFinite(r) || !Number.isFinite(c)) return;
      const nr = r + dr;
      const nc = c + dc;
      const next = inputByPos.get(`${nr},${nc}`);
      if (next) next.focus();
    }

    function applyKanaFromBuffer(startInput, kanaString, restBuffer) {
      let current = startInput;
      let pending = restBuffer;

      for (const ch of splitKana(kanaString)) {
        if (!current) break;
        current.value = ch;
        current.classList.remove('cw-wrong');
        current.classList.remove('cw-right');
        current.dataset.buffer = '';
        current = nextInput(current, +1);
      }

      if (current) {
        current.dataset.buffer = pending;
        current.focus();
      } else if (startInput) {
        startInput.dataset.buffer = pending;
      }
    }

    function handleRomajiKeydown(e, input) {
      const key = e.key;

      if (key === 'Backspace') {
        e.preventDefault();
        const buf = input.dataset.buffer ?? '';
        if (buf.length > 0) {
          const nextBuf = buf.slice(0, -1);
          input.dataset.buffer = nextBuf;
          input.value = nextBuf;
          return;
        }
        if (input.value) {
          input.value = '';
          input.classList.remove('cw-wrong');
          input.classList.remove('cw-right');
          return;
        }
        const prev = nextInput(input, -1);
        if (prev) {
          prev.focus();
          prev.value = '';
          prev.dataset.buffer = '';
          prev.classList.remove('cw-wrong');
          prev.classList.remove('cw-right');
        }
        return;
      }

      if (key === 'ArrowLeft') {
        e.preventDefault();
        advanceByCell(input, -1);
        return;
      }
      if (key === 'ArrowRight') {
        e.preventDefault();
        advanceByCell(input, +1);
        return;
      }
      if (key === 'ArrowUp') {
        e.preventDefault();
        advanceByRowCol(input, -1, 0);
        return;
      }
      if (key === 'ArrowDown') {
        e.preventDefault();
        advanceByRowCol(input, +1, 0);
        return;
      }

      // Allow direct kana typing if IME is enabled.
      if (isHiraganaOrKatakana(key)) {
        e.preventDefault();
        input.value = key;
        input.dataset.buffer = '';
        input.classList.remove('cw-wrong');
        input.classList.remove('cw-right');
        const n = nextInput(input, +1);
        if (n) n.focus();
        return;
      }

      // Romaji letters
      if (/^[a-zA-Z]$/.test(key)) {
        e.preventDefault();
        const buf = (input.dataset.buffer ?? '') + key.toLowerCase();
        const { kana, rest } = convertRomajiIncremental(buf);
        if (kana) {
          applyKanaFromBuffer(input, kana, rest);
        } else {
          input.dataset.buffer = rest;
          // Show pending romaji so it's clear what you're typing.
          input.value = rest;
        }
        return;
      }
    }

    for (const input of inputs) {
      input.addEventListener('keydown', (e) => handleRomajiKeydown(e, input));
      input.addEventListener('focus', () => {
        // Reset buffer when focusing a new cell unless it already has one.
        input.dataset.buffer = input.dataset.buffer ?? '';
      });
    }

    newBtn.addEventListener('click', async () => {
      puzzle = generatePuzzle();
      await store.logEvent({ type: 'crossword.new', collectionId: active.metadata.id, wordsPlaced: puzzle.placed.length });
      renderPuzzle();
    });


    checkBtn.addEventListener('click', async () => {
      const inputs = wrapper.querySelectorAll('input.cw-input');
      let correct = 0;
      let total = 0;
      for (const input of inputs) {
        total++;
        const sol = input.dataset.solution;
        const val = (input.value ?? '').trim();
        const isOk = val === sol;
        input.classList.toggle('cw-wrong', val.length > 0 && !isOk);
        input.classList.toggle('cw-right', val.length > 0 && isOk);
        if (isOk) correct++;
      }
      await store.logEvent({ type: 'crossword.check', collectionId: active.metadata.id, correct, total });
    });

    revealBtn.addEventListener('click', async () => {
      const inputs = wrapper.querySelectorAll('input.cw-input');
      for (const input of inputs) {
        input.value = input.dataset.solution ?? '';
        input.classList.remove('cw-wrong');
        input.classList.add('cw-right');
      }
      await store.logEvent({ type: 'crossword.reveal', collectionId: active.metadata.id });
    });

    wrapper.append(header, hint, body);
  }

  puzzle = generatePuzzle();
  store.logEvent({ type: 'crossword.opened', collectionId: active.metadata.id, wordsPlaced: puzzle.placed.length }).catch(() => {});

  renderPuzzle();
  el.append(wrapper);
  return el;
}
