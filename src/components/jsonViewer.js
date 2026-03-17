// Reusable JSON viewer component
function safeJson(v) {
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

function isContainer(value) {
  return Boolean(value) && typeof value === 'object';
}

function encodePathSegment(value) {
  return String(value).replace(/~/g, '~0').replace(/\//g, '~1');
}

function createPath(parentPath, key) {
  return `${parentPath}/${encodePathSegment(key)}`;
}

function formatContainerSummary(value) {
  if (Array.isArray(value)) return value.length ? `[${value.length} items]` : '[]';
  const size = Object.keys(value || {}).length;
  return size ? `{${size} keys}` : '{}';
}

function formatPrimitive(value) {
  return JSON.stringify(value);
}

function getEntries(value) {
  if (!isContainer(value)) return [];
  return Array.isArray(value)
    ? value.map((item, index) => [index, item])
    : Object.entries(value);
}

function appendToken(parent, className, text) {
  const token = document.createElement('span');
  token.className = className;
  token.textContent = text;
  parent.appendChild(token);
  return token;
}

function buildJsonTree(value, options = {}) {
  const {
    collapsedPaths = new Set(),
    onTogglePath = () => {},
    wrapping = false,
  } = options;

  const root = document.createElement('div');
  root.className = 'json-tree';
  if (wrapping) root.classList.add('json-tree-wrap');

  function createLine(depth) {
    const line = document.createElement('div');
    line.className = 'json-tree-line';
    line.style.paddingLeft = `${depth * 16}px`;
    return line;
  }

  function createToggle(path, isCollapsed) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'json-node-toggle';
    button.textContent = isCollapsed ? '▸' : '▾';
    button.title = isCollapsed ? 'Expand node' : 'Collapse node';
    button.setAttribute('aria-label', isCollapsed ? 'Expand node' : 'Collapse node');
    button.setAttribute('aria-pressed', isCollapsed ? 'false' : 'true');
    button.addEventListener('click', (ev) => {
      ev.stopPropagation();
      onTogglePath(path, !isCollapsed);
    });
    return button;
  }

  function createTogglePlaceholder() {
    const spacer = document.createElement('span');
    spacer.className = 'json-node-toggle-placeholder';
    spacer.textContent = ' ';
    return spacer;
  }

  function appendKey(line, key) {
    appendToken(line, 'json-token-key', JSON.stringify(String(key)));
    appendToken(line, 'json-token-punctuation', ': ');
  }

  function renderNode(nodeValue, path, depth, opts = {}) {
    const { key = null, trailingComma = false, isRoot = false } = opts;
    if (!isContainer(nodeValue)) {
      const line = createLine(depth);
      line.appendChild(createTogglePlaceholder());
      if (key !== null) appendKey(line, key);
      appendToken(line, 'json-token-primitive', formatPrimitive(nodeValue));
      if (trailingComma) appendToken(line, 'json-token-punctuation', ',');
      return line;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'json-tree-node';

    const line = createLine(depth);
    const entries = getEntries(nodeValue);
    const isCollapsed = !isRoot && collapsedPaths.has(path);
    const openBracket = Array.isArray(nodeValue) ? '[' : '{';
    const closeBracket = Array.isArray(nodeValue) ? ']' : '}';

    if (entries.length) line.appendChild(isRoot ? createTogglePlaceholder() : createToggle(path, isCollapsed));
    else line.appendChild(createTogglePlaceholder());

    if (key !== null) appendKey(line, key);

    if (!entries.length) {
      appendToken(line, 'json-token-punctuation', openBracket + closeBracket);
      if (trailingComma) appendToken(line, 'json-token-punctuation', ',');
      wrapper.appendChild(line);
      return wrapper;
    }

    if (isCollapsed) {
      appendToken(line, 'json-token-punctuation', openBracket);
      appendToken(line, 'json-token-summary', ` ${formatContainerSummary(nodeValue)} `);
      appendToken(line, 'json-token-punctuation', closeBracket);
      if (trailingComma) appendToken(line, 'json-token-punctuation', ',');
      wrapper.appendChild(line);
      return wrapper;
    }

    appendToken(line, 'json-token-punctuation', openBracket);
    wrapper.appendChild(line);

    entries.forEach(([entryKey, entryValue], index) => {
      wrapper.appendChild(renderNode(entryValue, createPath(path, entryKey), depth + 1, {
        key: entryKey,
        trailingComma: index < entries.length - 1,
      }));
    });

    const closeLine = createLine(depth);
    closeLine.appendChild(createTogglePlaceholder());
    appendToken(closeLine, 'json-token-punctuation', closeBracket);
    if (trailingComma) appendToken(closeLine, 'json-token-punctuation', ',');
    wrapper.appendChild(closeLine);
    return wrapper;
  }

  root.appendChild(renderNode(value, '', 0, { isRoot: true }));
  return root;
}

export function createJsonViewer(value, opts = {}) {
  const MAX_CHARS = opts.maxChars ?? 1000;
  const MAX_LINES = opts.maxLines ?? 40;
  const previewLen = opts.previewLen ?? 200;
  const treeEnabled = opts.tree !== false;

  let currentValue = value;
  let text = safeJson(currentValue);
  let lines = (typeof text === 'string') ? text.split('\n').length : 0;
  let isBig = (typeof text === 'string' && text.length > MAX_CHARS) || lines > MAX_LINES;
  let isTreeValue = treeEnabled && isContainer(currentValue);
  let treeRoot = null;
  const collapsedPaths = new Set(Array.isArray(opts.collapsedPaths) ? opts.collapsedPaths.filter((entry) => typeof entry === 'string') : []);

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

  const previewText = typeof text === 'string' ? (text.slice(0, previewLen).replace(/\n/g, ' ') + (text.length > previewLen ? '…' : '')) : String(text);
  const placeholder = document.createElement('div');
  placeholder.className = 'json-collapsed-placeholder';
  placeholder.textContent = previewText;

  const showToggle = opts.showToggle !== false;
  const showWrap = opts.showWrap !== false;
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

  let wrapMainBtn = null;

  function rebuildTree() {
    if (!isTreeValue) {
      treeRoot = null;
      return;
    }
    treeRoot = buildJsonTree(currentValue, {
      collapsedPaths,
      wrapping,
      onTogglePath(path, nextCollapsed) {
        if (!path) return;
        if (nextCollapsed) collapsedPaths.add(path);
        else collapsedPaths.delete(path);
        rebuildTree();
        renderCurrent();
        try { wrapper.dispatchEvent(new CustomEvent('json-tree-toggle', { detail: { path, collapsed: nextCollapsed }, bubbles: true })); } catch (e) {}
      },
    });
  }

  function renderCurrent() {
    content.replaceChildren();
    if (expanded) {
      if (isTreeValue) {
        if (!treeRoot) rebuildTree();
        if (treeRoot) content.appendChild(treeRoot);
      } else {
        content.appendChild(pre);
      }
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

  // wrap toggle (icon) - handled here so per-view wrapping is local
  if (showWrap) {
    wrapMainBtn = document.createElement('button');
    wrapMainBtn.type = 'button';
    wrapMainBtn.className = 'json-wrap';
    wrapMainBtn.title = 'Toggle wrap';
    wrapMainBtn.textContent = '↪';
    wrapMainBtn.setAttribute('aria-pressed', wrapping ? 'true' : 'false');
    wrapMainBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      wrapping = !wrapping;
      try { pre.style.setProperty('white-space', wrapping ? 'pre-wrap' : 'pre'); } catch (e) {}
      if (treeRoot) treeRoot.classList.toggle('json-tree-wrap', wrapping);
      wrapMainBtn.setAttribute('aria-pressed', wrapping ? 'true' : 'false');
    });
    controls.appendChild(wrapMainBtn);
  }

  if (opts.showCopy !== false) controls.appendChild(copyMainBtn);
  if (showToggle) controls.appendChild(toggle);

  // Modal dialog helper for maximize
  function openMaximizedView() {
    try {
      const mount = document.getElementById('shell-root') || document.getElementById('app') || document.body;
      const backdrop = document.createElement('div');
      backdrop.className = 'json-max-backdrop';

      const dialog = document.createElement('div');
      dialog.className = 'json-max-dialog';

      const header = document.createElement('div');
      header.className = 'json-max-header';

      const title = document.createElement('div');
      title.className = 'json-max-title';
      title.textContent = 'JSON Viewer';

      const actions = document.createElement('div');
      actions.className = 'json-max-actions';

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'btn small';
      copyBtn.textContent = 'Copy JSON';

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'btn small';
      closeBtn.textContent = 'Close';

      actions.append(copyBtn, closeBtn);
      header.append(title, actions);

      const bodyWrap = document.createElement('div');
      bodyWrap.className = 'json-max-body';

      function renderMaximizedBody() {
        bodyWrap.replaceChildren();
        if (isTreeValue) {
          const bigTree = buildJsonTree(currentValue, {
            collapsedPaths,
            wrapping,
            onTogglePath(path, nextCollapsed) {
              if (!path) return;
              if (nextCollapsed) collapsedPaths.add(path);
              else collapsedPaths.delete(path);
              rebuildTree();
              renderCurrent();
              renderMaximizedBody();
            },
          });
          bigTree.classList.add('json-view-max');
          bodyWrap.appendChild(bigTree);
          return;
        }

        const bigPre = document.createElement('pre');
        bigPre.className = 'json-view json-view-max mono';
        bigPre.style.margin = '0';
        bigPre.style.whiteSpace = wrapping ? 'pre-wrap' : 'pre';
        bigPre.textContent = text;
        bodyWrap.appendChild(bigPre);
      }

      renderMaximizedBody();
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
          if (navigator?.clipboard?.writeText) await navigator.clipboard.writeText(text || '');
          else {
            const ta = document.createElement('textarea');
            ta.value = text || '';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
          }
        } catch (e) {}
      });

      if (showWrap) {
        const wrapBtn = document.createElement('button');
        wrapBtn.type = 'button';
        wrapBtn.className = 'btn small';
        wrapBtn.title = 'Toggle wrap';
        wrapBtn.textContent = '↪';
        wrapBtn.addEventListener('click', () => {
          try {
            wrapping = !wrapping;
            try { pre.style.setProperty('white-space', wrapping ? 'pre-wrap' : 'pre'); } catch (e) {}
            try { if (treeRoot) treeRoot.classList.toggle('json-tree-wrap', wrapping); } catch (e) {}
            try { if (wrapMainBtn) wrapMainBtn.setAttribute('aria-pressed', wrapping ? 'true' : 'false'); } catch (e) {}
            renderMaximizedBody();
          } catch (e) {}
        });
        actions.insertBefore(wrapBtn, actions.firstChild || null);
      }

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
      currentValue = newValue;
      text = safeJson(newValue);
      lines = (typeof text === 'string') ? text.split('\n').length : 0;
      isBig = (typeof text === 'string' && text.length > MAX_CHARS) || lines > MAX_LINES;
      isTreeValue = treeEnabled && isContainer(currentValue);

      // update pre and placeholder
      pre.textContent = text;
      const newPreview = typeof text === 'string' ? (text.slice(0, previewLen).replace(/\n/g, ' ') + (text.length > previewLen ? '…' : '')) : String(text);
      placeholder.textContent = newPreview;
      rebuildTree();

      // If the new payload is large, force collapse to avoid rendering huge text.
      if (isBig && expanded) {
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
    try {
      opts.expose.wrapper = wrapper;
      opts.expose.pre = pre;
      opts.expose.setJson = setJson;
      opts.expose.getCollapsedPaths = () => Array.from(collapsedPaths);
    } catch (e) {}
  }

  // apply optional wrapping state
  if (opts.wrapping) {
    try { pre.style.setProperty('white-space', 'pre-wrap'); } catch (e) {}
  }

  return wrapper;
}

export default createJsonViewer;
