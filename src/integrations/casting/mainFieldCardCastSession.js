import { createMainFieldCard } from '../../views/kanjiStudyCardView/cards/mainFieldCard.js';

function cloneHeadStyles(sourceDoc, targetDoc) {
  if (!sourceDoc || !targetDoc) return;
  const nodes = sourceDoc.querySelectorAll('link[rel="stylesheet"], style');
  for (const node of nodes) {
    try { targetDoc.head.appendChild(node.cloneNode(true)); } catch (e) {}
  }
}

function ensureCastDocumentFrame(targetDoc) {
  if (!targetDoc) return null;
  const root = targetDoc.createElement('div');
  root.className = 'cast-main-field-root';
  targetDoc.body.innerHTML = '';
  targetDoc.body.className = document.body.className;
  targetDoc.body.appendChild(root);

  const style = targetDoc.createElement('style');
  style.textContent = `
    html, body {
      margin: 0;
      min-height: 100%;
    }
    body {
      display: grid;
      place-items: center;
      padding: 1rem;
      background: var(--surface-app, #111827);
    }
    .cast-main-field-root {
      width: min(100%, 42rem);
    }
    .cast-main-field-root .main-field-card {
      margin: 0;
    }
  `;
  targetDoc.head.appendChild(style);
  return root;
}

function buildWindowFeatures({ width = 540, height = 420 } = {}) {
  return `popup=yes,width=${width},height=${height},resizable=yes,scrollbars=no`;
}

export function createMainFieldCardCastSession() {
  let targetWindow = null;
  let cardApi = null;
  let hostEl = null;

  function isSupported() {
    return !!(window?.documentPictureInPicture?.requestWindow || window?.open);
  }

  function isActive() {
    return !!(targetWindow && !targetWindow.closed && cardApi && hostEl);
  }

  function cleanupSession() {
    try { cardApi?.destroy?.(); } catch (e) {}
    targetWindow = null;
    cardApi = null;
    hostEl = null;
  }

  async function openTargetWindow() {
    if (window?.documentPictureInPicture?.requestWindow) {
      return window.documentPictureInPicture.requestWindow({ width: 540, height: 420 });
    }
    return window.open('', 'study-cards-main-field-cast', buildWindowFeatures());
  }

  function update(snapshot = {}) {
    if (!isActive()) return false;
    const {
      entry = null,
      indexText = '',
      cardConfig = {},
      availableFields = [],
      visibilityMap = {},
      title = 'Study Cards Cast',
      mode = '',
    } = snapshot || {};

    try { targetWindow.document.title = String(title || 'Study Cards Cast'); } catch (e) {}
    try { if (typeof cardApi.setAvailableFields === 'function') cardApi.setAvailableFields(availableFields); } catch (e) {}
    try { if (typeof cardApi.setConfig === 'function') cardApi.setConfig(cardConfig); } catch (e) {}
    try { if (typeof cardApi.setFieldsVisible === 'function') cardApi.setFieldsVisible(visibilityMap || {}); } catch (e) {}
    try { if (typeof cardApi.setIndexText === 'function') cardApi.setIndexText(indexText || ''); } catch (e) {}
    try { if (typeof cardApi.setEntry === 'function') cardApi.setEntry(entry || null); } catch (e) {}
    try {
      const wrapper = cardApi?.el?.querySelector('.main-field-card-wrapper');
      if (wrapper) wrapper.classList.toggle('kanji-only', mode === 'kanji-only');
    } catch (e) {}
    return true;
  }

  async function open(snapshot = {}) {
    if (isActive()) {
      update(snapshot);
      try { targetWindow.focus(); } catch (e) {}
      return true;
    }
    if (!isSupported()) return false;

    const nextWindow = await openTargetWindow();
    if (!nextWindow) return false;
    targetWindow = nextWindow;
    const targetDoc = targetWindow.document;
    try {
      targetDoc.open();
      targetDoc.write('<!doctype html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head><body></body></html>');
      targetDoc.close();
    } catch (e) {}
    cloneHeadStyles(document, targetDoc);
    hostEl = ensureCastDocumentFrame(targetDoc);
    cardApi = createMainFieldCard({
      entry: null,
      indexText: '',
      config: { cardId: 'main-cast' },
      documentRef: targetDoc,
    });
    hostEl.appendChild(cardApi.el);
    try { targetWindow.addEventListener('pagehide', cleanupSession, { once: true }); } catch (e) {}
    try { targetWindow.addEventListener('beforeunload', cleanupSession, { once: true }); } catch (e) {}
    update(snapshot);
    try { targetWindow.focus(); } catch (e) {}
    return true;
  }

  function close() {
    if (targetWindow && !targetWindow.closed) {
      try { targetWindow.close(); } catch (e) {}
    }
    cleanupSession();
  }

  async function toggle(snapshot = {}) {
    if (isActive()) {
      close();
      return false;
    }
    return open(snapshot);
  }

  return {
    open,
    close,
    update,
    toggle,
    isActive,
    isSupported,
  };
}
