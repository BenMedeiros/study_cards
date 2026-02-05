export function createAppStateManager({ uiState, persistence, emitter }) {
  function getState(appId) {
    try {
      if (!appId) return {};
      const v = uiState?.apps?.[appId];
      return (v && typeof v === 'object') ? { ...v } : {};
    } catch {
      return {};
    }
  }

  function setState(appId, patch, opts = {}) {
    try {
      if (!appId) return;
      uiState.apps = uiState.apps || {};
      const prev = (uiState.apps[appId] && typeof uiState.apps[appId] === 'object') ? uiState.apps[appId] : {};
      const patchObj = (patch && typeof patch === 'object') ? patch : {};
      uiState.apps[appId] = { ...prev, ...patchObj };

      persistence.markDirty({ apps: true });
      persistence.scheduleFlush({ immediate: !!opts.immediate });
      const notify = (opts.notify ?? !opts.silent) !== false;
      if (notify) emitter.emit();
    } catch {
      // ignore
    }
  }

  return { getState, setState };
}
