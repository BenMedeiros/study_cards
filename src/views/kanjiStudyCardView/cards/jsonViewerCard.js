import { createJsonViewer } from '../../../components/shared/jsonViewer.js';

function normalizeCardConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return {};
  const next = {};
  if (Array.isArray(config.controls)) {
    next.controls = Array.from(new Set(config.controls.map((item) => String(item || '').trim()).filter(Boolean)));
  }
  return next;
}

const DEFAULT_CONTROLS = ['maximize', 'wrap', 'copy', 'toggle'];

// Simple card that renders the full entry using the reusable JSON viewer.
export function createJsonViewerCard({ entry = null, indexText = '', config = {}, handlers = {} } = {}) {
  const root = document.createElement('div');
  root.className = 'card kanji-study-card json-viewer-card';

  const topRight = document.createElement('div');
  topRight.className = 'kanji-study-card-top-right';

  const corner = document.createElement('div');
  corner.className = 'card-corner-caption';
  corner.textContent = String(indexText || config?.cornerCaption || '').trim();

  const actions = document.createElement('div');
  actions.className = 'kanji-study-card-actions';

  const body = document.createElement('div');
  body.className = 'json-viewer-body';
  root.append(topRight, body);
  topRight.append(corner, actions);

  let current = null;
  let cardConfig = normalizeCardConfig(config?.cardConfig);

  const openConfig = (handlers && typeof handlers.onOpenConfig === 'function')
    ? handlers.onOpenConfig
    : (config && typeof config.onOpenConfig === 'function' ? config.onOpenConfig : null);
  if (typeof openConfig === 'function') {
    const configBtn = document.createElement('button');
    configBtn.type = 'button';
    configBtn.className = 'icon-button kanji-study-card-config-btn';
    configBtn.title = 'Configure card';
    configBtn.setAttribute('aria-label', 'Configure card');
    configBtn.textContent = '⚙';
    configBtn.addEventListener('click', () => {
      try {
        openConfig({
          cardId: String(config?.cardId || 'json').trim() || 'json',
          entry: current,
          cardConfig: { ...cardConfig, controls: Array.isArray(cardConfig.controls) ? cardConfig.controls.slice() : [] },
          availableFields: [
            { key: 'maximize', label: 'Maximize' },
            { key: 'wrap', label: 'Wrap' },
            { key: 'copy', label: 'Copy' },
            { key: 'toggle', label: 'Collapse Toggle' },
          ],
        });
      } catch (e) {}
    });
    actions.appendChild(configBtn);
  }

  function getControls() {
    return Array.isArray(cardConfig.controls) && cardConfig.controls.length
      ? cardConfig.controls.slice()
      : DEFAULT_CONTROLS.slice();
  }

  function setEntry(e) {
    current = e;
    body.innerHTML = '';
    const viewer = createJsonViewer(current, { expanded: true, showToggle: true, controls: getControls() });
    body.appendChild(viewer);
  }

  function setIndexText(text) {
    corner.textContent = String(text || '').trim();
  }

  function setConfig(nextConfig) {
    cardConfig = normalizeCardConfig(nextConfig);
    setEntry(current);
  }

  function setVisible(visible) {
    root.style.display = visible ? '' : 'none';
  }

  function destroy() {
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  // initialize
  setEntry(entry);
  setIndexText(indexText || config?.cornerCaption || '');

  return { el: root, setEntry, setIndexText, setConfig, setVisible, destroy };
}

// No toggle fields; visibility is controlled by the view layer now.
