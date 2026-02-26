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


const I_ADJ_FORM_SUFFIX = new Map(I_ADJ_BASE_FORM_ITEMS.map(item => [item.value, String(item.jpSuffix || '')]));
const NA_ADJ_FORM_SUFFIX = new Map(NA_ADJ_BASE_FORM_ITEMS.map(item => [item.value, String(item.jpSuffix || '')]));

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

function inflectIAdjective(s, form) {
  const str = String(s || '').trim();
  if (!str) return str;
  if (!str.endsWith('い')) return str;
  const suffix = I_ADJ_FORM_SUFFIX.get(form);
  if (!suffix) return str;
  const stem = str.slice(0, -1);
  return `${stem}${suffix}`;
}

function inflectNaAdjective(s, form) {
  const str = String(s || '').trim();
  if (!str) return str;
  const suffix = NA_ADJ_FORM_SUFFIX.get(form);
  if (!suffix) return str;
  return `${str}${suffix}`;
}

function expandJapaneseAdjectiveEntry(entry, { kind = '', form = '', baseStudyKey = '' } = {}) {
  if (!entry || typeof entry !== 'object') return entry;
  if (!form) return entry;

  const isI = kind === 'i';
  const isNa = kind === 'na';
  const typeRaw = String(entry.type || '').trim();

  const next = { ...entry };
  if (baseStudyKey) next.__baseStudyKey = baseStudyKey;

  // Patch meaningPrefix and outputType for i-adjective and na-adjective forms
  let meaningPrefix = '';
  let outputType = undefined;
  if (isI) {
    const formDef = I_ADJ_BASE_FORM_ITEMS.find(x => x.value === form);
    if (formDef) {
      meaningPrefix = formDef.meaningPrefix || '';
      outputType = formDef.outputType;
    }
  } else if (isNa) {
    const formDef = NA_ADJ_BASE_FORM_ITEMS.find(x => x.value === form);
    if (formDef) {
      meaningPrefix = formDef.meaningPrefix || '';
      outputType = formDef.outputType;
    }
  }

  const surfaceKeys = ['kanji', 'character', 'text', 'word'];
  const readingKeys = ['reading', 'kana'];

  const inflect = (s) => {
    if (isI) return inflectIAdjective(s, form);
    if (isNa) return inflectNaAdjective(s, form);
    return String(s || '');
  };

  for (const k of surfaceKeys) {
    if (typeof next[k] === 'string' && next[k].trim()) next[k] = inflect(next[k]);
  }
  for (const k of readingKeys) {
    if (typeof next[k] === 'string' && next[k].trim()) next[k] = inflect(next[k]);
  }

  // Only patch type if outputType is set (otherwise leave as-is)
  if (outputType) next.type = outputType;
  // Patch meaning if present
  if (meaningPrefix && typeof next.meaning === 'string') next.meaning = meaningPrefix + '~ '+ next.meaning;

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

  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    const t = normalizeType(e.type);
    if (t === 'i-adjective' || t === 'i_adj' || t === 'i-adj') hasI = true;
    else if (t === 'na-adjective' || t === 'na_adj' || t === 'na-adj') hasNa = true;
    if (hasI && hasNa) break;
  }

  return {
    type: 'japanese.adjective',
    supports: { i: hasI, na: hasNa },
    iBaseItems: I_ADJ_BASE_FORM_ITEMS.map(x => ({ ...x })),
    naBaseItems: NA_ADJ_BASE_FORM_ITEMS.map(x => ({ ...x })),
    // Do not inject UI action rows here; callers should opt-in via dropdown options.
    iItems: I_ADJ_BASE_FORM_ITEMS.map(x => ({ ...x })),
    naItems: NA_ADJ_BASE_FORM_ITEMS.map(x => ({ ...x })),
  };
}

export function expandJapaneseEntriesAndIndices(entries, indices, { iForms = [], naForms = [] } = {}) {
  const arr = Array.isArray(entries) ? entries : [];
  const idx = Array.isArray(indices) ? indices : arr.map((_, i) => i);
  if (!arr.length) return { entries: [], indices: [] };

  const iSel = uniqueInOrder(normalizeExpansionForms(iForms));
  const naSel = uniqueInOrder(normalizeExpansionForms(naForms));

  if (!iSel.length && !naSel.length) return { entries: arr.slice(), indices: idx.slice() };

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

    const typeRaw = String(entry.type || '').trim();
    const type = normalizeType(typeRaw);
    const isI = type === 'i-adjective' || type === 'i_adj' || type === 'i-adj';
    const isNa = type === 'na-adjective' || type === 'na_adj' || type === 'na-adj';

    const forms = isI ? iSel : (isNa ? naSel : []);

    if (!forms.length) {
      outEntries.push(entry);
      outIndices.push(originalIndex);
      continue;
    }

    const baseStudyKey = getEntryRawStudyKey(entry);
    const kind = isI ? 'i' : 'na';

    for (const form of forms) {
      outEntries.push(expandJapaneseAdjectiveEntry(entry, { kind, form, baseStudyKey }));
      outIndices.push(originalIndex);
    }
  }

  return { entries: outEntries, indices: outIndices };
}

export function getJapaneseExpansionDeltas(entries, { iForms = [], naForms = [] } = {}) {
  const arr = Array.isArray(entries) ? entries : [];
  const iSel = uniqueInOrder(normalizeExpansionForms(iForms));
  const naSel = uniqueInOrder(normalizeExpansionForms(naForms));

  let iBaseCount = 0;
  let naBaseCount = 0;
  for (const entry of arr) {
    if (!entry || typeof entry !== 'object') continue;
    const type = normalizeType(String(entry.type || '').trim());
    const isI = type === 'i-adjective' || type === 'i_adj' || type === 'i-adj';
    const isNa = type === 'na-adjective' || type === 'na_adj' || type === 'na-adj';
    if (isI) iBaseCount++;
    else if (isNa) naBaseCount++;
  }

  const iFormsCount = iSel.length;
  const naFormsCount = naSel.length;
  const iDelta = (iFormsCount > 0) ? (iBaseCount * Math.max(0, iFormsCount - 1)) : 0;
  const naDelta = (naFormsCount > 0) ? (naBaseCount * Math.max(0, naFormsCount - 1)) : 0;

  return {
    iDelta,
    naDelta,
    totalDelta: iDelta + naDelta,
    iBaseCount,
    naBaseCount,
    iFormsCount,
    naFormsCount,
  };
}
