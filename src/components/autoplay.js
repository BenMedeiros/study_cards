import { el, safeId } from './dom.js';

// Autoplay controls: abstract sequencer builder.
// The component accepts/returns a `sequence` array of actions, e.g.
// [{ action: 'next' }, { action: 'wait', ms: 2000 }, { action: 'sound' }, { action: 'wait', ms: 1000 }, { action: 'reveal' }]
// The component does NOT implement loop behavior; the app using it should handle looping.
export function createAutoplayControls({ sequence = [], isPlaying = false, onTogglePlay, onSequenceChange }) {
  let seq = Array.isArray(sequence) ? sequence.slice() : [];

  const container = el('div', { className: 'autoplay-controls' });
  const group = el('div', { className: 'btn-group' });

  const playBtn = el('button', { className: 'btn small', text: isPlaying ? '⏸' : '▶' });
  playBtn.title = isPlaying ? 'Pause autoplay' : 'Start autoplay';
  playBtn.setAttribute('aria-pressed', String(!!isPlaying));

  const gearBtn = el('button', { className: 'btn small', text: '⚙' });
  gearBtn.title = 'Autoplay settings';

  group.append(playBtn, gearBtn);

  // Overlay / sequencer editor
  // Create overlay without aria-hidden initially to avoid hiding a focused descendant.
  const overlay = el('div', { className: 'autoplay-overlay' });
  overlay.style.position = 'fixed';
  overlay.style.zIndex = '1200';
  overlay.style.display = 'none';

  function buildOverlay() {
    overlay.innerHTML = '';
    const left = el('div', { className: 'autoplay-left' });
    const right = el('div', { className: 'autoplay-right' });

    const title = el('div', { className: 'hint', text: 'Actions' });

    // Available actions mirror footer controls (abstract names)
    const actions = [
      { action: 'prev', label: 'Prev' },
      { action: 'next', label: 'Next' },
      { action: 'sound', label: 'Sound' },
      { action: 'reveal', label: 'Reveal' },
      { action: 'wait', label: 'Wait 0.5s', ms: 500 },
      { action: 'wait', label: 'Wait 1s', ms: 1000 },
      { action: 'wait', label: 'Wait 2s', ms: 2000 },
    ];

    const actionsList = el('div', { className: 'autoplay-actions' });
    for (const a of actions) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn';
      btn.textContent = a.label;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Add action to sequence. Use the action's ms when provided for waits
        if (a.action === 'wait') seq.push({ action: 'wait', ms: a.ms || 1000 });
        else seq.push({ action: a.action });
        renderSequence();
        onSequenceChange && onSequenceChange(seq.slice());
      });
      actionsList.append(btn);
    }

    left.append(title, actionsList);

    // Sequence editor on right
    const seqTitle = el('div', { className: 'hint', text: 'Sequence' });
    const seqList = el('div', { className: 'autoplay-sequence' });

    // If no sequence exists yet, populate a sensible default so users see options
    if (!Array.isArray(seq) || seq.length === 0) {
      seq = [ { action: 'wait', ms: 1000 }, { action: 'next' } ];
      // notify host that a default sequence is available
      onSequenceChange && onSequenceChange(seq.slice());
    }

    function renderSequence() {
      seqList.innerHTML = '';
      seq.forEach((item, i) => {
        const itemWrap = el('div', { className: 'sequence-item' });
        const label = el('div', { className: 'sequence-label', text: item.action });

        const controls = el('div', { className: 'sequence-controls' });
        const up = el('button', { className: 'btn small', text: '▲' });
        const down = el('button', { className: 'btn small', text: '▼' });
        const del = el('button', { className: 'btn small', text: '✕' });

        up.addEventListener('click', (e) => {
          e.stopPropagation();
          if (i === 0) return;
          [seq[i - 1], seq[i]] = [seq[i], seq[i - 1]];
          renderSequence();
          onSequenceChange && onSequenceChange(seq.slice());
        });
        down.addEventListener('click', (e) => {
          e.stopPropagation();
          if (i === seq.length - 1) return;
          [seq[i], seq[i + 1]] = [seq[i + 1], seq[i]];
          renderSequence();
          onSequenceChange && onSequenceChange(seq.slice());
        });
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          seq.splice(i, 1);
          renderSequence();
          onSequenceChange && onSequenceChange(seq.slice());
        });

        controls.append(up, down, del);

        itemWrap.append(label);

          // show readable label for waits
          if (item.action === 'wait') {
            const ms = Number(item.ms || 0);
            // format as seconds, prefer concise decimal (e.g. 0.5s, 1s)
            const sec = ms / 1000;
            const secStr = Number.isInteger(sec) ? `${sec}s` : `${parseFloat(sec.toFixed(2))}s`;
            label.textContent = `wait ${secStr}`;
          }

        itemWrap.append(controls);
        seqList.append(itemWrap);
      });
    }

    renderSequence();

    const closeBtn = el('button', { className: 'btn', text: 'Close' });
    closeBtn.type = 'button';
    closeBtn.addEventListener('click', () => hideOverlay());

    right.append(seqTitle, seqList, closeBtn);

    overlay.append(left, right);
  }

  function showOverlay(x, y) {
    buildOverlay();
    // Position near button but allow responsive placement
    overlay.style.left = `${Math.round(x)}px`;
    overlay.style.top = `${Math.round(y)}px`;
    overlay.style.display = 'flex';
    overlay.removeAttribute('aria-hidden');
    setTimeout(() => document.addEventListener('click', onDocClick), 0);
  }

  function hideOverlay() {
    // If focus is inside the overlay, move it back to the gear button so assistive
    // tech isn't left pointing at hidden content.
    try {
      const active = document.activeElement;
      if (active && overlay.contains(active)) {
        gearBtn && gearBtn.focus && gearBtn.focus();
      }
    } catch (e) {
      // ignore
    }

    overlay.style.display = 'none';
    // mark hidden for screen readers
    overlay.setAttribute('aria-hidden', 'true');
    document.removeEventListener('click', onDocClick);
  }

  function onDocClick(e) {
    if (!overlay.contains(e.target) && e.target !== gearBtn && e.target !== playBtn) hideOverlay();
  }

  playBtn.addEventListener('click', () => {
    // Only toggle play if a sequence exists; otherwise ignore (user must configure first)
    if (!Array.isArray(seq) || seq.length === 0) {
      // no-op: optionally could flash or open settings
      return;
    }
    const nextState = !(playBtn.getAttribute('aria-pressed') === 'true');
    playBtn.setAttribute('aria-pressed', String(!!nextState));
    playBtn.textContent = nextState ? '⏸' : '▶';
    playBtn.title = nextState ? 'Pause autoplay' : 'Start autoplay';
    onTogglePlay && onTogglePlay(nextState);
  });

  playBtn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const rect = playBtn.getBoundingClientRect();
    showOverlay(rect.right + 6, rect.top);
  });

  gearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const rect = gearBtn.getBoundingClientRect();
    showOverlay(rect.right + 6, rect.top);
  });

  container.append(group, overlay);

  return container;
}
