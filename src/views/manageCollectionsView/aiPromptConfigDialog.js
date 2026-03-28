import { el } from '../../utils/browser/ui.js';

export function openAiPromptBatchTargetDialog({
  currentValue = 20,
  defaultValue = 20,
  maxValue = 500,
} = {}) {
  const mount = document.body || document.documentElement;
  if (!mount) return Promise.resolve(null);

  return new Promise((resolve) => {
    const backdrop = el('div', { className: 'mc-ai-prompt-config-backdrop' });
    const dialog = el('div', {
      className: 'mc-ai-prompt-config-dialog',
      attrs: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'AI prompt settings',
      },
    });
    dialog.tabIndex = -1;

    const titleEl = el('h2', { text: 'AI Prompt Settings' });
    const subtitleEl = el('p', {
      className: 'hint',
      text: 'Choose the target batch size for missing-related prompt generation.',
    });
    const summaryEl = el('div', { className: 'mc-ai-prompt-config-summary', text: '' });
    const header = el('div', {
      className: 'mc-ai-prompt-config-header',
      children: [el('div', { children: [titleEl, subtitleEl, summaryEl] })],
    });

    const input = el('input', {
      className: 'mc-ai-prompt-config-input',
      attrs: {
        type: 'number',
        min: '1',
        step: '1',
        value: String(currentValue || defaultValue || 20),
      },
    });
    const field = el('label', {
      className: 'mc-ai-prompt-config-field',
      children: [
        el('div', { className: 'mc-ai-prompt-config-label', text: 'Missing refs per batch' }),
        input,
        el('div', { className: 'hint', text: 'Higher values create fewer, larger prompt documents.' }),
      ],
    });
    const errorEl = el('div', { className: 'mc-ai-prompt-config-error hint', text: '' });
    errorEl.style.display = 'none';
    const body = el('div', {
      className: 'mc-ai-prompt-config-body',
      children: [field, errorEl],
    });

    const resetBtn = el('button', { className: 'btn', text: 'Reset', attrs: { type: 'button' } });
    const cancelBtn = el('button', { className: 'btn', text: 'Cancel', attrs: { type: 'button' } });
    const saveBtn = el('button', { className: 'btn primary', text: 'Save', attrs: { type: 'button' } });
    const footer = el('div', {
      className: 'mc-ai-prompt-config-footer',
      children: [
        el('div', { className: 'mc-ai-prompt-config-footer-left', children: [resetBtn] }),
        el('div', { className: 'mc-ai-prompt-config-footer-right', children: [cancelBtn, saveBtn] }),
      ],
    });

    dialog.append(header, body, footer);

    function getNormalizedValue() {
      const num = Math.round(Number(input.value));
      if (!Number.isFinite(num) || num < 1) return null;
      return Math.min(maxValue, num);
    }

    function renderSummary() {
      const nextValue = getNormalizedValue();
      if (nextValue == null) {
        summaryEl.textContent = 'Enter a whole number greater than 0';
        errorEl.textContent = 'Batch size must be a positive whole number.';
        errorEl.style.display = '';
        return false;
      }
      summaryEl.textContent = `Target: about ${nextValue} missing reference${nextValue === 1 ? '' : 's'} per prompt`;
      errorEl.textContent = '';
      errorEl.style.display = 'none';
      return true;
    }

    function cleanup(result) {
      document.removeEventListener('keydown', onKeyDown, true);
      backdrop.removeEventListener('click', onBackdropClick);
      try { dialog.remove(); } catch (e) {}
      try { backdrop.remove(); } catch (e) {}
      resolve(result);
    }

    function onBackdropClick(event) {
      if (event.target !== backdrop) return;
      cleanup(null);
    }

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        cleanup(null);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const nextValue = getNormalizedValue();
        if (nextValue == null) {
          renderSummary();
          return;
        }
        cleanup(nextValue);
      }
    }

    input.addEventListener('input', () => { renderSummary(); });
    resetBtn.addEventListener('click', () => {
      input.value = String(defaultValue || 20);
      renderSummary();
    });
    cancelBtn.addEventListener('click', () => cleanup(null));
    saveBtn.addEventListener('click', () => {
      const nextValue = getNormalizedValue();
      if (nextValue == null) {
        renderSummary();
        return;
      }
      cleanup(nextValue);
    });

    backdrop.append(dialog);
    mount.append(backdrop);
    backdrop.addEventListener('click', onBackdropClick);
    document.addEventListener('keydown', onKeyDown, true);

    renderSummary();
    setTimeout(() => {
      try {
        dialog.focus();
        input.focus();
        input.select();
      } catch (e) {}
    }, 0);
  });
}

export default { openAiPromptBatchTargetDialog };