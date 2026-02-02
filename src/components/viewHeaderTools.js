// Simple helper to create a standardized header tools container for any view.
// Replaces the previous kanji-specific header container.
export function createViewHeaderTools(opts = {}) {
  const { createControls = false, onStudy10 = null, onStudyAll = null, onShuffle = null, onClearShuffle = null, onClearLearned = null } = opts || {};
  const el = document.createElement('div');
  el.className = 'view-header-tools';

  // If not asked to create controls, return the bare element for backward compatibility.
  if (!createControls) return el;

  // Create buttons owned by this header component
  const studyBtn = document.createElement('button');
  studyBtn.type = 'button';
  studyBtn.className = 'btn small';
  studyBtn.textContent = 'Study 10';

  const studyAllBtn = document.createElement('button');
  studyAllBtn.type = 'button';
  studyAllBtn.className = 'btn small';
  studyAllBtn.textContent = 'Study All';

  const shuffleBtn = document.createElement('button');
  shuffleBtn.type = 'button';
  shuffleBtn.className = 'btn small';
  shuffleBtn.textContent = 'Shuffle';

  const clearShuffleBtn = document.createElement('button');
  clearShuffleBtn.type = 'button';
  clearShuffleBtn.className = 'btn small';
  clearShuffleBtn.textContent = 'Clear Shuffle';

  const clearLearnedBtn = document.createElement('button');
  clearLearnedBtn.type = 'button';
  clearLearnedBtn.className = 'btn small';
  clearLearnedBtn.textContent = 'Clear Learned';
  clearLearnedBtn.title = 'Remove Learned flags for items in this collection';

  // Study label (can be updated by callers)
  const studyLabel = document.createElement('div');
  studyLabel.className = 'hint';
  studyLabel.style.alignSelf = 'center';
  studyLabel.textContent = '';

  el.append(studyBtn, studyAllBtn, shuffleBtn, clearShuffleBtn, clearLearnedBtn, studyLabel);

  // Wire callbacks
  studyBtn.addEventListener('click', (e) => { if (typeof onStudy10 === 'function') onStudy10(e); });
  studyAllBtn.addEventListener('click', (e) => { if (typeof onStudyAll === 'function') onStudyAll(e); });
  shuffleBtn.addEventListener('click', (e) => { if (typeof onShuffle === 'function') onShuffle(e); });
  clearShuffleBtn.addEventListener('click', (e) => { if (typeof onClearShuffle === 'function') onClearShuffle(e); });
  clearLearnedBtn.addEventListener('click', (e) => { if (typeof onClearLearned === 'function') onClearLearned(e); });

  // Expose small API on the element for callers to update the label or buttons if needed
  el.setStudyLabel = (txt) => { studyLabel.textContent = String(txt || ''); };
  el.getButtons = () => ({ studyBtn, studyAllBtn, shuffleBtn, clearShuffleBtn, clearLearnedBtn, studyLabel });

  return el;
}

// Three-state toggle for study filter: 'off' | 'skipLearned' | 'focusOnly'
export function createStudyFilterToggle({ state = 'off', onChange = null } = {}) {
  const el = document.createElement('div');
  el.className = 'three-toggle';

  const btnOff = document.createElement('button');
  btnOff.type = 'button';
  btnOff.className = 'toggle-option';
  btnOff.dataset.value = 'off';
  btnOff.textContent = 'All';

  const btnSkip = document.createElement('button');
  btnSkip.type = 'button';
  btnSkip.className = 'toggle-option';
  btnSkip.dataset.value = 'skipLearned';
  btnSkip.textContent = 'Skip Learned';

  const btnFocus = document.createElement('button');
  btnFocus.type = 'button';
  btnFocus.className = 'toggle-option';
  btnFocus.dataset.value = 'focusOnly';
  btnFocus.textContent = 'Focus';

  el.append(btnOff, btnSkip, btnFocus);

  function setState(next) {
    state = next || 'off';
    [btnOff, btnSkip, btnFocus].forEach(b => b.classList.toggle('active', b.dataset.value === state));
    // reflect aria-pressed
    [btnOff, btnSkip, btnFocus].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.value === state)));
  }

  function handleClick(e) {
    const v = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.value) ? e.currentTarget.dataset.value : null;
    if (!v) return;
    // toggle behavior: clicking active option returns to 'off' when clicking center? We'll use explicit cycles.
    if (v === state) {
      // if clicking the active option, reset to off
      setState('off');
      if (typeof onChange === 'function') onChange('off');
      return;
    }
    setState(v);
    if (typeof onChange === 'function') onChange(v);
  }

  btnOff.addEventListener('click', handleClick);
  btnSkip.addEventListener('click', handleClick);
  btnFocus.addEventListener('click', handleClick);

  // keyboard support
  [btnOff, btnSkip, btnFocus].forEach(b => b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); b.click(); } }));

  // expose small API
  return { el, setState, getState: () => state };
}
