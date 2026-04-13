(function () {
  const NAMESPACE = 'urn:x-cast:study_cards.main_field';
  const root = document.getElementById('receiver-card');
  const titleEl = document.getElementById('receiver-title');
  const indexEl = document.getElementById('receiver-index');
  const statusEl = document.getElementById('receiver-status');
  const topLeftEl = document.getElementById('receiver-top-left');
  const mainWrapEl = document.getElementById('receiver-main-wrap');
  const mainEl = document.getElementById('receiver-main');
  const mainSecondaryEl = document.getElementById('receiver-main-secondary');
  const bottomLeftEl = document.getElementById('receiver-bottom-left');
  const bottomRightEl = document.getElementById('receiver-bottom-right');

  function resolvePath(obj, path) {
    if (!obj || !path) return '';
    const parts = String(path).split(/\.|\//).filter(Boolean);
    let cur = obj;
    for (const part of parts) {
      if (cur == null) return '';
      cur = cur[part];
    }
    return cur == null ? '' : String(cur);
  }

  function setSlot(el, value, visible) {
    if (!el) return;
    el.textContent = String(value || '');
    el.style.visibility = visible ? '' : 'hidden';
  }

  function applyPayload(payload) {
    const data = payload && typeof payload === 'object' ? payload : {};
    const entry = data.entry && typeof data.entry === 'object' ? data.entry : {};
    const visibilityMap = data.visibilityMap && typeof data.visibilityMap === 'object' ? data.visibilityMap : {};
    const cardConfig = data.cardConfig && typeof data.cardConfig === 'object' ? data.cardConfig : {};
    const layout = cardConfig.layout && typeof cardConfig.layout === 'object' ? cardConfig.layout : {};
    const mode = String(data.mode || '').trim().toLowerCase();

    const getFieldKey = (slot) => String(layout[slot] || '').trim();
    const getFieldValue = (slot) => resolvePath(entry, getFieldKey(slot));
    const isVisible = (slot) => {
      const fieldKey = getFieldKey(slot);
      if (!fieldKey) return false;
      return visibilityMap[fieldKey] !== false;
    };

    const mainValue = getFieldValue('main');
    const mainSecondaryValue = getFieldValue('mainSecondary');
    const centerValues = [mainValue, mainSecondaryValue].filter((value) => String(value || '').trim());
    const longestCenterLength = centerValues.reduce((max, value) => Math.max(max, String(value || '').length), 0);
    let fontSize = 'clamp(4rem, 11vw, 10rem)';
    if (longestCenterLength > 6) fontSize = 'clamp(3rem, 8vw, 7rem)';
    else if (longestCenterLength > 4) fontSize = 'clamp(3.5rem, 9vw, 8rem)';

    document.title = String(data.title || 'Study Cards Receiver');
    titleEl.textContent = String(data.title || 'Study Cards');
    indexEl.textContent = String(data.indexText || '');
    statusEl.textContent = 'Connected';
    root.classList.toggle('kanji-only', mode === 'kanji-only');

    const mainFlow = String(cardConfig.mainFlow || '').trim().toLowerCase() === 'column' ? 'column' : 'row';
    mainWrapEl.style.gridAutoFlow = mainFlow;
    mainWrapEl.style.gridTemplateColumns = mainFlow === 'row' ? 'repeat(2, auto)' : 'auto';
    mainWrapEl.style.gridTemplateRows = mainFlow === 'column' ? 'repeat(2, auto)' : 'auto';
    mainEl.style.fontSize = fontSize;
    mainSecondaryEl.style.fontSize = fontSize;
    mainSecondaryEl.style.display = getFieldKey('mainSecondary') ? '' : 'none';

    setSlot(topLeftEl, getFieldValue('topLeft'), isVisible('topLeft'));
    setSlot(mainEl, mainValue, isVisible('main'));
    setSlot(mainSecondaryEl, mainSecondaryValue, isVisible('mainSecondary'));
    setSlot(bottomLeftEl, getFieldValue('bottomLeft'), isVisible('bottomLeft'));
    setSlot(bottomRightEl, getFieldValue('bottomRight'), isVisible('bottomRight'));
  }

  const context = cast.framework.CastReceiverContext.getInstance();
  context.addCustomMessageListener(NAMESPACE, function (event) {
    let payload = event.data;
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch (e) {}
    }
    applyPayload(payload);
  });
  context.start();
})();
