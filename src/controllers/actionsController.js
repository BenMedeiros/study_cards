function asString(v) {
  return (v == null) ? '' : String(v);
}

function deepClone(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch (e) { return value; }
}

function customTokenFromId(id) {
  return `__custom:${asString(id).trim()}`;
}

const KANJI_STUDY_DEFAULT_CUSTOM_BUTTONS = [
  {
    id: 'prev',
    icon: '←',
    text: 'Prev',
    caption: '←',
    shortcut: 'ArrowLeft',
    actions: [{ actionId: 'prev', delayMs: 0 }],
  },
  {
    id: 'sound.kanji',
    icon: '🔊',
    text: 'Sound',
    caption: '',
    shortcut: '',
    actions: [{ actionId: 'sound.kanji', delayMs: 0 }],
  },
  {
    id: 'sound.reading',
    icon: '🔊',
    text: 'Sound',
    caption: 'Space',
    shortcut: ' ',
    actions: [{ actionId: 'sound.reading', delayMs: 0 }],
  },
  {
    id: 'learned',
    icon: '✅',
    text: 'Learned',
    caption: 'V',
    shortcut: 'v',
    actions: [{ actionId: 'learned', delayMs: 0 }],
  },
  {
    id: 'practice',
    icon: '🎯',
    text: 'Practice',
    caption: 'X',
    shortcut: 'x',
    actions: [{ actionId: 'practice', delayMs: 0 }],
  },
  {
    id: 'next',
    icon: '→',
    text: 'Next',
    caption: '→',
    shortcut: 'ArrowRight',
    actions: [{ actionId: 'next', delayMs: 0 }],
  },
];

const KANJI_STUDY_DEFAULT_ORDER = KANJI_STUDY_DEFAULT_CUSTOM_BUTTONS.map(btn => customTokenFromId(btn.id));

export function getKanjiStudyDefaultFooterPrefs() {
  return {
    activeConfigId: 'default',
    configs: [
      {
        id: 'default',
        name: 'Default',
        order: KANJI_STUDY_DEFAULT_ORDER.slice(),
        controls: {},
        customButtons: deepClone(KANJI_STUDY_DEFAULT_CUSTOM_BUTTONS),
        hotkeysDisabled: false,
      },
    ],
  };
}

export function createKanjiStudyFooterActionsController({
  showPrev,
  showNext,
  speakField,
  getSearchTerm,
  openInNewTab,
  kanjiProgress,
  getCurrentCollectionKey,
  getCurrentEntryKey,
  onProgressChanged,
} = {}) {
  const run = {
    showPrev: (typeof showPrev === 'function') ? showPrev : () => {},
    showNext: (typeof showNext === 'function') ? showNext : () => {},
    speakField: (typeof speakField === 'function') ? speakField : () => {},
    getSearchTerm: (typeof getSearchTerm === 'function') ? getSearchTerm : () => '',
    getCurrentCollectionKey: (typeof getCurrentCollectionKey === 'function') ? getCurrentCollectionKey : () => '',
    getCurrentEntryKey: (typeof getCurrentEntryKey === 'function') ? getCurrentEntryKey : () => '',
    kanjiProgress: (kanjiProgress && typeof kanjiProgress === 'object') ? kanjiProgress : null,
    onProgressChanged: (typeof onProgressChanged === 'function') ? onProgressChanged : () => {},
    openInNewTab: (typeof openInNewTab === 'function')
      ? openInNewTab
      : (url) => { try { window.open(url, '_blank'); } catch (e) {} },
  };

  function withCurrentEntry(actionName, handler) {
    return () => {
      try {
        const entryKey = asString(run.getCurrentEntryKey()).trim();
        if (!entryKey) return;
        const collectionKey = asString(run.getCurrentCollectionKey()).trim();
        handler(entryKey, collectionKey);
        try { run.onProgressChanged({ actionName, entryKey, collectionKey }); } catch (e) {}
      } catch (e) {}
    };
  }

  function progressCall(methodName) {
    return withCurrentEntry(methodName, (entryKey, collectionKey) => {
      const mgr = run.kanjiProgress;
      const fn = mgr && typeof mgr[methodName] === 'function' ? mgr[methodName] : null;
      if (!fn) return;
      try { fn(entryKey, { collectionKey }); } catch (e) {}
    });
  }

  const runToggleLearned = progressCall('toggleKanjiLearned');
  const runTogglePractice = progressCall('toggleKanjiFocus');
  const runSetStateLearned = progressCall('setStateLearned');
  const runSetStateNull = progressCall('setStateNull');
  const runSetStateFocus = progressCall('setStateFocus');

  function getCurrentProgressFlags() {
    try {
      const mgr = run.kanjiProgress;
      const entryKey = asString(run.getCurrentEntryKey()).trim();
      const collectionKey = asString(run.getCurrentCollectionKey()).trim();
      if (!mgr || !entryKey) return { isLearned: false, isFocus: false };

      const isLearned = (typeof mgr.isKanjiLearned === 'function')
        ? !!mgr.isKanjiLearned(entryKey, { collectionKey })
        : false;
      const isFocus = (typeof mgr.isKanjiFocus === 'function')
        ? !!mgr.isKanjiFocus(entryKey, { collectionKey })
        : false;

      return { isLearned, isFocus };
    } catch (e) {
      return { isLearned: false, isFocus: false };
    }
  }

  // baseControls are provided from defaults/base; do not duplicate here

  function withSearchUrl(baseUrl) {
    return () => {
      const term = asString(run.getSearchTerm()).trim();
      if (!term) return;
      run.openInNewTab(`${baseUrl}${encodeURIComponent(term)}`);
    };
  }

  // Link templates keyed by logical name. Templates are simple base URLs
  // that will receive the encoded search term. Keeping them here makes it
  // easier to add more link targets later or expose them to UI.
  const LINK_TEMPLATES = {
    'chatgpt': 'https://chat.openai.com/?q=',
    'google.images': 'https://www.google.com/search?tbm=isch&q=',
    'translate': 'https://translate.google.com/?sl=auto&tl=en&text=',
    'google': 'https://www.google.com/search?q=',
    'jisho': 'https://jisho.org/search/',
    'wiktionary': 'https://en.wiktionary.org/wiki/',
  };

  const actionDefinitions = [
    { id: 'prev', fnName: 'view.showPrev', actionField: 'app.kanjiStudyCardView', invoke: () => run.showPrev() },
    { id: 'next', fnName: 'view.showNext', actionField: 'app.kanjiStudyCardView', invoke: () => run.showNext() },

    // Use a generic 'Sound' label for all sound actions; the specific
    // actionField indicates which entry field will be spoken.
    { id: 'sound.kanji', fnName: 'entry.speakField', actionField: 'entry.kanji', invoke: () => run.speakField('kanji') },
    { id: 'sound.lexicalClass', fnName: 'entry.speakField', actionField: 'entry.lexicalClass', invoke: () => run.speakField('lexicalClass') },
    { id: 'sound.meaning', fnName: 'entry.speakField', actionField: 'entry.meaning', invoke: () => run.speakField('meaning') },
    { id: 'sound.orthography', fnName: 'entry.speakField', actionField: 'entry.orthography', invoke: () => run.speakField('orthography') },
    { id: 'sound.reading', fnName: 'entry.speakField', actionField: 'entry.reading', invoke: () => run.speakField('reading') },
    { id: 'sound.type', fnName: 'entry.speakField', actionField: 'entry.type', invoke: () => run.speakField('type') },

    // Progress-related functions use a fully-qualified fnName to make it
    // clearer where the operation is performed.
    { id: 'learned', fnName: 'manager.studyProgress.toggleKanjiLearned', actionField: 'entry.kanji', invoke: runToggleLearned },
    { id: 'practice', fnName: 'manager.studyProgress.toggleKanjiFocus', actionField: 'entry.kanji', invoke: runTogglePractice },
    { id: 'setStateLearned', fnName: 'manager.studyProgress.setStateLearned', actionField: 'entry.kanji', invoke: runSetStateLearned },
    { id: 'setStateNull', fnName: 'manager.studyProgress.setStateNull', actionField: 'entry.kanji', invoke: runSetStateNull },
    { id: 'setStateFocus', fnName: 'manager.studyProgress.setStateFocus', actionField: 'entry.kanji', invoke: runSetStateFocus },

    // Generic link actions that reuse a single link-opening helper. Each
    // definition includes a `linkKey` which maps into LINK_TEMPLATES.
    { id: 'link.chatgpt', fnName: 'link.open[chatgpt]', actionField: 'entry.kanji', invoke: withSearchUrl(LINK_TEMPLATES['chatgpt']) },
    { id: 'link.google.images', fnName: 'link.open[google.images]', actionField: 'entry.kanji', invoke: withSearchUrl(LINK_TEMPLATES['google.images']) },
    {
      id: 'link.translate',
      fnName: 'link.open',
      actionField: 'entry.kanji',
      fnName: 'link.open[translate]',
      invoke: () => {
        const term = asString(run.getSearchTerm()).trim();
        if (!term) return;
        // translate requires a different URL form (text param + op=translate)
        run.openInNewTab(`${LINK_TEMPLATES['translate']}${encodeURIComponent(term)}&op=translate`);
      },
    },
    { id: 'link.google', fnName: 'link.open[google]', actionField: 'entry.kanji', invoke: withSearchUrl(LINK_TEMPLATES['google']) },
    { id: 'link.jisho', fnName: 'link.open[jisho]', actionField: 'entry.kanji', invoke: withSearchUrl(LINK_TEMPLATES['jisho']) },
    { id: 'link.wiktionary', fnName: 'link.open[wiktionary]', actionField: 'entry.kanji', invoke: withSearchUrl(LINK_TEMPLATES['wiktionary']) },
  ];

  // Build a minimal set of baseControls from actionDefinitions so callers
  // that expect control descriptors (settings UI, footer builder) continue
  // to work when base control definitions are not duplicated elsewhere.
  const baseControls = (Array.isArray(actionDefinitions) ? actionDefinitions.map(ad => ({
    key: String(ad.id || ad.actionId || ''),
    text: String(ad.text || ad.id || ''),
    icon: String(ad.icon || ''),
    caption: String(ad.caption || ''),
    shortcut: String(ad.shortcut || ''),
    actionKey: String(ad.id || ad.actionId || ''),
    fnName: String(ad.fnName || ''),
    states: Array.isArray(ad.states) ? ad.states.slice() : [],
  })) : []);

  return {
    appId: 'kanjiStudy',
    baseControls,
    actionDefinitions,
    getCurrentProgressFlags,
    defaultPrefs: deepClone(getKanjiStudyDefaultFooterPrefs()),
  };
}

export default {
  createKanjiStudyFooterActionsController,
  getKanjiStudyDefaultFooterPrefs,
};