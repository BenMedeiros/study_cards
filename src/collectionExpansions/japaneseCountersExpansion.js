const NUMBER_KANJI = {
  0: '零',
  1: '一',
  2: '二',
  3: '三',
  4: '四',
  5: '五',
  6: '六',
  7: '七',
  8: '八',
  9: '九',
  10: '十',
  11: '十一',
  12: '十二',
  13: '十三',
  14: '十四',
  15: '十五',
  16: '十六',
  17: '十七',
  18: '十八',
  19: '十九',
  20: '二十',
};

const COUNTER_NUMBER_RANGE = Array.from({ length: 21 }, (_, i) => i);

const COUNTER_READING_MAPS = {
  nin: {
    0: 'ぜろにん', 1: 'ひとり', 2: 'ふたり', 3: 'さんにん', 4: 'よにん', 5: 'ごにん',
    6: 'ろくにん', 7: 'ななにん', 8: 'はちにん', 9: 'きゅうにん', 10: 'じゅうにん',
    11: 'じゅういちにん', 12: 'じゅうににん', 13: 'じゅうさんにん', 14: 'じゅうよにん',
    15: 'じゅうごにん', 16: 'じゅうろくにん', 17: 'じゅうななにん', 18: 'じゅうはちにん',
    19: 'じゅうきゅうにん', 20: 'にじゅうにん',
  },
  hon: {
    0: 'ぜろほん', 1: 'いっぽん', 2: 'にほん', 3: 'さんぼん', 4: 'よんほん', 5: 'ごほん',
    6: 'ろっぽん', 7: 'ななほん', 8: 'はっぽん', 9: 'きゅうほん', 10: 'じゅっぽん',
    11: 'じゅういっぽん', 12: 'じゅうにほん', 13: 'じゅうさんぼん', 14: 'じゅうよんほん',
    15: 'じゅうごほん', 16: 'じゅうろっぽん', 17: 'じゅうななほん', 18: 'じゅうはっぽん',
    19: 'じゅうきゅうほん', 20: 'にじゅっぽん',
  },
  mai: {
    0: 'ぜろまい', 1: 'いちまい', 2: 'にまい', 3: 'さんまい', 4: 'よんまい', 5: 'ごまい',
    6: 'ろくまい', 7: 'ななまい', 8: 'はちまい', 9: 'きゅうまい', 10: 'じゅうまい',
    11: 'じゅういちまい', 12: 'じゅうにまい', 13: 'じゅうさんまい', 14: 'じゅうよんまい',
    15: 'じゅうごまい', 16: 'じゅうろくまい', 17: 'じゅうななまい', 18: 'じゅうはちまい',
    19: 'じゅうきゅうまい', 20: 'にじゅうまい',
  },
  ko: {
    0: 'ぜろこ', 1: 'いっこ', 2: 'にこ', 3: 'さんこ', 4: 'よんこ', 5: 'ごこ',
    6: 'ろっこ', 7: 'ななこ', 8: 'はっこ', 9: 'きゅうこ', 10: 'じゅっこ',
    11: 'じゅういっこ', 12: 'じゅうにこ', 13: 'じゅうさんこ', 14: 'じゅうよんこ',
    15: 'じゅうごこ', 16: 'じゅうろっこ', 17: 'じゅうななこ', 18: 'じゅうはっこ',
    19: 'じゅうきゅうこ', 20: 'にじゅっこ',
  },
  kai: {
    0: 'ぜろかい', 1: 'いっかい', 2: 'にかい', 3: 'さんかい', 4: 'よんかい', 5: 'ごかい',
    6: 'ろっかい', 7: 'ななかい', 8: 'はっかい', 9: 'きゅうかい', 10: 'じゅっかい',
    11: 'じゅういっかい', 12: 'じゅうにかい', 13: 'じゅうさんかい', 14: 'じゅうよんかい',
    15: 'じゅうごかい', 16: 'じゅうろっかい', 17: 'じゅうななかい', 18: 'じゅうはっかい',
    19: 'じゅうきゅうかい', 20: 'にじゅっかい',
  },
  fun: {
    0: 'ぜろふん', 1: 'いっぷん', 2: 'にふん', 3: 'さんぷん', 4: 'よんぷん', 5: 'ごふん',
    6: 'ろっぷん', 7: 'ななふん', 8: 'はっぷん', 9: 'きゅうふん', 10: 'じゅっぷん',
    11: 'じゅういっぷん', 12: 'じゅうにふん', 13: 'じゅうさんぷん', 14: 'じゅうよんぷん',
    15: 'じゅうごふん', 16: 'じゅうろっぷん', 17: 'じゅうななふん', 18: 'じゅうはっぷん',
    19: 'じゅうきゅうふん', 20: 'にじゅっぷん',
  },
  hiki: {
    0: 'ぜろひき', 1: 'いっぴき', 2: 'にひき', 3: 'さんびき', 4: 'よんひき', 5: 'ごひき',
    6: 'ろっぴき', 7: 'ななひき', 8: 'はっぴき', 9: 'きゅうひき', 10: 'じゅっぴき',
    11: 'じゅういっぴき', 12: 'じゅうにひき', 13: 'じゅうさんびき', 14: 'じゅうよんひき',
    15: 'じゅうごひき', 16: 'じゅうろっぴき', 17: 'じゅうななひき', 18: 'じゅうはっぴき',
    19: 'じゅうきゅうひき', 20: 'にじゅっぴき',
  },
  sai: {
    0: 'ぜろさい', 1: 'いっさい', 2: 'にさい', 3: 'さんさい', 4: 'よんさい', 5: 'ごさい',
    6: 'ろくさい', 7: 'ななさい', 8: 'はっさい', 9: 'きゅうさい', 10: 'じゅっさい',
    11: 'じゅういっさい', 12: 'じゅうにさい', 13: 'じゅうさんさい', 14: 'じゅうよんさい',
    15: 'じゅうごさい', 16: 'じゅうろくさい', 17: 'じゅうななさい', 18: 'じゅうはっさい',
    19: 'じゅうきゅうさい', 20: 'はたち',
  },
};

const COUNTER_KANJI_EXCEPTIONS = {
  sai: {
    20: '二十歳',
  },
};

export const JAPANESE_COUNTER_DEFINITIONS = [
  {
    value: 'nin',
    label: 'people',
    rightText: '~人',
    counterKanji: '人',
    meaningUnit: 'people',
    readingByNumber: COUNTER_READING_MAPS.nin,
    exceptions: ['1 ひとり', '2 ふたり (native forms)'],
  },
  {
    value: 'hon',
    label: 'long objects',
    rightText: '~本',
    counterKanji: '本',
    meaningUnit: 'long objects',
    readingByNumber: COUNTER_READING_MAPS.hon,
    exceptions: ['1/6/8/10/11/16/18/20 use small-tsu + ぽん', '3/13 use ぼん (rendaku)'],
  },
  {
    value: 'mai',
    label: 'flat objects',
    rightText: '~枚',
    counterKanji: '枚',
    meaningUnit: 'flat objects',
    readingByNumber: COUNTER_READING_MAPS.mai,
    exceptions: [],
  },
  {
    value: 'ko',
    label: 'small objects',
    rightText: '~個',
    counterKanji: '個',
    meaningUnit: 'small objects',
    readingByNumber: COUNTER_READING_MAPS.ko,
    exceptions: ['1/6/8/10/11/16/18/20 use small-tsu + こ'],
  },
  {
    value: 'kai',
    label: 'times/occurrences',
    rightText: '~回',
    counterKanji: '回',
    meaningUnit: 'times',
    readingByNumber: COUNTER_READING_MAPS.kai,
    exceptions: ['1/6/8/10/11/16/18/20 use small-tsu + かい'],
  },
  {
    value: 'fun',
    label: 'minutes',
    rightText: '~分',
    counterKanji: '分',
    meaningUnit: 'minutes',
    readingByNumber: COUNTER_READING_MAPS.fun,
    exceptions: ['1/3/4/6/8/10 (+teens) become ぷん', '2/5/7/9 (+teens) stay ふん'],
  },
  {
    value: 'hiki',
    label: 'small animals',
    rightText: '~匹',
    counterKanji: '匹',
    meaningUnit: 'small animals',
    readingByNumber: COUNTER_READING_MAPS.hiki,
    exceptions: ['1/6/8/10 (+teens) become ぴき', '3/13 become びき (rendaku)'],
  },
  {
    value: 'sai',
    label: 'age',
    rightText: '~歳',
    counterKanji: '歳',
    meaningUnit: 'years old',
    readingByNumber: COUNTER_READING_MAPS.sai,
    exceptions: ['1/8/10 (+teens) small-tsu', '20歳 = はたち (lexical irregular)'],
  },
];

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

function buildCounterEntry(def, n) {
  const num = Number(n);
  const readingMap = def?.readingByNumber || {};
  const reading = String(readingMap[num] || '').trim();
  if (!reading) return null;

  const counter = String(def?.counterKanji || '').trim();
  const kanjiExceptions = COUNTER_KANJI_EXCEPTIONS[String(def?.value || '')] || {};
  const baseKanji = String(kanjiExceptions[num] || `${NUMBER_KANJI[num]}${counter}`).trim();
  if (!baseKanji) return null;

  return {
    kanji: baseKanji,
    reading,
    meaning: `${num} (${def.meaningUnit})`,
    type: 'counter',
    lexicalClass: 'generated-counter',
    counter: counter,
    counterKey: String(def.value || ''),
    number: num,
    tags: ['counter_generated', `counter_${String(def.value || '')}`],
    __generatedByExpansion: 'japaneseCountersExpansion',
  };
}

function buildDedupKey(entry) {
  const kanji = String(entry?.kanji || '').trim();
  const reading = String(entry?.reading || entry?.kana || '').trim();
  const type = String(entry?.type || '').trim();
  return `${kanji}|${reading}|${type}`;
}

function isJapaneseWordsCollection(collection) {
  const key = String(collection?.key || '').trim().toLowerCase();
  return key.endsWith('japanese/japanese_words.json');
}

export function getJapaneseCountersExpansionControlConfig(collection) {
  const supports = isJapaneseWordsCollection(collection);
  const baseItems = supports
    ? JAPANESE_COUNTER_DEFINITIONS.map(def => ({
        value: def.value,
        label: def.label,
        rightText: def.rightText,
        counterKanji: def.counterKanji,
        meaningUnit: def.meaningUnit,
        exceptions: Array.isArray(def.exceptions) ? def.exceptions.slice() : [],
      }))
    : [];

  return {
    type: 'japanese.counters',
    supports: { counters: supports },
    counterBaseItems: baseItems.map(x => ({ ...x })),
    counterItems: baseItems.map(x => ({ ...x })),
  };
}

export function expandJapaneseCountersEntriesAndIndices(entries, indices, { counterForms = [] } = {}) {
  const arr = Array.isArray(entries) ? entries : [];
  const idx = Array.isArray(indices) ? indices : arr.map((_, i) => i);
  const selected = uniqueInOrder(normalizeExpansionForms(counterForms));
  if (!selected.length) return { entries: arr.slice(), indices: idx.slice() };

  const defsByValue = new Map(JAPANESE_COUNTER_DEFINITIONS.map(def => [String(def.value), def]));
  const selectedDefs = selected.map(v => defsByValue.get(v)).filter(Boolean);
  if (!selectedDefs.length) return { entries: arr.slice(), indices: idx.slice() };

  const outEntries = arr.slice();
  const outIndices = idx.slice();
  const seen = new Set(arr.map(buildDedupKey));

  for (const def of selectedDefs) {
    for (const n of COUNTER_NUMBER_RANGE) {
      const generated = buildCounterEntry(def, n);
      if (!generated) continue;
      const dedupeKey = buildDedupKey(generated);
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      outEntries.push(generated);
      outIndices.push(-1);
    }
  }

  return { entries: outEntries, indices: outIndices };
}

export function getJapaneseCountersExpansionDeltas(entries, { counterForms = [] } = {}) {
  const arr = Array.isArray(entries) ? entries : [];
  const selected = uniqueInOrder(normalizeExpansionForms(counterForms));
  if (!selected.length) {
    return {
      counterDelta: 0,
      counterFormsCount: 0,
      counterDefinitionCount: JAPANESE_COUNTER_DEFINITIONS.length,
      counterRangeSize: COUNTER_NUMBER_RANGE.length,
    };
  }

  const defsByValue = new Map(JAPANESE_COUNTER_DEFINITIONS.map(def => [String(def.value), def]));
  const selectedDefs = selected.map(v => defsByValue.get(v)).filter(Boolean);
  const seen = new Set(arr.map(buildDedupKey));
  let generatedCount = 0;

  for (const def of selectedDefs) {
    for (const n of COUNTER_NUMBER_RANGE) {
      const generated = buildCounterEntry(def, n);
      if (!generated) continue;
      const dedupeKey = buildDedupKey(generated);
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      generatedCount++;
    }
  }

  return {
    counterDelta: generatedCount,
    counterFormsCount: selectedDefs.length,
    counterDefinitionCount: JAPANESE_COUNTER_DEFINITIONS.length,
    counterRangeSize: COUNTER_NUMBER_RANGE.length,
  };
}
