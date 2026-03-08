// SAFE patterns only (highly productive + mechanically generatable).
// Note: lexical nominalizers like ～さ / ～み are intentionally excluded here;
// they’re better handled lexically (whitelist/dictionary/naturalness scoring).
const I_ADJ_BASE_FORM_ITEMS = [
  // core
  { value: 'plain', label: 'plain', rightText: '~i', jpSuffix: 'い', meaningPrefix: '' },
  { value: 'negative', label: 'negative', rightText: '~kunai', jpSuffix: 'くない', meaningPrefix: 'not' },
  { value: 'past', label: 'past', rightText: '~katta', jpSuffix: 'かった', meaningPrefix: 'was' },
  { value: 'pastNegative', label: 'past neg', rightText: '~kunakatta', jpSuffix: 'くなかった', meaningPrefix: 'was not' },
  { value: 'te', label: 'te-form', rightText: '~kute', jpSuffix: 'くて', meaningPrefix: 'and/because' },
  { value: 'adverb', label: 'adverb', rightText: '~ku', jpSuffix: 'く', meaningPrefix: '(adverb)' },

  // conditionals (productive; attach to already-formed stems)
  { value: 'conditionalBa', label: 'if ~', rightText: '~kereba', jpSuffix: 'ければ', meaningPrefix: 'if' },
  { value: 'conditionalTara', label: 'if was ~', rightText: '~kattara', jpSuffix: 'かったら', meaningPrefix: 'if it was' },
  { value: 'conditionalNegativeBa', label: 'if not ~', rightText: '~kunakereba', jpSuffix: 'くなければ', meaningPrefix: 'if not' },
  { value: 'conditionalNegativeTara', label: 'if not (past)', rightText: '~kunakattara', jpSuffix: 'くなかったら', meaningPrefix: 'if it was not' },

  // highly productive derivations / constructions
  { value: 'become', label: 'become ~', rightText: '~kunaru', jpSuffix: 'くなる', meaningPrefix: 'become', outputType: 'godan-verb' },
  { value: 'make', label: 'make ~', rightText: '~kusuru', jpSuffix: 'くする', meaningPrefix: 'make (it)', outputType: 'irregular-verb' },
  { value: 'sugiru', label: 'too ~', rightText: '~sugiru', jpSuffix: 'すぎる', meaningPrefix: 'too', outputType: 'ichidan-verb' },
  { value: 'sou', label: 'looks ~', rightText: '~sou', jpSuffix: 'そう', meaningPrefix: 'looks', outputType: 'na-adjective' },
];

const NA_ADJ_BASE_FORM_ITEMS = [
  // core
  { value: 'plain', label: 'plain', rightText: '~da', jpSuffix: 'だ', meaningPrefix: '' },
  { value: 'negative', label: 'negative', rightText: '~janai', jpSuffix: 'じゃない', meaningPrefix: 'not' },
  { value: 'past', label: 'past', rightText: '~datta', jpSuffix: 'だった', meaningPrefix: 'was' },
  { value: 'pastNegative', label: 'past neg', rightText: '~janakatta', jpSuffix: 'じゃなかった', meaningPrefix: 'was not' },
  { value: 'te', label: 'te-form', rightText: '~de', jpSuffix: 'で', meaningPrefix: 'and/because' },
  { value: 'adverb', label: 'adverb', rightText: '~ni', jpSuffix: 'に', meaningPrefix: '(adverb)' },

  // formal negative variants (productive; copula-based)
  { value: 'negativeFormal', label: 'neg (formal)', rightText: '~dewanai', jpSuffix: 'ではない', meaningPrefix: 'not (formal)' },
  { value: 'pastNegativeFormal', label: 'past neg (formal)', rightText: '~dewanakatta', jpSuffix: 'ではなかった', meaningPrefix: 'was not (formal)' },

  // conditionals (productive; copula-based)
  { value: 'conditionalNara', label: 'if/assuming ~', rightText: '~nara', jpSuffix: 'なら', meaningPrefix: 'if/assuming' },
  { value: 'conditionalTara', label: 'if was ~', rightText: '~dattara', jpSuffix: 'だったら', meaningPrefix: 'if it was' },
  { value: 'conditionalNegativeBa', label: 'if not ~', rightText: '~janakereba', jpSuffix: 'じゃなければ', meaningPrefix: 'if not' },
  { value: 'conditionalNegativeTara', label: 'if not (past)', rightText: '~janakattara', jpSuffix: 'じゃなかったら', meaningPrefix: 'if it was not' },
  { value: 'conditionalNegativeFormalBa', label: 'if not (formal)', rightText: '~dewanakereba', jpSuffix: 'ではなければ', meaningPrefix: 'if not (formal)' },
  { value: 'conditionalNegativeFormalTara', label: 'if not (formal past)', rightText: '~dewanakattara', jpSuffix: 'ではなかったら', meaningPrefix: 'if it was not (formal)' },

  // highly productive derivations / constructions
  { value: 'become', label: 'become ~', rightText: '~ninaru', jpSuffix: 'になる', meaningPrefix: 'become', outputType: 'godan-verb' },
  { value: 'make', label: 'make/choose ~', rightText: '~nisuru', jpSuffix: 'にする', meaningPrefix: 'make (it)', outputType: 'irregular-verb' },
  { value: 'sugiru', label: 'too ~', rightText: '~sugiru', jpSuffix: 'すぎる', meaningPrefix: 'too', outputType: 'ichidan-verb' },
  { value: 'sou', label: 'looks ~', rightText: '~sou', jpSuffix: 'そう', meaningPrefix: 'looks', outputType: 'na-adjective' },
];

const ICHIDAN_VERB_BASE_FORM_ITEMS = [
  { value: 'plain', label: 'plain', rightText: '~ru', jpSuffix: 'る', meaningPrefix: '' },
  { value: 'negative', label: 'negative', rightText: '~nai', jpSuffix: 'ない', meaningPrefix: 'not' },
  { value: 'past', label: 'past', rightText: '~ta', jpSuffix: 'た', meaningPrefix: '(did)' },
  { value: 'pastNegative', label: 'past neg', rightText: '~nakatta', jpSuffix: 'なかった', meaningPrefix: 'did not' },
  { value: 'te', label: 'te-form', rightText: '~te', jpSuffix: 'て', meaningPrefix: 'and/please' },
  { value: 'conditionalBa', label: 'if ~', rightText: '~reba', jpSuffix: 'れば', meaningPrefix: 'if' },
  { value: 'conditionalTara', label: 'if/did ~', rightText: '~tara', jpSuffix: 'たら', meaningPrefix: 'if/when' },
  { value: 'volitional', label: "let's ~", rightText: '~you', jpSuffix: 'よう', meaningPrefix: "let's" },
  { value: 'potential', label: 'can ~', rightText: '~rareru', jpSuffix: 'られる', meaningPrefix: 'can', outputType: 'ichidan-verb' },
  { value: 'passive', label: 'passive', rightText: '~rareru', jpSuffix: 'られる', meaningPrefix: 'be ~ed', outputType: 'ichidan-verb' },
  { value: 'causative', label: 'make/let ~', rightText: '~saseru', jpSuffix: 'させる', meaningPrefix: 'make/let', outputType: 'ichidan-verb' },
  { value: 'imperative', label: 'command', rightText: '~ro', jpSuffix: 'ろ', meaningPrefix: '(command)' },
];

const GODAN_VERB_BASE_FORM_ITEMS = [
  { value: 'plain', label: 'plain', rightText: '~u', meaningPrefix: '' },
  {
    value: 'negative',
    label: 'negative',
    rightText: '~anai',
    meaningPrefix: 'not',
    endingReplaceMap: {
      'う': 'わない',
      'く': 'かない',
      'ぐ': 'がない',
      'す': 'さない',
      'つ': 'たない',
      'ぬ': 'なない',
      'ぶ': 'ばない',
      'む': 'まない',
      'る': 'らない',
    },
  },
  {
    value: 'pastNegative',
    label: 'past neg',
    rightText: '~anakatta',
    meaningPrefix: 'did not',
    endingReplaceMap: {
      'う': 'わなかった',
      'く': 'かなかった',
      'ぐ': 'がなかった',
      'す': 'さなかった',
      'つ': 'たなかった',
      'ぬ': 'ななかった',
      'ぶ': 'ばなかった',
      'む': 'まなかった',
      'る': 'らなかった',
    },
  },
  {
    value: 'te',
    label: 'te-form',
    rightText: '~te/~de',
    meaningPrefix: 'and/please',
    endingReplaceMap: {
      'う/つ/る': 'って',
      'む/ぶ/ぬ': 'んで',
      'く': 'いて',
      'ぐ': 'いで',
      'す': 'して',
    },
  },
  {
    value: 'past',
    label: 'past',
    rightText: '~ta/~da',
    meaningPrefix: '(did)',
    endingReplaceMap: {
      'う/つ/る': 'った',
      'む/ぶ/ぬ': 'んだ',
      'く': 'いた',
      'ぐ': 'いだ',
      'す': 'した',
    },
  },
  {
    value: 'conditionalBa',
    label: 'if ~',
    rightText: '~eba',
    meaningPrefix: 'if',
    endingReplaceMap: {
      'う': 'えば',
      'く': 'けば',
      'ぐ': 'げば',
      'す': 'せば',
      'つ': 'てば',
      'ぬ': 'ねば',
      'ぶ': 'べば',
      'む': 'めば',
      'る': 'れば',
    },
  },
  {
    value: 'conditionalTara',
    label: 'if/did ~',
    rightText: '~tara',
    meaningPrefix: 'if/when',
    endingReplaceMap: {
      'う/つ/る': 'ったら',
      'む/ぶ/ぬ': 'んだら',
      'く': 'いたら',
      'ぐ': 'いだら',
      'す': 'したら',
    },
  },
  {
    value: 'volitional',
    label: "let's ~",
    rightText: '~ou',
    meaningPrefix: "let's",
    endingReplaceMap: {
      'う': 'おう',
      'く': 'こう',
      'ぐ': 'ごう',
      'す': 'そう',
      'つ': 'とう',
      'ぬ': 'のう',
      'ぶ': 'ぼう',
      'む': 'もう',
      'る': 'ろう',
    },
  },
  {
    value: 'potential',
    label: 'can ~',
    rightText: '~eru',
    meaningPrefix: 'can',
    outputType: 'ichidan-verb',
    endingReplaceMap: {
      'う': 'える',
      'く': 'ける',
      'ぐ': 'げる',
      'す': 'せる',
      'つ': 'てる',
      'ぬ': 'ねる',
      'ぶ': 'べる',
      'む': 'める',
      'る': 'れる',
    },
  },
  {
    value: 'passive',
    label: 'passive',
    rightText: '~areru',
    meaningPrefix: 'be ~ed',
    outputType: 'ichidan-verb',
    endingReplaceMap: {
      'う': 'われる',
      'く': 'かれる',
      'ぐ': 'がれる',
      'す': 'される',
      'つ': 'たれる',
      'ぬ': 'なれる',
      'ぶ': 'ばれる',
      'む': 'まれる',
      'る': 'られる',
    },
  },
  {
    value: 'causative',
    label: 'make/let ~',
    rightText: '~aseru',
    meaningPrefix: 'make/let',
    outputType: 'ichidan-verb',
    endingReplaceMap: {
      'う': 'わせる',
      'く': 'かせる',
      'ぐ': 'がせる',
      'す': 'させる',
      'つ': 'たせる',
      'ぬ': 'なせる',
      'ぶ': 'ばせる',
      'む': 'ませる',
      'る': 'らせる',
    },
  },
  {
    value: 'imperative',
    label: 'command',
    rightText: '~e',
    meaningPrefix: '(command)',
    endingReplaceMap: {
      'う': 'え',
      'く': 'け',
      'ぐ': 'げ',
      'す': 'せ',
      'つ': 'て',
      'ぬ': 'ね',
      'ぶ': 'べ',
      'む': 'め',
      'る': 'れ',
    },
  },
];

const IRREGULAR_VERB_BASE_FORM_ITEMS = [
  { value: 'plain', label: 'plain', rightText: 'する/くる', meaningPrefix: '' },
  { value: 'negative', label: 'negative', rightText: 'しない/こない', meaningPrefix: 'not' },
  { value: 'past', label: 'past', rightText: 'した/きた', meaningPrefix: '(did)' },
  { value: 'pastNegative', label: 'past neg', rightText: 'しなかった/こなかった', meaningPrefix: 'did not' },
  { value: 'te', label: 'te-form', rightText: 'して/きて', meaningPrefix: 'and/please' },
  { value: 'conditionalBa', label: 'if ~', rightText: 'すれば/くれば', meaningPrefix: 'if' },
  { value: 'conditionalTara', label: 'if/did ~', rightText: 'したら/きたら', meaningPrefix: 'if/when' },
  { value: 'volitional', label: "let's ~", rightText: 'しよう/こよう', meaningPrefix: "let's" },
  { value: 'potential', label: 'can ~', rightText: 'できる/こられる', meaningPrefix: 'can', outputType: 'ichidan-verb' },
  { value: 'passive', label: 'passive', rightText: 'される/こられる', meaningPrefix: 'be ~ed', outputType: 'ichidan-verb' },
  { value: 'causative', label: 'make/let ~', rightText: 'させる/こさせる', meaningPrefix: 'make/let', outputType: 'ichidan-verb' },
  { value: 'imperative', label: 'command', rightText: 'しろ/こい', meaningPrefix: '(command)' },
];

const I_ADJ_FORM_ITEM_MAP = new Map(I_ADJ_BASE_FORM_ITEMS.map(item => [item.value, item]));
const NA_ADJ_FORM_ITEM_MAP = new Map(NA_ADJ_BASE_FORM_ITEMS.map(item => [item.value, item]));
const ICHIDAN_VERB_FORM_ITEM_MAP = new Map(ICHIDAN_VERB_BASE_FORM_ITEMS.map(item => [item.value, item]));
const GODAN_VERB_FORM_ITEM_MAP = new Map(GODAN_VERB_BASE_FORM_ITEMS.map(item => [item.value, item]));
const IRREGULAR_VERB_FORM_ITEM_MAP = new Map(IRREGULAR_VERB_BASE_FORM_ITEMS.map(item => [item.value, item]));

const SURU_SUFFIX_BY_FORM = {
  plain: 'する',
  negative: 'しない',
  past: 'した',
  pastNegative: 'しなかった',
  te: 'して',
  conditionalBa: 'すれば',
  conditionalTara: 'したら',
  volitional: 'しよう',
  potential: 'できる',
  passive: 'される',
  causative: 'させる',
  imperative: 'しろ',
};

const KURU_KANA_SUFFIX_BY_FORM = {
  plain: 'くる',
  negative: 'こない',
  past: 'きた',
  pastNegative: 'こなかった',
  te: 'きて',
  conditionalBa: 'くれば',
  conditionalTara: 'きたら',
  volitional: 'こよう',
  potential: 'こられる',
  passive: 'こられる',
  causative: 'こさせる',
  imperative: 'こい',
};

const KURU_KANJI_SUFFIX_BY_FORM = {
  plain: '来る',
  negative: '来ない',
  past: '来た',
  pastNegative: '来なかった',
  te: '来て',
  conditionalBa: '来れば',
  conditionalTara: '来たら',
  volitional: '来よう',
  potential: '来られる',
  passive: '来られる',
  causative: '来させる',
  imperative: '来い',
};

const ARU_EXACT_FORM = {
  plain: 'ある',
  negative: 'ない',
  past: 'あった',
  pastNegative: 'なかった',
  te: 'あって',
  conditionalBa: 'あれば',
  conditionalTara: 'あったら',
  volitional: 'あろう',
  imperative: 'あれ',
};

const IKU_EXACT_FORM = {
  plain: 'いく',
  negative: 'いかない',
  past: 'いった',
  pastNegative: 'いかなかった',
  te: 'いって',
  conditionalBa: 'いけば',
  conditionalTara: 'いったら',
  volitional: 'いこう',
  potential: 'いける',
  passive: 'いかれる',
  causative: 'いかせる',
  imperative: 'いけ',
};

const IKU_KANJI_EXACT_FORM = {
  plain: '行く',
  negative: '行かない',
  past: '行った',
  pastNegative: '行かなかった',
  te: '行って',
  conditionalBa: '行けば',
  conditionalTara: '行ったら',
  volitional: '行こう',
  potential: '行ける',
  passive: '行かれる',
  causative: '行かせる',
  imperative: '行け',
};

function normalizeType(v) {
  return String(v || '').trim().toLowerCase();
}

function normalizeExpansionForms(v) {
  if (Array.isArray(v)) return v.map(s => String(s || '').trim()).filter(Boolean);
  const s = String(v || '').trim();
  if (!s) return [];
  return s.split(/[,|\s]+/g).map(x => String(x || '').trim()).filter(Boolean);
}

function uniqueInOrder(values) {
  const out = [];
  const seen = new Set();
  for (const v of (Array.isArray(values) ? values : [])) {
    const s = String(v || '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function getEntryRawStudyKey(entry) {
  if (!entry || typeof entry !== 'object') return '';
  for (const k of ['kanji', 'character', 'text', 'word', 'reading', 'kana']) {
    const v = entry[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function isIAdjectiveType(type) {
  return type === 'i-adjective' || type === 'i_adj' || type === 'i-adj';
}

function isNaAdjectiveType(type) {
  return type === 'na-adjective' || type === 'na_adj' || type === 'na-adj';
}

function isIchidanVerbType(type) {
  return type === 'ichidan-verb' || type === 'ichidan_verb' || type === 'ichidan';
}

function isGodanVerbType(type) {
  return type === 'godan-verb' || type === 'godan_verb' || type === 'godan';
}

function isIrregularVerbType(type) {
  return type === 'irregular-verb' || type === 'irregular_verb' || type === 'irregular';
}

function parseEndingKeySpec(key) {
  return String(key || '').split('/').map(s => s.trim()).filter(Boolean);
}

function applyEndingReplaceMap(str, endingReplaceMap) {
  const s = String(str || '');
  if (!s || !endingReplaceMap || typeof endingReplaceMap !== 'object') return s;

  const expanded = [];
  for (const [spec, replacement] of Object.entries(endingReplaceMap)) {
    const parts = parseEndingKeySpec(spec);
    for (const p of parts) expanded.push([p, String(replacement || '')]);
  }

  expanded.sort((a, b) => b[0].length - a[0].length);

  for (const [ending, replacement] of expanded) {
    if (!ending) continue;
    if (s.endsWith(ending)) return `${s.slice(0, -ending.length)}${replacement}`;
  }

  return s;
}

function inflectSpecialIrregularVerb(str, form) {
  const s = String(str || '').trim();
  if (!s || !form) return '';

  if (s === 'ある' || s === '有る') return ARU_EXACT_FORM[form] || '';
  if (s === 'いく') return IKU_EXACT_FORM[form] || '';
  if (s === '行く') return IKU_KANJI_EXACT_FORM[form] || '';

  if (s.endsWith('する')) {
    const suffix = SURU_SUFFIX_BY_FORM[form];
    if (!suffix) return '';
    return `${s.slice(0, -2)}${suffix}`;
  }

  if (s.endsWith('くる')) {
    const suffix = KURU_KANA_SUFFIX_BY_FORM[form];
    if (!suffix) return '';
    return `${s.slice(0, -2)}${suffix}`;
  }

  if (s.endsWith('来る')) {
    const suffix = KURU_KANJI_SUFFIX_BY_FORM[form];
    if (!suffix) return '';
    return `${s.slice(0, -2)}${suffix}`;
  }

  return '';
}

function inflectIAdjective(s, form) {
  const str = String(s || '').trim();
  if (!str) return str;
  if (!str.endsWith('い')) return str;
  const formDef = I_ADJ_FORM_ITEM_MAP.get(form);
  const suffix = String(formDef?.jpSuffix || '');
  if (!suffix) return str;
  const stem = str.slice(0, -1);
  return `${stem}${suffix}`;
}

function inflectNaAdjective(s, form) {
  const str = String(s || '').trim();
  if (!str) return str;
  const formDef = NA_ADJ_FORM_ITEM_MAP.get(form);
  const suffix = String(formDef?.jpSuffix || '');
  if (!suffix) return str;
  return `${str}${suffix}`;
}

function inflectIchidanVerb(s, form) {
  const str = String(s || '').trim();
  if (!str) return str;

  const irregular = inflectSpecialIrregularVerb(str, form);
  if (irregular) return irregular;

  const formDef = ICHIDAN_VERB_FORM_ITEM_MAP.get(form);
  if (!formDef) return str;

  const suffix = String(formDef.jpSuffix || '');
  if (!suffix) return str;
  if (!str.endsWith('る')) return str;
  return `${str.slice(0, -1)}${suffix}`;
}

function inflectGodanVerb(s, form) {
  const str = String(s || '').trim();
  if (!str) return str;

  const irregular = inflectSpecialIrregularVerb(str, form);
  if (irregular) return irregular;

  const formDef = GODAN_VERB_FORM_ITEM_MAP.get(form);
  if (!formDef) return str;

  if (formDef.endingReplaceMap) return applyEndingReplaceMap(str, formDef.endingReplaceMap);
  return str;
}

function inflectIrregularVerb(s, form) {
  const str = String(s || '').trim();
  if (!str) return str;

  const irregular = inflectSpecialIrregularVerb(str, form);
  if (irregular) return irregular;
  return str;
}

function getFormDef(kind, form) {
  if (kind === 'i') return I_ADJ_FORM_ITEM_MAP.get(form);
  if (kind === 'na') return NA_ADJ_FORM_ITEM_MAP.get(form);
  if (kind === 'ichidan') return ICHIDAN_VERB_FORM_ITEM_MAP.get(form);
  if (kind === 'godan') return GODAN_VERB_FORM_ITEM_MAP.get(form);
  if (kind === 'irregular') return IRREGULAR_VERB_FORM_ITEM_MAP.get(form);
  return undefined;
}

function expandJapaneseEntry(entry, { kind = '', form = '', baseStudyKey = '' } = {}) {
  if (!entry || typeof entry !== 'object') return entry;
  if (!form) return entry;

  const next = { ...entry };
  if (baseStudyKey) next.__baseStudyKey = baseStudyKey;

  const formDef = getFormDef(kind, form);
  const meaningPrefix = formDef?.meaningPrefix || '';
  const outputType = formDef?.outputType;

  const surfaceKeys = ['kanji', 'character', 'text', 'word'];
  const readingKeys = ['reading', 'kana'];

  const inflect = (s) => {
    if (kind === 'i') return inflectIAdjective(s, form);
    if (kind === 'na') return inflectNaAdjective(s, form);
    if (kind === 'ichidan') return inflectIchidanVerb(s, form);
    if (kind === 'godan') return inflectGodanVerb(s, form);
    if (kind === 'irregular') return inflectIrregularVerb(s, form);
    return String(s || '');
  };

  for (const k of surfaceKeys) {
    if (typeof next[k] === 'string' && next[k].trim()) next[k] = inflect(next[k]);
  }
  for (const k of readingKeys) {
    if (typeof next[k] === 'string' && next[k].trim()) next[k] = inflect(next[k]);
  }

  if (outputType) next.type = outputType;
  if (meaningPrefix && typeof next.meaning === 'string') next.meaning = `${meaningPrefix}~ ${next.meaning}`;

  return next;
}

export function collectionUsesJapaneseExpansion(collection) {
  const key = String(collection?.key || '').trim().toLowerCase();
  const category = String(collection?.metadata?.category || '').trim().toLowerCase();
  if (key.startsWith('japanese/')) return true;
  if (category === 'japanese') return true;
  if (category.startsWith('japanese.')) return true;
  if (category.includes('.japanese.')) return true;
  return false;
}

export function getJapaneseExpansionControlConfig(collection, opts = {}) {
  const includeActions = opts?.includeActions !== false;
  const entries = Array.isArray(collection?.entries) ? collection.entries : [];
  let hasI = false;
  let hasNa = false;
  let hasIchidan = false;
  let hasGodan = false;
  let hasIrregular = false;

  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    const t = normalizeType(e.type);
    if (isIAdjectiveType(t)) hasI = true;
    else if (isNaAdjectiveType(t)) hasNa = true;
    else if (isIchidanVerbType(t)) hasIchidan = true;
    else if (isGodanVerbType(t)) hasGodan = true;
    else if (isIrregularVerbType(t)) hasIrregular = true;
    if (hasI && hasNa && hasIchidan && hasGodan && hasIrregular) break;
  }

  return {
    type: 'japanese.morphology',
    supports: { i: hasI, na: hasNa, ichidan: hasIchidan, godan: hasGodan, irregular: hasIrregular },
    iBaseItems: I_ADJ_BASE_FORM_ITEMS.map(x => ({ ...x })),
    naBaseItems: NA_ADJ_BASE_FORM_ITEMS.map(x => ({ ...x })),
    ichidanVerbBaseItems: ICHIDAN_VERB_BASE_FORM_ITEMS.map(x => ({ ...x })),
    godanVerbBaseItems: GODAN_VERB_BASE_FORM_ITEMS.map(x => ({ ...x })),
    irregularVerbBaseItems: IRREGULAR_VERB_BASE_FORM_ITEMS.map(x => ({ ...x })),
    // Do not inject UI action rows here; callers should opt-in via dropdown options.
    iItems: I_ADJ_BASE_FORM_ITEMS.map(x => ({ ...x })),
    naItems: NA_ADJ_BASE_FORM_ITEMS.map(x => ({ ...x })),
    ichidanVerbItems: ICHIDAN_VERB_BASE_FORM_ITEMS.map(x => ({ ...x })),
    godanVerbItems: GODAN_VERB_BASE_FORM_ITEMS.map(x => ({ ...x })),
    irregularVerbItems: IRREGULAR_VERB_BASE_FORM_ITEMS.map(x => ({ ...x })),
  };
}

export function expandJapaneseEntriesAndIndices(
  entries,
  indices,
  { iForms = [], naForms = [], ichidanForms = [], godanForms = [], irregularForms = [] } = {},
) {
  const arr = Array.isArray(entries) ? entries : [];
  const idx = Array.isArray(indices) ? indices : arr.map((_, i) => i);
  if (!arr.length) return { entries: [], indices: [] };

  const iSel = uniqueInOrder(normalizeExpansionForms(iForms));
  const naSel = uniqueInOrder(normalizeExpansionForms(naForms));
  const ichidanSel = uniqueInOrder(normalizeExpansionForms(ichidanForms));
  const godanSel = uniqueInOrder(normalizeExpansionForms(godanForms));
  const irregularSel = uniqueInOrder(normalizeExpansionForms(irregularForms));

  if (!iSel.length && !naSel.length && !ichidanSel.length && !godanSel.length && !irregularSel.length) {
    return { entries: arr.slice(), indices: idx.slice() };
  }

  const outEntries = [];
  const outIndices = [];

  for (let i = 0; i < arr.length; i++) {
    const entry = arr[i];
    const originalIndex = idx[i];
    if (!entry || typeof entry !== 'object') {
      outEntries.push(entry);
      outIndices.push(originalIndex);
      continue;
    }

    const type = normalizeType(String(entry.type || '').trim());
    const isI = isIAdjectiveType(type);
    const isNa = isNaAdjectiveType(type);
    const isIchidan = isIchidanVerbType(type);
    const isGodan = isGodanVerbType(type);
    const isIrregular = isIrregularVerbType(type);

    const forms = isI
      ? iSel
      : isNa
        ? naSel
        : isIchidan
          ? ichidanSel
          : isGodan
            ? godanSel
            : isIrregular
              ? irregularSel
              : [];

    if (!forms.length) {
      outEntries.push(entry);
      outIndices.push(originalIndex);
      continue;
    }

    const baseStudyKey = getEntryRawStudyKey(entry);
    const kind = isI
      ? 'i'
      : isNa
        ? 'na'
        : isIchidan
          ? 'ichidan'
          : isGodan
            ? 'godan'
            : 'irregular';

    for (const form of forms) {
      outEntries.push(expandJapaneseEntry(entry, { kind, form, baseStudyKey }));
      outIndices.push(originalIndex);
    }
  }

  return { entries: outEntries, indices: outIndices };
}

export function getJapaneseExpansionDeltas(
  entries,
  { iForms = [], naForms = [], ichidanForms = [], godanForms = [], irregularForms = [] } = {},
) {
  const arr = Array.isArray(entries) ? entries : [];
  const iSel = uniqueInOrder(normalizeExpansionForms(iForms));
  const naSel = uniqueInOrder(normalizeExpansionForms(naForms));
  const ichidanSel = uniqueInOrder(normalizeExpansionForms(ichidanForms));
  const godanSel = uniqueInOrder(normalizeExpansionForms(godanForms));
  const irregularSel = uniqueInOrder(normalizeExpansionForms(irregularForms));

  let iBaseCount = 0;
  let naBaseCount = 0;
  let ichidanBaseCount = 0;
  let godanBaseCount = 0;
  let irregularBaseCount = 0;

  for (const entry of arr) {
    if (!entry || typeof entry !== 'object') continue;
    const type = normalizeType(String(entry.type || '').trim());
    if (isIAdjectiveType(type)) iBaseCount++;
    else if (isNaAdjectiveType(type)) naBaseCount++;
    else if (isIchidanVerbType(type)) ichidanBaseCount++;
    else if (isGodanVerbType(type)) godanBaseCount++;
    else if (isIrregularVerbType(type)) irregularBaseCount++;
  }

  const iFormsCount = iSel.length;
  const naFormsCount = naSel.length;
  const ichidanFormsCount = ichidanSel.length;
  const godanFormsCount = godanSel.length;
  const irregularFormsCount = irregularSel.length;

  const iDelta = (iFormsCount > 0) ? (iBaseCount * Math.max(0, iFormsCount - 1)) : 0;
  const naDelta = (naFormsCount > 0) ? (naBaseCount * Math.max(0, naFormsCount - 1)) : 0;
  const ichidanDelta = (ichidanFormsCount > 0) ? (ichidanBaseCount * Math.max(0, ichidanFormsCount - 1)) : 0;
  const godanDelta = (godanFormsCount > 0) ? (godanBaseCount * Math.max(0, godanFormsCount - 1)) : 0;
  const irregularDelta = (irregularFormsCount > 0) ? (irregularBaseCount * Math.max(0, irregularFormsCount - 1)) : 0;

  return {
    iDelta,
    naDelta,
    ichidanDelta,
    godanDelta,
    irregularDelta,
    totalDelta: iDelta + naDelta + ichidanDelta + godanDelta + irregularDelta,
    iBaseCount,
    naBaseCount,
    ichidanBaseCount,
    godanBaseCount,
    irregularBaseCount,
    iFormsCount,
    naFormsCount,
    ichidanFormsCount,
    godanFormsCount,
    irregularFormsCount,
  };
}

