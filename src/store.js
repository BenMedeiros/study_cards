import { createPersistenceManager } from './managers/persistenceManager.js';
import { createUIStateManager } from './managers/uiStateManager.js';
import { createStudyProgressManager } from './managers/studyProgressManager.js';
import { createCollectionsManager } from './managers/collectionsManager.js';
import createCollectionDatabaseManager from './managers/collectionDatabaseManager.js';
import { createSettingsManager, setGlobalSettingsManager } from './managers/settingsManager.js';
import studyManagerController from './views/studyManagerView/studyManagerController.js';

function safeClone(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch { return null; }
}

export function createStore() {
  // In-memory UI state cache. Persisted by persistenceManager.
  const uiState = {
    shell: {},
    apps: {},
    collections: {},
    kv: {
      study_progress: {},
      study_time: null,
    },
  };

  // Non-persisted runtime state
  const state = {
    collections: [],
    activeCollectionId: null,
    collectionTree: null,
    collectionBrowserPath: null,
    _availableCollectionPaths: [],
  };

  // Non-persisted, session-scoped analysis data shared across the app.
  const analysisState = {};
  const analysisSubscribers = new Set();

  function notifyAnalysisSubscribers() {
    for (const cb of Array.from(analysisSubscribers)) {
      try { cb(); } catch (e) {}
    }
  }

  function subscribeAnalysis(fn) {
    if (typeof fn !== 'function') return () => {};
    analysisSubscribers.add(fn);
    return () => { analysisSubscribers.delete(fn); };
  }

  function getAnalysisState() {
    return safeClone(analysisState) || {};
  }

  function getAnalysisEntry(key) {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) return null;
    return safeClone(analysisState[normalizedKey]);
  }

  function setAnalysisEntry(key, value, { silent = false } = {}) {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) return;
    if (value === undefined) {
      try { delete analysisState[normalizedKey]; } catch (e) {}
    } else {
      const cloned = safeClone(value);
      analysisState[normalizedKey] = cloned === null && value !== null ? value : cloned;
    }
    if (!silent) {
      notifyAnalysisSubscribers();
    }
  }

  function setAnalysisState(nextState, { silent = false } = {}) {
    const normalized = (nextState && typeof nextState === 'object') ? (safeClone(nextState) || {}) : {};
    for (const key of Object.keys(analysisState)) delete analysisState[key];
    Object.assign(analysisState, normalized);
    if (!silent) {
      notifyAnalysisSubscribers();
    }
  }

  function mergeAnalysisState(patch, { silent = false } = {}) {
    const normalized = (patch && typeof patch === 'object') ? (safeClone(patch) || {}) : null;
    if (!normalized) return;
    Object.assign(analysisState, normalized);
    if (!silent) {
      notifyAnalysisSubscribers();
    }
  }

  const persistence = createPersistenceManager({ uiState, studyProgressKey: 'study_progress', studyTimeKey: 'study_time' });

  const studyProgress = createStudyProgressManager({ uiState, persistence, studyProgressKey: 'study_progress', studyTimeKey: 'study_time' });
  const kanjiProgress = studyProgress;
  const studyTime = studyProgress;
  const ui = createUIStateManager({ uiState, persistence });

  const settings = createSettingsManager({
    getShellState: ui.getShellState,
    setShellState: ui.setShellState,
    getAppState: ui.getAppState,
    setAppState: ui.setAppState,
  });

  // Register the created SettingsManager globally so other modules may obtain it
  try { setGlobalSettingsManager(settings); } catch (e) {}
  // Make SettingsManager available immediately (reads from localStorage directly)
  try { settings.setReady(true); } catch (e) {}

  const collectionDB = createCollectionDatabaseManager({
    onValidationStateChange: (snapshot) => {
      setAnalysisEntry('validationManager', snapshot, { silent: false });
    },
  });
  setAnalysisEntry('validationManager', collectionDB?.validations?.getSnapshot?.() || null, { silent: true });

  try {
    studyManagerController.subscribe((snapshot) => {
      setAnalysisEntry('studyManager', snapshot || null, { silent: true });
      notifyAnalysisSubscribers();
    });
  } catch (e) {}
  const collections = createCollectionsManager({ state, uiState, persistence, progressManager: kanjiProgress, collectionDB, settings });

  async function initialize() {
    try {
      await persistence.load();
      // SettingsManager already marked ready at creation (uses localStorage).

      // Ensure expected kv shapes exist.
      studyProgress.ensureStudyProgressMap();
      studyTime.ensureStudyTimeRecord();

      const paths = await collections.loadSeedCollections();
      state.collections = [];

      // Restore active collection from persisted settings.
      let restored = null;
      try {
        if (settings && typeof settings.get === 'function' && typeof settings.isReady === 'function' && settings.isReady()) {
          const fromId = settings.get('shell.activeCollectionId', { consumerId: 'store.initialize' });
          const fromPath = settings.get('shell.activeCollectionPath', { consumerId: 'store.initialize' });
          restored = (typeof fromId === 'string' && fromId.trim())
            ? fromId.trim()
            : ((typeof fromPath === 'string' && fromPath.trim()) ? fromPath.trim() : null);
        }
      } catch {
        restored = null;
      }

      if (restored && state._availableCollectionPaths.includes(restored)) {
        await collections.setActiveCollectionId(restored);
      } else if (restored) {
        try { console.warn(`[Store] Ignoring unknown persisted active collection: ${restored}`); } catch (e) {}
      }

      if (!state.activeCollectionId && Array.isArray(paths) && paths.length > 0) {
        await collections.setActiveCollectionId(paths[0]);
      }
      try {
        studyManagerController.init({ store: api });
        setAnalysisEntry('studyManager', studyManagerController.getSnapshot?.() || null, { silent: true });
      } catch (e) {}
    } catch (err) {
      console.error(`Failed to initialize store: ${err.message}`);
      state.collections = [];
      state.activeCollectionId = null;
    }
    persistence.installFlushGuards();
  }

  const api = {
    initialize,
    settings,
    collectionDB,
    collections: {
      getCollections: collections.getCollections,
      subscribe: collections.subscribe,
      getAvailableCollections: collections.getAvailableCollections,
      getActiveCollectionId: collections.getActiveCollectionId,
      getActiveCollection: collections.getActiveCollection,
      setActiveCollectionId: collections.setActiveCollectionId,
      syncCollectionFromURL: collections.syncCollectionFromURL,
      listCollectionDir: collections.listCollectionDir,
      // Deprecated APIs removed: collection sets are no longer supported.
      loadCollection: collections.loadCollection,
      prefetchCollectionsInFolder: collections.prefetchCollectionsInFolder,
      loadCollectionState: collections.loadCollectionState,
      saveCollectionState: collections.saveCollectionState,
      deleteCollectionStateKeys: collections.deleteCollectionStateKeys,
      getInheritedFolderMetadata: collections.getInheritedFolderMetadata,
      // Debug/read-only runtime inspection helpers (Entity Explorer)
      debugListRuntimeMaps: collections.debugListRuntimeMaps,
      debugGetRuntimeMapDump: collections.debugGetRuntimeMapDump,

      ensureWordSentenceIndexBuiltForTop: collections.ensureWordSentenceIndexBuiltForTop,

      // Collection view utilities (filtering, expansion, shuffle)
      getCollectionViewForCollection: collections.getCollectionViewForCollection,
      getActiveCollectionView: collections.getActiveCollectionView,
      getActiveCollectionFilteredSet: collections.getActiveCollectionFilteredSet,
      getEntryStudyKey: collections.getEntryStudyKey,
      entryMatchesTableSearch: collections.entryMatchesTableSearch,
      filterEntriesAndIndicesByTableSearch: collections.filterEntriesAndIndicesByTableSearch,
      getCollectionEntriesWithRelated: collections.getCollectionEntriesWithRelated,

      // Collection actions (state modifications)
      shuffleCollection: collections.shuffleCollection,
      clearCollectionShuffle: collections.clearCollectionShuffle,
      setStudyFilter: collections.setStudyFilter,
      setHeldTableSearch: collections.setHeldTableSearch,
      clearLearnedForCollection: collections.clearLearnedForCollection,
    },
    shell: {
      getLastRoute: () => {
        try {
          if (settings && typeof settings.isReady === 'function' && settings.isReady()) {
            const v = settings.get('shell.lastRoute', { consumerId: 'store.shell' });
            return (typeof v === 'string' && v.trim()) ? v : null;
          }
        } catch (e) {}
        return ui.getLastRoute();
      },
      setLastRoute: (routeOrPath) => {
        try {
          // Keep existing normalization semantics.
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

          if (settings && typeof settings.set === 'function') {
            settings.set('shell.lastRoute', path, { consumerId: 'store.shell', silent: true });
            return;
          }
        } catch (e) {}
        ui.setLastRoute(routeOrPath);
      },
      getCollectionBrowserPath: () => (typeof state.collectionBrowserPath === 'string') ? state.collectionBrowserPath : null,
      setCollectionBrowserPath: (path) => {
        state.collectionBrowserPath = typeof path === 'string' ? path : String(path || '');
      },
      getVoiceSettings: () => {
        try {
          if (settings && typeof settings.isReady === 'function' && settings.isReady()) {
            const v = settings.get('shell.voice', { consumerId: 'store.shell' });
            if (v && typeof v === 'object') return { ...v };
            return null;
          }
        } catch (e) {}
        return ui.getVoiceSettings();
      },
      setVoiceSettings: (patch) => {
        // Preserve the prior deep-merge behavior of ui.setVoiceSettings.
        try {
          if (!(settings && typeof settings.set === 'function' && typeof settings.get === 'function')) {
            ui.setVoiceSettings(patch);
            return;
          }

          const prev = (settings.isReady && settings.isReady()) ? (settings.get('shell.voice', { consumerId: 'store.shell' }) || {}) : {};
          const prevObj = (prev && typeof prev === 'object') ? prev : {};
          const patchObj = (patch && typeof patch === 'object') ? patch : {};
          const next = { ...prevObj, ...patchObj };

          if (patchObj.engVoice && typeof patchObj.engVoice === 'object') {
            const prevEng = (prevObj.engVoice && typeof prevObj.engVoice === 'object') ? prevObj.engVoice : {};
            next.engVoice = { ...prevEng, ...patchObj.engVoice };
          }
          if (patchObj.jpVoice && typeof patchObj.jpVoice === 'object') {
            const prevJp = (prevObj.jpVoice && typeof prevObj.jpVoice === 'object') ? prevObj.jpVoice : {};
            next.jpVoice = { ...prevJp, ...patchObj.jpVoice };
          }

          for (const key of ['engVoice', 'jpVoice']) {
            const obj = next[key];
            if (!obj || typeof obj !== 'object') continue;
            if (obj.voiceURI === '') obj.voiceURI = null;
            if (obj.voiceName === '') obj.voiceName = null;
          }

          settings.set('shell.voice', next, { consumerId: 'store.shell' });
        } catch (e) {
          try { ui.setVoiceSettings(patch); } catch (e2) {}
        }
      },
      getState: ui.getShellState,
      setState: ui.setShellState,
    },
    apps: {
      getState: ui.getAppState,
      setState: ui.setAppState,
    },
    analysis: {
      getState: getAnalysisState,
      getEntry: getAnalysisEntry,
      subscribe: subscribeAnalysis,
      setState: setAnalysisState,
      mergeState: mergeAnalysisState,
      setEntry: setAnalysisEntry,
    },
    kanjiProgress: {
      isKanjiLearned: kanjiProgress.isKanjiLearned,
      isKanjiFocus: kanjiProgress.isKanjiFocus,
      toggleKanjiLearned: kanjiProgress.toggleKanjiLearned,
      toggleKanjiFocus: kanjiProgress.toggleKanjiFocus,
      setStateLearned: kanjiProgress.setStateLearned,
      setStateNull: kanjiProgress.setStateNull,
      setStateFocus: kanjiProgress.setStateFocus,
      clearLearnedKanji: kanjiProgress.clearLearnedKanji,
      clearLearnedKanjiForValues: kanjiProgress.clearLearnedKanjiForValues,
      getKanjiProgressRecord: kanjiProgress.getKanjiProgressRecord,
      recordSeen: kanjiProgress.recordSeen,
      addStudyTimeMs: kanjiProgress.addStudyTimeMs,
      createCardProgressTracker: kanjiProgress.createCardProgressTracker,
      getActiveCardProgressStatus: kanjiProgress.getActiveCardProgressStatus,
      getFocusKanjiValues: kanjiProgress.getFocusKanjiValues,
      subscribe: kanjiProgress.subscribe,
    },

    studyTime: {
      recordAppCollectionStudySession: studyTime.recordAppCollectionStudySession,
      getStudyTimeRecord: studyTime.getStudyTimeRecord,
      getRecentStudySessions: studyTime.getRecentStudySessions,
      getCollectionStudyStats: studyTime.getCollectionStudyStats,
      getAllCollectionsStudyStats: studyTime.getAllCollectionsStudyStats,
      sumSessionDurations: studyTime.sumSessionDurations,
    },
  };
  return api;
}
