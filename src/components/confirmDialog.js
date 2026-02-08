import { el } from './ui.js';

function getFocusable(root) {
  const sel = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';
  return Array.from(root.querySelectorAll(sel)).filter(n => n.offsetParent !== null);
}

/**
 * Show a lightweight modal confirm dialog.
 * Resolves to true when confirmed, false when cancelled/dismissed.
 */
export function confirmDialog({
  title = 'Confirm',
  message = '',
  detail = '',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  danger = false,
} = {}) {
  // Close any other overlays (dropdowns, autoplay editor, etc.)
  try {
    document.dispatchEvent(new CustomEvent('ui:closeOverlays'));
  } catch (e) {
    // ignore
  }

  return new Promise((resolve) => {
    let done = false;

    const backdrop = el('div', { className: 'confirm-backdrop' });

    const dialog = el('div', {
      className: 'confirm-dialog',
      attrs: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': String(title || 'Confirm'),
      }
    });
    dialog.tabIndex = -1;

    const header = el('div', { className: 'confirm-header' });
    const titleEl = el('div', { className: 'confirm-title', text: String(title || '') });
    header.append(titleEl);

    const body = el('div', { className: 'confirm-body' });
    const msgEl = message ? el('div', { className: 'confirm-message', text: String(message) }) : null;
    const detailEl = detail ? el('div', { className: 'confirm-detail hint', text: String(detail) }) : null;
    body.append(...[msgEl, detailEl].filter(Boolean));

    const footer = el('div', { className: 'confirm-footer' });

    const cancelBtn = el('button', { className: 'btn', text: String(cancelText || 'Cancel') });
    cancelBtn.type = 'button';

    const confirmBtn = el('button', {
      className: `btn ${danger ? 'danger' : ''}`.trim(),
      text: String(confirmText || 'Confirm')
    });
    confirmBtn.type = 'button';

    footer.append(cancelBtn, confirmBtn);

    dialog.append(header, body, footer);

    let _prevActive = null;

    function finish(result) {
      if (done) return;
      done = true;

      try {
        dialog.classList && dialog.classList.remove('open');
        backdrop.classList && backdrop.classList.remove('show');
      } catch (e) {}

      const cleanup = () => {
        try { if (dialog.parentNode) dialog.parentNode.removeChild(dialog); } catch (e) {}
        try { if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop); } catch (e) {}
      };

      let called = false;
      function doneCleanup() { if (called) return; called = true; cleanup(); }
      try { dialog.addEventListener('transitionend', doneCleanup); } catch (e) {}
      setTimeout(doneCleanup, 220);

      try { if (_prevActive && _prevActive.focus) _prevActive.focus(); } catch (e) {}

      try { document.removeEventListener('keydown', onKeyDown); } catch (e) {}

      resolve(!!result);
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
        return;
      }
      if (e.key !== 'Tab') return;

      const focusables = getFocusable(dialog);
      if (!focusables.length) {
        e.preventDefault();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    backdrop.addEventListener('click', () => finish(false));
    cancelBtn.addEventListener('click', () => finish(false));
    confirmBtn.addEventListener('click', () => finish(true));

    // choose mount point: prefer #shell-root, then #app, then document.body
    const mount = document.getElementById('shell-root') || document.getElementById('app') || document.body;

    _prevActive = document.activeElement;

    mount.appendChild(backdrop);
    mount.appendChild(dialog);

    // center and show
    dialog.style.position = 'fixed';
    dialog.style.left = '50%';
    dialog.style.top = '50%';
    dialog.style.transform = 'translate(-50%, -50%)';

    requestAnimationFrame(() => {
      try {
        backdrop.classList && backdrop.classList.add('show');
        dialog.classList && dialog.classList.add('open');
      } catch (e) {}

      // Focus confirm by default for quick keyboard usage
      try { confirmBtn.focus(); } catch (e) { try { dialog.focus(); } catch (e2) {} }
    });

    document.addEventListener('keydown', onKeyDown);
  });
}
