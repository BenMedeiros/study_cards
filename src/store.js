import { createEmitter } from './utils/emitter.js';
import { createPersistenceManager } from './managers/persistenceManager.js';
import { createUIStateManager } from './managers/uiStateManager.js';
import { createProgressManager } from './managers/progressManager.js';
import { createGrammarProgressManager } from './managers/grammarProgressManager.js';
import { createStudyTimeManager } from './managers/studyTimeManager.js';
import { createCollectionsManager } from './managers/collectionsManager.js';

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

  const kanjiProgress = createProgressManager({ uiState, persistence, emitter, kanjiProgressKey: 'kanji_progress' });
  const grammarProgress = createGrammarProgressManager({ uiState, persistence, emitter, grammarProgressKey: 'grammar_progress' });
  const studyTime = createStudyTimeManager({ uiState, persistence, emitter, studyTimeKey: 'study_time' });
  const ui = createUIStateManager({ uiState, persistence, emitter });
  const collections = createCollectionsManager({ state, uiState, persistence, emitter, progressManager: kanjiProgress, grammarProgressManager: grammarProgress });

  function subscribe(fn) {
    return emitter.subscribe(fn);
  }

  async function initialize() {
    try {
      await persistence.load();

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

      if (restored && (state._availableCollectionPaths.includes(restored) || collections.isCollectionSetVirtualKey(restored))) {
        await collections.setActiveCollectionId(restored);
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
    collections: {
      getCollections: collections.getCollections,
      getAvailableCollections: collections.getAvailableCollections,
      getActiveCollectionId: collections.getActiveCollectionId,
      getActiveCollection: collections.getActiveCollection,
      setActiveCollectionId: collections.setActiveCollectionId,
      syncCollectionFromURL: collections.syncCollectionFromURL,
      listCollectionDir: collections.listCollectionDir,
      loadCollectionSetsForFolder: collections.loadCollectionSetsForFolder,
      getCachedCollectionSetsForFolder: collections.getCachedCollectionSetsForFolder,
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
      getLastRoute: ui.getLastRoute,
      setLastRoute: ui.setLastRoute,
      getCollectionBrowserPath: () => (typeof state.collectionBrowserPath === 'string') ? state.collectionBrowserPath : null,
      setCollectionBrowserPath: (path) => {
        state.collectionBrowserPath = typeof path === 'string' ? path : String(path || '');
      },
      getVoiceSettings: ui.getVoiceSettings,
      setVoiceSettings: ui.setVoiceSettings,
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
