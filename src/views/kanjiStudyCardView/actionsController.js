function asString(v) {
  return (v == null) ? '' : String(v);
}

function deepClone(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch (e) { return value; }
}

function customTokenFromId(id) {
  return `__custom:${asString(id).trim()}`;
}

const KANJI_STUDY_ENTRY_FIELDS_FALLBACK = ['kanji', 'reading', 'meaning', 'type', 'lexicalClass', 'orthography', 'tags'];

const KANJI_STUDY_DEFAULT_CUSTOM_BUTTONS = [
  {
    id: 'prev',
    icon: '←',
    text: 'Prev',
    caption: '←',
    shortcut: 'ArrowLeft',
    actions: [{ actionId: 'prev' }],
  },
  {
    id: 'link.chatgpt',
    icon: '💬',
    text: 'ChatGPT',
    caption: '',
    shortcut: '',
    actions: [{ actionId: 'link.chatgpt' }],
  },
  {
    id: 'next',
    icon: '→',
    text: 'Next',
    caption: '→',
    shortcut: 'ArrowRight',
    actions: [{ actionId: 'next' }],
  },
  {
    id: 'practice',
    icon: '🎯',
    text: 'Practice',
    caption: 'X',
    shortcut: 'x',
    actions: [{ actionId: 'practice' }],
  },
  {
    id: 'link.google.images',
    icon: '🖼',
    text: 'Images',
    caption: '',
    shortcut: '',
    actions: [{ actionId: 'link.google.images' }],
  },
  {
    id: 'learned',
    icon: '✅',
    text: 'Learned',
    caption: 'V',
    shortcut: 'v',
    actions: [{ actionId: 'learned' }],
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
  shuffle,
  speakField,
  getSearchTerm,
  getEntryFields,
  getAvailableEntryFields,
  setEntryFields,
  openInNewTab,
  kanjiProgress,
  getCurrentCollectionKey,
  getCurrentEntryKey,
  onProgressChanged,
} = {}) {
  const run = {
    showPrev: (typeof showPrev === 'function') ? showPrev : () => {},
    showNext: (typeof showNext === 'function') ? showNext : () => {},
    shuffle: (typeof shuffle === 'function') ? shuffle : () => {},
    speakField: (typeof speakField === 'function') ? speakField : () => {},
    getSearchTerm: (typeof getSearchTerm === 'function') ? getSearchTerm : () => '',
    getEntryFields: (typeof getEntryFields === 'function') ? getEntryFields : () => 'all',
    getAvailableEntryFields: (typeof getAvailableEntryFields === 'function') ? getAvailableEntryFields : () => KANJI_STUDY_ENTRY_FIELDS_FALLBACK.slice(),
    setEntryFields: (typeof setEntryFields === 'function') ? setEntryFields : () => {},
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

  const delayActionDefinitions = [
    { id: 'action.delay.500', fnName: 'action.delay', actionField: '.5s', invoke: () => {} },
    { id: 'action.delay.1000', fnName: 'action.delay', actionField: '1s', invoke: () => {} },
    { id: 'action.delay.1500', fnName: 'action.delay', actionField: '1.5s', invoke: () => {} },
    { id: 'action.delay.2000', fnName: 'action.delay', actionField: '2s', invoke: () => {} },
    { id: 'action.delay.2500', fnName: 'action.delay', actionField: '2.5s', invoke: () => {} },
  ];

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

  function getAvailableEntryFieldsList() {
    try {
      const raw = run.getAvailableEntryFields();
      if (Array.isArray(raw) && raw.length) {
        const out = [];
        const seen = new Set();
        for (const f of raw) {
          const key = String(f || '').trim();
          if (!key || seen.has(key)) continue;
          seen.add(key);
          out.push(key);
        }
        if (out.length) return out;
      }
    } catch (e) {}
    return KANJI_STUDY_ENTRY_FIELDS_FALLBACK.slice();
  }

  function getSelectedEntryFieldSet() {
    try {
      const available = getAvailableEntryFieldsList();
      const raw = run.getEntryFields();
      if (raw === 'all') return new Set(available);
      if (Array.isArray(raw)) {
        const selected = new Set(raw.map(v => String(v || '').trim()).filter(Boolean));
        return new Set(available.filter(f => selected.has(f)));
      }
    } catch (e) {}
    return new Set();
  }

  function writeEntryFieldSet(selectedSet) {
    const available = getAvailableEntryFieldsList();
    const ordered = available.filter(f => selectedSet.has(f));
    if (ordered.length === available.length) {
      run.setEntryFields('all');
      return;
    }
    run.setEntryFields(ordered);
  }

  function selectedSetToArray(selectedSet) {
    return getAvailableEntryFieldsList().filter(f => selectedSet.has(f));
  }

  function logEntryFieldMutation(kind, fieldKey, beforeSet, afterSet) {
    try {
      const before = selectedSetToArray(beforeSet);
      const after = selectedSetToArray(afterSet);
      console.debug('[kanjiStudy][entryFields]', {
        action: kind,
        field: fieldKey,
        before,
        after,
        beforeCount: before.length,
        afterCount: after.length,
      });
    } catch (e) {}
  }

  function runEntryFieldSetOn(fieldKey) {
    return () => {
      const selected = getSelectedEntryFieldSet();
      const before = new Set(selected);
      selected.add(fieldKey);
      logEntryFieldMutation('setOn', fieldKey, before, selected);
      writeEntryFieldSet(selected);
    };
  }

  function runEntryFieldSetOff(fieldKey) {
    return () => {
      const selected = getSelectedEntryFieldSet();
      const before = new Set(selected);
      selected.delete(fieldKey);
      logEntryFieldMutation('setOff', fieldKey, before, selected);
      writeEntryFieldSet(selected);
    };
  }

  function runEntryFieldToggle(fieldKey) {
    return () => {
      const selected = getSelectedEntryFieldSet();
      const before = new Set(selected);
      if (selected.has(fieldKey)) selected.delete(fieldKey);
      else selected.add(fieldKey);
      logEntryFieldMutation('toggle', fieldKey, before, selected);
      writeEntryFieldSet(selected);
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

  const speakFieldActionDefinitions = [];
  for (const fieldKey of getAvailableEntryFieldsList()) {
    speakFieldActionDefinitions.push({
      id: `sound.${fieldKey}`,
      fnName: 'entry.speakField',
      actionField: `entry.${fieldKey}`,
      invoke: () => run.speakField(fieldKey),
    });
  }

  const entryFieldActionDefinitions = [];
  for (const fieldKey of getAvailableEntryFieldsList()) {
    entryFieldActionDefinitions.push(
      {
        id: `entryField.${fieldKey}.setOn`,
        fnName: `app.kanjiStudyCardView.entryFields.setOn[${fieldKey}]`,
        actionField: `entry.${fieldKey}`,
        invoke: runEntryFieldSetOn(fieldKey),
      },
      {
        id: `entryField.${fieldKey}.setOff`,
        fnName: `app.kanjiStudyCardView.entryFields.setOff[${fieldKey}]`,
        actionField: `entry.${fieldKey}`,
        invoke: runEntryFieldSetOff(fieldKey),
      },
      {
        id: `entryField.${fieldKey}.toggle`,
        fnName: `app.kanjiStudyCardView.entryFields.toggle[${fieldKey}]`,
        actionField: `entry.${fieldKey}`,
        invoke: runEntryFieldToggle(fieldKey),
      },
    );
  }

  const actionDefinitions = [
    { id: 'prev', fnName: 'app.kanjiStudyCardView.showPrev', actionField: '', invoke: () => run.showPrev() },
    { id: 'next', fnName: 'app.kanjiStudyCardView.showNext', actionField: '', invoke: () => run.showNext() },
    { id: 'shuffle', fnName: 'app.kanjiStudyCardView.shuffle', actionField: 'collection.order', invoke: () => run.shuffle() },

    // Use a generic 'Sound' label for all sound actions; the specific
    // actionField indicates which entry field will be spoken.
    ...speakFieldActionDefinitions,

    // Progress-related functions are grouped in the custom-button picker.
    { id: 'learned', fnName: 'manager.studyProgress.toggleState', actionField: 'learned', invoke: runToggleLearned },
    { id: 'practice', fnName: 'manager.studyProgress.toggleState', actionField: 'focus', invoke: runTogglePractice },
    { id: 'setStateLearned', fnName: 'manager.studyProgress.setState', actionField: 'learned', invoke: runSetStateLearned },
    { id: 'setStateNull', fnName: 'manager.studyProgress.setState', actionField: 'null', invoke: runSetStateNull },
    { id: 'setStateFocus', fnName: 'manager.studyProgress.setState', actionField: 'focus', invoke: runSetStateFocus },

    // Generic link actions that reuse a single link-opening helper. Each
    // definition includes a `linkKey` which maps into LINK_TEMPLATES.
    { id: 'link.chatgpt', fnName: 'link.open[chatgpt]', actionField: 'entry.studyKey', invoke: withSearchUrl(LINK_TEMPLATES['chatgpt']) },
    { id: 'link.google.images', fnName: 'link.open[google.images]', actionField: 'entry.studyKey', invoke: withSearchUrl(LINK_TEMPLATES['google.images']) },
    {
      id: 'link.translate',
      fnName: 'link.open',
      actionField: 'entry.studyKey',
      fnName: 'link.open[translate]',
      invoke: () => {
        const term = asString(run.getSearchTerm()).trim();
        if (!term) return;
        // translate requires a different URL form (text param + op=translate)
        run.openInNewTab(`${LINK_TEMPLATES['translate']}${encodeURIComponent(term)}&op=translate`);
      },
    },
    { id: 'link.google', fnName: 'link.open[google]', actionField: 'entry.studyKey', invoke: withSearchUrl(LINK_TEMPLATES['google']) },
    { id: 'link.jisho', fnName: 'link.open[jisho]', actionField: 'entry.studyKey', invoke: withSearchUrl(LINK_TEMPLATES['jisho']) },
    { id: 'link.wiktionary', fnName: 'link.open[wiktionary]', actionField: 'entry.studyKey', invoke: withSearchUrl(LINK_TEMPLATES['wiktionary']) },
    ...delayActionDefinitions,
    ...entryFieldActionDefinitions,
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

