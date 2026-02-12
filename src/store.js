import { createEmitter } from './utils/emitter.js';
import { createPersistenceManager } from './managers/persistenceManager.js';
import { createUIStateManager } from './managers/uiStateManager.js';
import { createStudyProgressManager } from './managers/studyProgressManager.js';
import { createCollectionsManager } from './managers/collectionsManager.js';
import createCollectionDatabaseManager from './managers/collectionDatabaseManager.js';
import { createSettingsManager, setGlobalSettingsManager } from './managers/settingsManager.js';

export function createStore() {
  // In-memory UI state cache. Persisted by persistenceManager.
  const uiState = {
    shell: {},
    apps: {},
    collections: {},
    kv: {
      kanji_progress: {},
      grammar_progress: {},
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

  const emitter = createEmitter();
  const persistence = createPersistenceManager({ uiState, emitter, kanjiProgressKey: 'kanji_progress', grammarProgressKey: 'grammar_progress', studyTimeKey: 'study_time' });

  const studyProgress = createStudyProgressManager({ uiState, persistence, emitter, kanjiProgressKey: 'kanji_progress', grammarProgressKey: 'grammar_progress', studyTimeKey: 'study_time' });
  const kanjiProgress = studyProgress;
  const grammarProgress = studyProgress;
  const studyTime = studyProgress;
  const ui = createUIStateManager({ uiState, persistence, emitter });

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

  const collectionDB = createCollectionDatabaseManager();
  const collections = createCollectionsManager({ state, uiState, persistence, emitter, progressManager: kanjiProgress, grammarProgressManager: grammarProgress, collectionDB, settings });

  function subscribe(fn) {
    return emitter.subscribe(fn);
  }

  async function initialize() {
    try {
      await persistence.load();
      // SettingsManager already marked ready at creation (uses localStorage).

      // Ensure expected kv shapes exist.
      kanjiProgress.ensureKanjiProgressMap();
      grammarProgress.ensureGrammarProgressMap();
      studyTime.ensureStudyTimeRecord();

      const paths = await collections.loadSeedCollections();
      state.collections = [];

      // Restore active collection from persisted shell state.
      let restored = null;
      try {
        restored = uiState?.shell?.activeCollectionId || null;
      } catch {
        restored = null;
      }

      if (restored) {
        if (state._availableCollectionPaths.includes(restored)) {
          await collections.setActiveCollectionId(restored);
        } else {
          throw new Error(`Deprecated or unknown collection id restored from uiState.shell.activeCollectionId: ${restored}`);
        }
        if (!state.activeCollectionId && Array.isArray(paths) && paths.length > 0) {
          await collections.setActiveCollectionId(paths[0]);
        }
      } else if (!state.activeCollectionId && Array.isArray(paths) && paths.length > 0) {
        await collections.setActiveCollectionId(paths[0]);
      }
    } catch (err) {
      console.error(`Failed to initialize store: ${err.message}`);
      state.collections = [];
      state.activeCollectionId = null;
    }

    emitter.emit();
    persistence.installFlushGuards();
  }

  return {
    subscribe,
    initialize,
    settings,
    collections: {
      getCollections: collections.getCollections,
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
      expandEntriesByAdjectiveForm: collections.expandEntriesByAdjectiveForm,
      expandEntriesAndIndicesByAdjectiveForms: collections.expandEntriesAndIndicesByAdjectiveForms,
      getAdjectiveExpansionDeltas: collections.getAdjectiveExpansionDeltas,

      // Collection actions (state modifications)
      shuffleCollection: collections.shuffleCollection,
      clearCollectionShuffle: collections.clearCollectionShuffle,
      setStudyFilter: collections.setStudyFilter,
      setHeldTableSearch: collections.setHeldTableSearch,
      setAdjectiveExpansionForms: collections.setAdjectiveExpansionForms,
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
    kanjiProgress: {
      isKanjiLearned: kanjiProgress.isKanjiLearned,
      isKanjiFocus: kanjiProgress.isKanjiFocus,
      toggleKanjiLearned: kanjiProgress.toggleKanjiLearned,
      toggleKanjiFocus: kanjiProgress.toggleKanjiFocus,
      clearLearnedKanji: kanjiProgress.clearLearnedKanji,
      clearLearnedKanjiForValues: kanjiProgress.clearLearnedKanjiForValues,
      getKanjiProgressRecord: kanjiProgress.getKanjiProgressRecord,
      recordKanjiSeenInKanjiStudyCard: kanjiProgress.recordKanjiSeenInKanjiStudyCard,
      addTimeMsStudiedInKanjiStudyCard: kanjiProgress.addTimeMsStudiedInKanjiStudyCard,
      getFocusKanjiValues: kanjiProgress.getFocusKanjiValues,
    },

    grammarProgress: {
      isGrammarLearned: grammarProgress.isGrammarLearned,
      isGrammarFocus: grammarProgress.isGrammarFocus,
      toggleGrammarLearned: grammarProgress.toggleGrammarLearned,
      toggleGrammarFocus: grammarProgress.toggleGrammarFocus,
      clearLearnedGrammar: grammarProgress.clearLearnedGrammar,
      getGrammarProgressRecord: grammarProgress.getGrammarProgressRecord,
      recordGrammarSeenInGrammarStudyCard: grammarProgress.recordGrammarSeenInGrammarStudyCard,
      addTimeMsStudiedInGrammarStudyCard: grammarProgress.addTimeMsStudiedInGrammarStudyCard,
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
}
