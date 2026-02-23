export function createShellFooter({ store, captionsVisible = false } = {}) {
  const FLASH_MS = 420;
  const PIN_MS = FLASH_MS;
  const footer = document.createElement('div');
  footer.className = 'shell-footer';
  footer.id = 'shell-footer';

  const fLeft = document.createElement('div');
  fLeft.className = 'shell-footer-left';
  fLeft.id = 'shell-footer-left';
  fLeft.textContent = '';

  const fCenter = document.createElement('div');
  fCenter.className = 'shell-footer-center';
  fCenter.id = 'shell-footer-center';
  const fCenterKey = document.createElement('span');
  fCenterKey.className = 'shell-footer-study-key';
  const fCenterSep1 = document.createElement('span');
  fCenterSep1.className = 'shell-footer-study-sep';
  const fCenterApp = document.createElement('span');
  fCenterApp.className = 'shell-footer-study-app';
  const fCenterSep2 = document.createElement('span');
  fCenterSep2.className = 'shell-footer-study-sep';
  const fCenterTimer = document.createElement('span');
  fCenterTimer.className = 'shell-footer-study-timer';
  fCenter.append(fCenterKey, fCenterSep1, fCenterApp, fCenterSep2, fCenterTimer);

  const fRight = document.createElement('div');
  fRight.className = 'shell-footer-right';
  fRight.id = 'shell-footer-right';
  if (captionsVisible) {
    try { fRight.textContent = 'Captions: on'; } catch (e) {}
  }

  let footerPathPrev = null;
  let footerCountPrev = null;
  let footerPathEl = null;
  let footerCountEl = null;
  let footerFilterPrev = null;
  let footerFilterEl = null;

  let footerCenterPrev = { active: false, key: '', app: '', timer: '' };
  let footerCenterLastRendered = { active: false, key: '', app: '', timer: '' };
  let footerCenterLastCommitAtMs = 0;
  let footerCenterFlashTimeout = null;
  let footerCenterPinnedSnapshot = null;
  let footerCenterPinnedUntilMs = 0;

  footer.append(fLeft, fCenter, fRight);

  function formatElapsedShort(ms) {
    const total = Math.max(0, Math.round(Number(ms) || 0));
    const hours = Math.floor(total / 3600000);
    const minutes = Math.floor((total % 3600000) / 60000);
    const seconds = Math.floor((total % 60000) / 1000);
    const tenths = Math.floor((total % 1000) / 100);
    if (hours > 0) {
      return `${String(hours)}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(tenths)}`;
  }

  function flashFooterCenter() {
    try {
      fCenter.classList.remove('study-progress-flash');
      fCenter.offsetWidth;
      fCenter.classList.add('study-progress-flash');
      if (footerCenterFlashTimeout) clearTimeout(footerCenterFlashTimeout);
      footerCenterFlashTimeout = setTimeout(() => {
        try { fCenter.classList.remove('study-progress-flash'); } catch (e) {}
      }, FLASH_MS);
    } catch (e) {}
  }

  function renderFooterCenterStudyProgress() {
    const nowWall = Date.now();
    let status = null;
    try {
      status = store?.kanjiProgress?.getActiveCardProgressStatus?.() || null;
    } catch (e) {
      status = null;
    }

    let nextSnapshot = { active: false, key: '', app: '', timer: '' };
    if (status && status.active && status.appId) {
      const baseElapsed = Math.max(0, Math.round(Number(status.elapsedMs) || 0));
      const runningBonus = (status.isRunning && Number.isFinite(Number(status.statusWallMs)))
        ? Math.max(0, nowWall - Math.round(Number(status.statusWallMs)))
        : 0;
      const elapsed = baseElapsed + runningBonus;
      const entryKey = String(status.entryKey || '').trim();
      const displayKey = entryKey || String(status.studyId || '').trim().split('|').slice(-1)[0] || '';
      nextSnapshot = {
        active: true,
        key: displayKey,
        app: String(status.appId || '').trim(),
        timer: formatElapsedShort(elapsed),
      };
    }

    const isPinnedActive = !!footerCenterPinnedSnapshot && nowWall < footerCenterPinnedUntilMs;
    const commitAt = Math.max(0, Math.round(Number(status?.lastCommitAtMs) || 0));
    if (commitAt > 0 && commitAt !== footerCenterLastCommitAtMs) {
      footerCenterLastCommitAtMs = commitAt;
      if (!isPinnedActive) {
        const pinSource = (footerCenterLastRendered && footerCenterLastRendered.active)
          ? footerCenterLastRendered
          : nextSnapshot;
        footerCenterPinnedSnapshot = { ...pinSource };
        footerCenterPinnedUntilMs = nowWall + PIN_MS;
        if (footerCenterPinnedSnapshot.active) flashFooterCenter();
      }
    }

    const usePinned = !!footerCenterPinnedSnapshot && nowWall < footerCenterPinnedUntilMs;
    const renderSnapshot = usePinned ? footerCenterPinnedSnapshot : nextSnapshot;
    if (!usePinned) {
      footerCenterPinnedSnapshot = null;
      footerCenterPinnedUntilMs = 0;
    }

    const isActive = !!renderSnapshot.active;
    const keyText = isActive ? String(renderSnapshot.key || '') : '';
    const appText = isActive ? String(renderSnapshot.app || '') : '';
    const timerText = isActive ? String(renderSnapshot.timer || '') : '';
    const sepText = isActive ? ' • ' : '';

    if (footerCenterPrev.active !== isActive) {
      footerCenterPrev.active = isActive;
    }
    if (footerCenterPrev.key !== keyText) {
      footerCenterPrev.key = keyText;
      fCenterKey.textContent = keyText;
    }
    if (footerCenterPrev.app !== appText) {
      footerCenterPrev.app = appText;
      fCenterApp.textContent = appText;
    }
    if (footerCenterPrev.timer !== timerText) {
      footerCenterPrev.timer = timerText;
      fCenterTimer.textContent = timerText;
    }
    if (fCenterSep1.textContent !== sepText) fCenterSep1.textContent = sepText;
    if (fCenterSep2.textContent !== sepText) fCenterSep2.textContent = sepText;

    footerCenterLastRendered = { active: isActive, key: keyText, app: appText, timer: timerText };
  }

  function updateFooterRight({ activeCollection, activeId } = {}) {
    try {
      const path = (store && store.settings && typeof store.settings.get === 'function')
        ? (store.settings.get('shell.activeCollectionPath', { consumerId: 'shell' }) || (activeCollection?.key || ''))
        : (activeCollection?.key || '');
      const countRaw = (store && store.settings && typeof store.settings.get === 'function')
        ? store.settings.get('shell.activeCollectionEntriesCount', { consumerId: 'shell' })
        : null;
      const count = Number.isFinite(Number(countRaw)) ? Number(countRaw) : (Array.isArray(activeCollection?.entries) ? activeCollection.entries.length : null);

      if (path !== footerPathPrev) {
        footerPathPrev = path;
        if (!footerPathEl) {
          footerPathEl = document.createElement('span');
          footerPathEl.className = 'shell-footer-collection-path';
          fRight.appendChild(footerPathEl);
        }
        footerPathEl.textContent = path || '';
      }

      if (count !== footerCountPrev) {
        footerCountPrev = count;
        if (!footerCountEl) {
          footerCountEl = document.createElement('span');
          footerCountEl.className = 'shell-footer-collection-count';
          fRight.appendChild(footerCountEl);
        }
        footerCountEl.textContent = (count !== null && count !== undefined && !Number.isNaN(Number(count))) ? ` ${count} entries` : '';
      }

      try {
        const collId = activeId || activeCollection?.key || null;
        let filterLabel = '';
        if (collId && store && store.collections && typeof store.collections.loadCollectionState === 'function') {
          const st = store.collections.loadCollectionState(collId) || {};
          const held = String(st?.heldTableSearch || '').trim();
          const sf = String(st?.studyFilter || '').trim();
          const f = held || (sf ? sf : '');
          if (f) filterLabel = `filter: ${f}`;
        }

        if (filterLabel !== footerFilterPrev) {
          footerFilterPrev = filterLabel;
          if (!footerFilterEl) {
            footerFilterEl = document.createElement('span');
            footerFilterEl.className = 'shell-footer-collection-filter';
            fRight.appendChild(footerFilterEl);
          }
          footerFilterEl.textContent = filterLabel ? ` • ${filterLabel}` : '';
        }
      } catch (e) {}
    } catch (e) {}
  }

  // Left area helpers: status + warnings API for other components
  let footerLeftStatusPrev = '';
  let footerLeftWarningsPrev = null; // array or null

  function renderFooterLeft() {
    try {
      const parts = [];
      if (footerLeftStatusPrev) parts.push(String(footerLeftStatusPrev));
      if (Array.isArray(footerLeftWarningsPrev) && footerLeftWarningsPrev.length) {
        const w = footerLeftWarningsPrev.filter(Boolean).map(String).join(' • ');
        if (w) parts.push(w);
      }
      fLeft.textContent = parts.join(' \n');
    } catch (e) {}
  }

  function setLeftStatus(text) {
    footerLeftStatusPrev = (text == null) ? '' : String(text || '');
    renderFooterLeft();
  }

  function setLeftWarnings(list) {
    try {
      if (!list) footerLeftWarningsPrev = null;
      else if (Array.isArray(list)) footerLeftWarningsPrev = list.map(x => (x == null ? '' : String(x))).filter(Boolean);
      else footerLeftWarningsPrev = [String(list)];
    } catch (e) { footerLeftWarningsPrev = null; }
    renderFooterLeft();
  }

  function setLeftContent({ status = '', warnings = null } = {}) {
    setLeftStatus(status);
    setLeftWarnings(warnings);
  }

  function renderFromStore({ activeCollection = null, activeId = null } = {}) {
    renderFooterCenterStudyProgress();
    updateFooterRight({ activeCollection, activeId });
  }

  renderFooterCenterStudyProgress();
  const footerCenterTicker = setInterval(() => {
    renderFooterCenterStudyProgress();
  }, 120);

  function onBeforeUnload() {
    try { clearInterval(footerCenterTicker); } catch (e) {}
  }

  try { window.addEventListener('beforeunload', onBeforeUnload); } catch (e) {}

  function teardown() {
    try { clearInterval(footerCenterTicker); } catch (e) {}
    try { if (footerCenterFlashTimeout) clearTimeout(footerCenterFlashTimeout); } catch (e) {}
    try { window.removeEventListener('beforeunload', onBeforeUnload); } catch (e) {}
  }

  return {
    el: footer,
    leftEl: fLeft,
    centerEl: fCenter,
    rightEl: fRight,
    renderFromStore,
    teardown,
    setLeftContent,
    setLeftStatus,
    setLeftWarnings,
  };
}
