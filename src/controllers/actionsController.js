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

  const baseControls = [
    { key: 'prev', icon: '←', text: 'Prev', caption: '←', shortcut: 'ArrowLeft', actionKey: 'prev', fnName: 'showPrev', action: () => run.showPrev() },
    { key: 'sound.kanji', icon: '🔊', text: 'Sound', shortcut: '', actionKey: 'sound.kanji', fnName: 'speakField', action: () => run.speakField('kanji') },
    { key: 'sound.reading', icon: '🔊', text: 'Sound', shortcut: ' ', actionKey: 'sound.reading', fnName: 'speakField', action: () => run.speakField('reading') },
    { key: 'learned', icon: '✅', text: 'Learned', caption: 'V', shortcut: 'v', actionKey: 'learned', fnName: 'toggleKanjiLearned', ariaPressed: false, action: runToggleLearned },
    { key: 'practice', icon: '🎯', text: 'Practice', caption: 'X', shortcut: 'x', actionKey: 'practice', fnName: 'toggleKanjiFocus', ariaPressed: false, action: runTogglePractice },
    { key: 'next', icon: '→', text: 'Next', caption: '→', shortcut: 'ArrowRight', actionKey: 'next', fnName: 'showNext', action: () => run.showNext() },
  ];

  function withSearchUrl(baseUrl) {
    return () => {
      const term = asString(run.getSearchTerm()).trim();
      if (!term) return;
      run.openInNewTab(`${baseUrl}${encodeURIComponent(term)}`);
    };
  }

  const actionDefinitions = [
    { id: 'prev', controlKey: 'prev', text: 'Prev', fnName: 'showPrev', actionField: 'app.kanjiStudyCardView', namespace: 'app.kanjiStudyCardView', invoke: () => run.showPrev() },
    { id: 'next', controlKey: 'next', text: 'Next', fnName: 'showNext', actionField: 'app.kanjiStudyCardView', namespace: 'app.kanjiStudyCardView', invoke: () => run.showNext() },

    { id: 'sound.kanji', controlKey: 'sound.kanji', text: 'Sound', fnName: 'speakField', actionField: 'entry.kanji', namespace: 'entry.kanji', invoke: () => run.speakField('kanji') },
    { id: 'sound.lexicalClass', controlKey: 'sound.lexicalClass', text: 'Sound (lexicalClass)', fnName: 'speakField', actionField: 'entry.lexicalClass', namespace: 'entry.lexicalClass', invoke: () => run.speakField('lexicalClass') },
    { id: 'sound.meaning', controlKey: 'sound.meaning', text: 'Sound (meaning)', fnName: 'speakField', actionField: 'entry.meaning', namespace: 'entry.meaning', invoke: () => run.speakField('meaning') },
    { id: 'sound.orthography', controlKey: 'sound.orthography', text: 'Sound (orthography)', fnName: 'speakField', actionField: 'entry.orthography', namespace: 'entry.orthography', invoke: () => run.speakField('orthography') },
    { id: 'sound.reading', controlKey: 'sound.reading', text: 'Sound', fnName: 'speakField', actionField: 'entry.reading', namespace: 'entry.reading', invoke: () => run.speakField('reading') },
    { id: 'sound.type', controlKey: 'sound.type', text: 'Sound (type)', fnName: 'speakField', actionField: 'entry.type', namespace: 'entry.type', invoke: () => run.speakField('type') },

    { id: 'learned', controlKey: 'learned', text: 'Learned', fnName: 'toggleKanjiLearned', actionField: 'manager.studyProgress', namespace: 'manager.studyProgress', invoke: runToggleLearned },
    { id: 'practice', controlKey: 'practice', text: 'Practice', fnName: 'toggleKanjiFocus', actionField: 'manager.studyProgress', namespace: 'manager.studyProgress', invoke: runTogglePractice },
    { id: 'setStateLearned', controlKey: 'setStateLearned', text: 'Set Learned', fnName: 'setStateLearned', actionField: 'manager.studyProgress', namespace: 'manager.studyProgress', invoke: runSetStateLearned },
    { id: 'setStateNull', controlKey: 'setStateNull', text: 'Clear State', fnName: 'setStateNull', actionField: 'manager.studyProgress', namespace: 'manager.studyProgress', invoke: runSetStateNull },
    { id: 'setStateFocus', controlKey: 'setStateFocus', text: 'Set Focus', fnName: 'setStateFocus', actionField: 'manager.studyProgress', namespace: 'manager.studyProgress', invoke: runSetStateFocus },

    { id: 'link.chatgpt', controlKey: 'link.chatgpt', text: 'Link (ChatGPT)', fnName: 'linkChatGPT', actionField: 'entry.kanji', namespace: 'entry.kanji', invoke: withSearchUrl('https://chat.openai.com/?q=') },
    { id: 'link.google.images', controlKey: 'link.google.images', text: 'Link (Google Images)', fnName: 'linkGoogleImages', actionField: 'entry.kanji', namespace: 'entry.kanji', invoke: withSearchUrl('https://www.google.com/search?tbm=isch&q=') },
    {
      id: 'link.translate',
      controlKey: 'link.translate',
      text: 'Link (Google Translate)',
      fnName: 'linkTranslate',
      actionField: 'entry.kanji',
      namespace: 'entry.kanji',
      invoke: () => {
        const term = asString(run.getSearchTerm()).trim();
        if (!term) return;
        run.openInNewTab(`https://translate.google.com/?sl=auto&tl=en&text=${encodeURIComponent(term)}&op=translate`);
      },
    },
    { id: 'link.google', controlKey: 'link.google', text: 'Link (Google)', fnName: 'linkGoogle', actionField: 'entry.kanji', namespace: 'entry.kanji', invoke: withSearchUrl('https://www.google.com/search?q=') },
    { id: 'link.jisho', controlKey: 'link.jisho', text: 'Link (Jisho)', fnName: 'linkJisho', actionField: 'entry.kanji', namespace: 'entry.kanji', invoke: withSearchUrl('https://jisho.org/search/') },
    { id: 'link.wiktionary', controlKey: 'link.wiktionary', text: 'Link (Wiktionary)', fnName: 'linkWiktionary', actionField: 'entry.kanji', namespace: 'entry.kanji', invoke: withSearchUrl('https://en.wiktionary.org/wiki/') },
  ];

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