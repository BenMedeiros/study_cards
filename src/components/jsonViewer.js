// Reusable JSON viewer component
function safeJson(v) {
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

export function createJsonViewer(value, opts = {}) {
  const text = safeJson(value);
  const MAX_CHARS = opts.maxChars ?? 1000;
  const MAX_LINES = opts.maxLines ?? 40;
  const lines = (typeof text === 'string') ? text.split('\n').length : 0;
  const isBig = (typeof text === 'string' && text.length > MAX_CHARS) || lines > MAX_LINES;

  const wrapper = document.createElement('div');
  wrapper.className = 'json-view-wrapper';
  if (opts.className) wrapper.className += ' ' + opts.className;
  if (opts.id) wrapper.id = opts.id;
  wrapper.style.position = opts.position || 'relative';

  const content = document.createElement('div');
  content.className = 'json-content mono';

  const pre = document.createElement('pre');
  pre.className = 'json-view mono';
  if (opts.preId) pre.id = opts.preId;
  pre.textContent = text;

  const previewLen = opts.previewLen ?? 200;
  const previewText = typeof text === 'string' ? (text.slice(0, previewLen).replace(/\n/g, ' ') + (text.length > previewLen ? '…' : '')) : String(text);
  const placeholder = document.createElement('div');
  placeholder.className = 'json-collapsed-placeholder';
  placeholder.textContent = previewText;

  const showToggle = opts.showToggle !== false;
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'json-toggle';

  // maximize button (opens a modal with large JSON view)
  const maxBtn = document.createElement('button');
  maxBtn.type = 'button';
  maxBtn.className = 'json-maximize';
  maxBtn.title = 'Maximize JSON';
  maxBtn.textContent = '⤢';

  // wrapping state for this viewer (controls whether pre uses pre-wrap)
  let wrapping = !!opts.wrapping;
  if (wrapping) {
    try { pre.style.setProperty('white-space', 'pre-wrap'); } catch (e) {}
  }

  // Always start collapsed for large payloads, even if `opts.expanded` is true.
  let expanded;
  if (isBig) expanded = false;
  else expanded = (opts.expanded !== undefined) ? !!opts.expanded : true;

  function renderCurrent() {
    content.innerHTML = '';
    if (expanded) {
      content.appendChild(pre);
      toggle.textContent = '−';
      toggle.title = 'Collapse JSON';
      toggle.setAttribute('aria-label', 'Collapse JSON');
      wrapper.dataset.expanded = 'true';
      toggle.setAttribute('aria-pressed', 'true');
      try { if (wrapMainBtn) wrapMainBtn.style.display = ''; } catch (e) {}
    } else {
      content.appendChild(placeholder);
      toggle.textContent = '+';
      toggle.title = 'Expand JSON';
      toggle.setAttribute('aria-label', 'Expand JSON');
      wrapper.dataset.expanded = 'false';
      toggle.setAttribute('aria-pressed', 'false');
      try { if (wrapMainBtn) wrapMainBtn.style.display = 'none'; } catch (e) {}
    }
  }

  if (showToggle) {
    toggle.addEventListener('click', (ev) => {
      ev.stopPropagation();
      expanded = !expanded;
      renderCurrent();
      try { wrapper.dispatchEvent(new CustomEvent('json-toggle', { bubbles: true })); } catch (e) {}
    });
  }

  // controls container to hold action buttons (toggle, maximize, etc.)
  const controls = document.createElement('div');
  controls.className = 'json-controls';
  
  // copy button for quickly copying the current JSON payload
  const copyMainBtn = document.createElement('button');
  copyMainBtn.type = 'button';
  copyMainBtn.className = 'json-copy';
  copyMainBtn.title = 'Copy JSON';
  copyMainBtn.textContent = '⧉';
  copyMainBtn.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    try {
      const txt = pre.textContent || '';
      if (navigator?.clipboard?.writeText) await navigator.clipboard.writeText(txt);
      else {
        const ta = document.createElement('textarea');
        ta.value = txt;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
    } catch (e) {}
  });
  // attach buttons according to options
  if (opts.showMaximize !== false) controls.appendChild(maxBtn);
  // wrap toggle (icon) — handled here so per-view wrapping is local
  const wrapMainBtn = document.createElement('button');
  wrapMainBtn.type = 'button';
  wrapMainBtn.className = 'json-wrap';
  wrapMainBtn.title = 'Toggle wrap';
  wrapMainBtn.textContent = '↪';
  wrapMainBtn.setAttribute('aria-pressed', wrapping ? 'true' : 'false');
  wrapMainBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    wrapping = !wrapping;
    try { pre.style.setProperty('white-space', wrapping ? 'pre-wrap' : 'pre'); } catch (e) {}
    wrapMainBtn.setAttribute('aria-pressed', wrapping ? 'true' : 'false');
  });
  controls.appendChild(wrapMainBtn);
  if (opts.showCopy !== false) controls.appendChild(copyMainBtn);
  if (showToggle) controls.appendChild(toggle);

  // Modal dialog helper for maximize
  function openMaximizedView() {
    try {
      const mount = document.getElementById('shell-root') || document.getElementById('app') || document.body;
      const backdrop = document.createElement('div');
      backdrop.className = 'json-max-backdrop';
      backdrop.style.position = 'fixed';
      backdrop.style.left = '0';
      backdrop.style.top = '0';
      backdrop.style.right = '0';
      backdrop.style.bottom = '0';
      backdrop.style.background = 'rgba(0,0,0,0.6)';
      backdrop.style.zIndex = '9999';

      const dialog = document.createElement('div');
      dialog.className = 'json-max-dialog';
      dialog.style.position = 'fixed';
      dialog.style.left = '4%';
      dialog.style.top = '4%';
      dialog.style.width = '92%';
      dialog.style.height = '92%';
      dialog.style.background = 'var(--bg, #001)';
      dialog.style.border = '1px solid rgba(255,255,255,0.06)';
      dialog.style.borderRadius = '8px';
      dialog.style.zIndex = '10000';
      dialog.style.display = 'flex';
      dialog.style.flexDirection = 'column';

      const header = document.createElement('div');
      header.className = 'json-max-header';
      header.style.display = 'flex';
      header.style.justifyContent = 'space-between';
      header.style.alignItems = 'center';
      header.style.padding = '0.5rem';

      const title = document.createElement('div');
      title.className = 'json-max-title';
      title.textContent = 'JSON Viewer';

      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.gap = '0.5rem';

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'btn small';
      copyBtn.textContent = 'Copy JSON';

      const wrapBtn = document.createElement('button');
      wrapBtn.type = 'button';
      wrapBtn.className = 'btn small';
      wrapBtn.title = 'Toggle wrap';
      wrapBtn.textContent = '↪';

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'btn small';
      closeBtn.textContent = 'Close';

      actions.append(copyBtn, closeBtn);
      header.append(title, actions);

      const bodyWrap = document.createElement('div');
      bodyWrap.style.flex = '1 1 auto';
      bodyWrap.style.overflow = 'auto';
      bodyWrap.style.padding = '0.5rem';

      const bigPre = document.createElement('pre');
      bigPre.className = 'json-view json-view-max mono';
      bigPre.style.margin = '0';
      bigPre.style.whiteSpace = wrapping ? 'pre-wrap' : 'pre';
      bigPre.style.fontSize = '0.95rem';
      bigPre.textContent = pre.textContent;

      bodyWrap.appendChild(bigPre);
      dialog.append(header, bodyWrap);

      function closeDialog() {
        try {
          if (dialog.parentNode) dialog.parentNode.removeChild(dialog);
          if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
          window.removeEventListener('keydown', onKey);
        } catch (e) {}
      }

      function onKey(ev) {
        if (ev.key === 'Escape') closeDialog();
      }

      copyBtn.addEventListener('click', async () => {
        try {
          if (navigator?.clipboard?.writeText) await navigator.clipboard.writeText(bigPre.textContent || '');
          else {
            const ta = document.createElement('textarea');
            ta.value = bigPre.textContent || '';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
          }
        } catch (e) {}
      });

      wrapBtn.addEventListener('click', () => {
        try {
          wrapping = !wrapping;
          bigPre.style.whiteSpace = wrapping ? 'pre-wrap' : 'pre';
          try { pre.style.setProperty('white-space', wrapping ? 'pre-wrap' : 'pre'); } catch (e) {}
          // mirror aria state on main control if present
          try { wrapMainBtn.setAttribute('aria-pressed', wrapping ? 'true' : 'false'); } catch (e) {}
        } catch (e) {}
      });

      actions.insertBefore(wrapBtn, actions.firstChild || null);

      closeBtn.addEventListener('click', closeDialog);
      backdrop.addEventListener('click', closeDialog);
      window.addEventListener('keydown', onKey);

      mount.append(backdrop, dialog);
    } catch (e) {}
  }

  maxBtn.addEventListener('click', (ev) => { ev.stopPropagation(); openMaximizedView(); });

  // initial render
  renderCurrent();

  // updater: allow external callers to update the JSON payload without
  // recreating the component. This preserves controls/state while swapping
  // out the underlying <pre> content and placeholder preview.
  function setJson(newValue) {
    try {
      const newText = safeJson(newValue);
      const newLines = (typeof newText === 'string') ? newText.split('\n').length : 0;
      const newIsBig = (typeof newText === 'string' && newText.length > MAX_CHARS) || newLines > MAX_LINES;

      // update pre and placeholder
      pre.textContent = newText;
      const newPreview = typeof newText === 'string' ? (newText.slice(0, previewLen).replace(/\n/g, ' ') + (newText.length > previewLen ? '…' : '')) : String(newText);
      placeholder.textContent = newPreview;

      // If the new payload is large, force collapse to avoid rendering huge text.
      if (newIsBig && expanded) {
        expanded = false;
      }
      // If new payload is small, leave expanded state as-is (preserve user choice).

      // If currently expanded, ensure the pre is visible; otherwise placeholder.
      renderCurrent();
    } catch (e) {
      // ignore
    }
  }

  wrapper.appendChild(content);
  wrapper.appendChild(controls);

  // expose some handles for external control
  if (opts.expose) {
    try { opts.expose.wrapper = wrapper; opts.expose.pre = pre; opts.expose.setJson = setJson; } catch (e) {}
  }

  // apply optional wrapping state
  if (opts.wrapping) {
    try { pre.style.setProperty('white-space', 'pre-wrap'); } catch (e) {}
  }

  return wrapper;
}

export default createJsonViewer;
