export function createUIStateManager({ uiState, persistence, emitter }) {
  // ============================================================================
  // Shell State (routes, voice settings, global UI state)
  // ============================================================================

  function getLastRoute() {
    try {
      const v = uiState?.shell?.lastRoute;
      return (typeof v === 'string' && v.trim()) ? v : null;
    } catch {
      return null;
    }
  }

  function setLastRoute(routeOrPath) {
    try {
      let path = null;
      if (routeOrPath && typeof routeOrPath === 'object') {
        const pathname = typeof routeOrPath.pathname === 'string' ? routeOrPath.pathname : '/';
        const query = routeOrPath.query;
        const search = (query && typeof query.toString === 'function') ? query.toString() : '';
        path = search ? `${pathname}?${search}` : pathname;
      } else {
        path = String(routeOrPath || '').trim();
      }
      if (!path) return;
      if (!path.startsWith('/')) path = `/${path.replace(/^#+/, '')}`;

      uiState.shell = uiState.shell || {};
      if (uiState.shell.lastRoute === path) return;
      uiState.shell.lastRoute = path;

      persistence.markDirty({ shell: true });
      persistence.scheduleFlush();
    } catch {
      // ignore
    }
  }

  function getVoiceSettings() {
    try {
      const v = uiState?.shell?.voice;
      return (v && typeof v === 'object') ? { ...v } : null;
    } catch {
      return null;
    }
  }

  function setVoiceSettings(patch) {
    try {
      uiState.shell = uiState.shell || {};
      const prev = (uiState.shell.voice && typeof uiState.shell.voice === 'object') ? uiState.shell.voice : {};
      const patchObj = (patch && typeof patch === 'object') ? patch : {};
      const next = { ...prev, ...patchObj };

      if (patchObj.engVoice && typeof patchObj.engVoice === 'object') {
        const prevEng = (prev.engVoice && typeof prev.engVoice === 'object') ? prev.engVoice : {};
        next.engVoice = { ...prevEng, ...patchObj.engVoice };
      }
      if (patchObj.jpVoice && typeof patchObj.jpVoice === 'object') {
        const prevJp = (prev.jpVoice && typeof prev.jpVoice === 'object') ? prev.jpVoice : {};
        next.jpVoice = { ...prevJp, ...patchObj.jpVoice };
      }

      for (const key of ['engVoice', 'jpVoice']) {
        const obj = next[key];
        if (!obj || typeof obj !== 'object') continue;
        if (obj.voiceURI === '') obj.voiceURI = null;
        if (obj.voiceName === '') obj.voiceName = null;
      }

      uiState.shell.voice = next;
      persistence.markDirty({ shell: true });
      persistence.scheduleFlush();
    } catch {
      // ignore
    }
  }

  function getShellState() {
    try {
      const v = uiState?.shell;
      return (v && typeof v === 'object') ? { ...v } : {};
    } catch {
      return {};
    }
  }

  function setShellState(patch, opts = {}) {
    try {
      uiState.shell = uiState.shell || {};
      const prev = (uiState.shell && typeof uiState.shell === 'object') ? uiState.shell : {};
      const patchObj = (patch && typeof patch === 'object') ? patch : {};
      uiState.shell = { ...prev, ...patchObj };

      persistence.markDirty({ shell: true });
      persistence.scheduleFlush({ immediate: !!opts.immediate });
      const notify = (opts.notify ?? !opts.silent) !== false;
      if (notify) emitter.emit();
    } catch {
      // ignore
    }
  }

  // ============================================================================
  // App State (per-app/view state storage)
  // ============================================================================

  function getAppState(appId) {
    try {
      if (!appId) return {};
      const v = uiState?.apps?.[appId];
      return (v && typeof v === 'object') ? { ...v } : {};
    } catch {
      return {};
    }
  }

  function setAppState(appId, patch, opts = {}) {
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

  return {
    // Shell state
    getLastRoute,
    setLastRoute,
    getVoiceSettings,
    setVoiceSettings,
    getShellState,
    setShellState,

    // App state
    getAppState,
    setAppState,
  };
}
