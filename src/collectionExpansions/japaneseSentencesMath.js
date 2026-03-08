const SAMPLES_PER_TYPE = 12;

export const JAPANESE_SENTENCE_MATH_PROBLEM_TYPES = [
  {
    value: 'a_plus_b_eq_c',
    label: 'a+b=c',
    rightText: 'add',
    template: 'a+b=c',
    operators: ['+'],
    constraints: { a: [0, 50], b: [0, 50] },
  },
  {
    value: 'a_plus_b_minus_c_eq_d',
    label: 'a+b-c=d',
    rightText: 'add/sub',
    template: 'a+b-c=d',
    operators: ['+', '-'],
    constraints: { a: [0, 60], b: [0, 40], c: [0, 40] },
  },
  {
    value: 'a_times_b_eq_c',
    label: 'axb=c',
    rightText: 'multiply',
    template: 'axb=c',
    operators: ['*'],
    constraints: { a: [0, 12], b: [0, 12] },
  },
  {
    value: 'a_div_b_eq_c',
    label: 'a/b=c',
    rightText: 'divide',
    template: 'a/b=c',
    operators: ['/'],
    constraints: { b: [1, 12], c: [0, 12] },
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

function hashStringToSeed(str) {
  let h = 2166136261 >>> 0;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function createMulberry32(seed) {
  let t = seed >>> 0;
  return function rand() {
    t += 0x6D2B79F5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng, min, max) {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return lo + Math.floor(rng() * (hi - lo + 1));
}


function numberToKanji(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n ?? '');
  if (v === 0) return '零';
  if (v < 0) return `マイナス${numberToKanji(Math.abs(v))}`;

  const digitKanji = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

  function under10000(x) {
    const num = Math.floor(x);
    const thousands = Math.floor(num / 1000);
    const hundreds = Math.floor((num % 1000) / 100);
    const tens = Math.floor((num % 100) / 10);
    const ones = num % 10;
    let out = '';
    if (thousands) out += (thousands === 1 ? '' : digitKanji[thousands]) + '千';
    if (hundreds) out += (hundreds === 1 ? '' : digitKanji[hundreds]) + '百';
    if (tens) out += (tens === 1 ? '' : digitKanji[tens]) + '十';
    if (ones) out += digitKanji[ones];
    return out || '零';
  }

  const units = [
    { value: 100000000, label: '億' },
    { value: 10000, label: '万' },
  ];

  let remaining = Math.floor(v);
  let out = '';
  for (const u of units) {
    if (remaining >= u.value) {
      const q = Math.floor(remaining / u.value);
      out += `${under10000(q)}${u.label}`;
      remaining %= u.value;
    }
  }
  if (remaining > 0) out += under10000(remaining);
  return out || '零';
}

function buildMathProblem(def, rng) {
  const id = String(def?.value || '');
  if (!id) return null;

  if (id === 'a_plus_b_eq_c') {
    const a = randInt(rng, def.constraints.a[0], def.constraints.a[1]);
    const b = randInt(rng, def.constraints.b[0], def.constraints.b[1]);
    const c = a + b;
    return {
      a, b, c,
      ja: `${numberToKanji(a)}たす${numberToKanji(b)}は${numberToKanji(c)}です。`,
      en: `${a} plus ${b} equals ${c}.`,
      exprEn: `${a} + ${b} = ${c}`,
    };
  }

  if (id === 'a_plus_b_minus_c_eq_d') {
    const a = randInt(rng, def.constraints.a[0], def.constraints.a[1]);
    const b = randInt(rng, def.constraints.b[0], def.constraints.b[1]);
    const c = randInt(rng, def.constraints.c[0], def.constraints.c[1]);
    const d = a + b - c;
    return {
      a, b, c, d,
      ja: `${numberToKanji(a)}たす${numberToKanji(b)}ひく${numberToKanji(c)}は${numberToKanji(d)}です。`,
      en: `${a} plus ${b} minus ${c} is ${d}.`,
      exprEn: `${a} + ${b} - ${c} = ${d}`,
    };
  }

  if (id === 'a_times_b_eq_c') {
    const a = randInt(rng, def.constraints.a[0], def.constraints.a[1]);
    const b = randInt(rng, def.constraints.b[0], def.constraints.b[1]);
    const c = a * b;
    return {
      a, b, c,
      ja: `${numberToKanji(a)}かける${numberToKanji(b)}は${numberToKanji(c)}です。`,
      en: `${a} times ${b} equals ${c}.`,
      exprEn: `${a} * ${b} = ${c}`,
    };
  }

  if (id === 'a_div_b_eq_c') {
    const b = randInt(rng, def.constraints.b[0], def.constraints.b[1]);
    const c = randInt(rng, def.constraints.c[0], def.constraints.c[1]);
    const a = b * c;
    return {
      a, b, c,
      ja: `${numberToKanji(a)}わる${numberToKanji(b)}は${numberToKanji(c)}です。`,
      en: `${a} divided by ${b} equals ${c}.`,
      exprEn: `${a} / ${b} = ${c}`,
    };
  }

  return null;
}

function buildSentenceEntry(def, problem, indexWithinType) {
  if (!problem) return null;
  const problemType = String(def?.value || '').trim();
  const tag = `math_${problemType}`;
  const refs = [String(problem?.a ?? ''), String(problem?.b ?? ''), String(problem?.c ?? ''), String(problem?.d ?? '')].filter(Boolean);

  return {
    ja: problem.ja,
    en: problem.en,
    type: 'expression',
    lexicalClass: 'generated-math-sentence',
    tags: ['sentence_generated', 'math_generated', tag],
    grammarNotes: [
      `Math template: ${String(def?.template || '')}`,
      'XたすY = X plus Y, XひくY = X minus Y, XかけるY = X times Y, XわるY = X divided by Y.',
    ],
    notes: [
      `Generated arithmetic sentence (${problem.exprEn}).`,
      `Variation index: ${indexWithinType + 1}`,
    ],
    chunks: [
      {
        ja: problem.ja.replace(/。$/, ''),
        gloss: problem.en,
        focus: String(def?.template || ''),
        refs,
      },
    ],
    __generatedByExpansion: 'japaneseSentencesMath',
    __mathProblemType: problemType,
  };
}

function buildDedupKey(entry) {
  const ja = String(entry?.ja || '').trim();
  const en = String(entry?.en || '').trim();
  return `${ja}|${en}`;
}

function isJapaneseSentencesCollection(collection) {
  const key = String(collection?.key || '').trim().toLowerCase();
  if (key.endsWith('japanese/japanese_sentences.json')) return true;
  const hasJa = Array.isArray(collection?.metadata?.schema)
    ? collection.metadata.schema.some(f => String(f?.key || '').trim() === 'ja')
    : false;
  const hasEn = Array.isArray(collection?.metadata?.schema)
    ? collection.metadata.schema.some(f => String(f?.key || '').trim() === 'en')
    : false;
  const hasChunks = Array.isArray(collection?.metadata?.schema)
    ? collection.metadata.schema.some(f => String(f?.key || '').trim() === 'chunks')
    : false;
  return hasJa && hasEn && hasChunks;
}

export function getJapaneseSentencesMathExpansionControlConfig(collection) {
  const supports = isJapaneseSentencesCollection(collection);
  return {
    type: 'japanese.sentences.math',
    supports: { sentenceMath: supports },
    sentenceMathBaseItems: supports
      ? JAPANESE_SENTENCE_MATH_PROBLEM_TYPES.map(def => ({
          value: def.value,
          label: def.label,
          rightText: def.rightText,
          template: def.template,
          operators: Array.isArray(def.operators) ? def.operators.slice() : [],
        }))
      : [],
    sentenceMathItems: supports
      ? JAPANESE_SENTENCE_MATH_PROBLEM_TYPES.map(def => ({
          value: def.value,
          label: def.label,
          rightText: def.rightText,
          template: def.template,
          operators: Array.isArray(def.operators) ? def.operators.slice() : [],
        }))
      : [],
  };
}

export function expandJapaneseSentencesMathEntriesAndIndices(
  entries,
  indices,
  { sentenceMathForms = [], generationSeed = 0 } = {},
) {
  const arr = Array.isArray(entries) ? entries : [];
  const idx = Array.isArray(indices) ? indices : arr.map((_, i) => i);
  const selected = uniqueInOrder(normalizeExpansionForms(sentenceMathForms));
  if (!selected.length) return { entries: arr.slice(), indices: idx.slice() };

  const defsByValue = new Map(JAPANESE_SENTENCE_MATH_PROBLEM_TYPES.map(def => [String(def.value), def]));
  const selectedDefs = selected.map(v => defsByValue.get(v)).filter(Boolean);
  if (!selectedDefs.length) return { entries: arr.slice(), indices: idx.slice() };

  const seedInput = `${generationSeed}|${selectedDefs.map(d => d.value).join(',')}`;
  const rng = createMulberry32(hashStringToSeed(seedInput));

  const outEntries = arr.slice();
  const outIndices = idx.slice();
  const seen = new Set(arr.map(buildDedupKey));

  for (const def of selectedDefs) {
    for (let i = 0; i < SAMPLES_PER_TYPE; i++) {
      const problem = buildMathProblem(def, rng);
      const entry = buildSentenceEntry(def, problem, i);
      if (!entry) continue;
      const key = buildDedupKey(entry);
      if (seen.has(key)) continue;
      seen.add(key);
      outEntries.push(entry);
      outIndices.push(-1);
    }
  }

  return { entries: outEntries, indices: outIndices };
}

export function getJapaneseSentencesMathExpansionDeltas(entries, { sentenceMathForms = [] } = {}) {
  const arr = Array.isArray(entries) ? entries : [];
  const selected = uniqueInOrder(normalizeExpansionForms(sentenceMathForms));
  const defsByValue = new Map(JAPANESE_SENTENCE_MATH_PROBLEM_TYPES.map(def => [String(def.value), def]));
  const selectedDefs = selected.map(v => defsByValue.get(v)).filter(Boolean);
  if (!selectedDefs.length) {
    return {
      sentenceMathDelta: 0,
      sentenceMathFormsCount: 0,
      sentenceMathTypesCount: JAPANESE_SENTENCE_MATH_PROBLEM_TYPES.length,
      sentenceMathSamplesPerType: SAMPLES_PER_TYPE,
    };
  }

  const maxCandidate = selectedDefs.length * SAMPLES_PER_TYPE;
  const existing = new Set(arr.map(buildDedupKey));
  let conservativeDelta = Math.max(0, maxCandidate - existing.size);
  if (!Number.isFinite(conservativeDelta)) conservativeDelta = 0;

  return {
    sentenceMathDelta: conservativeDelta,
    sentenceMathFormsCount: selectedDefs.length,
    sentenceMathTypesCount: JAPANESE_SENTENCE_MATH_PROBLEM_TYPES.length,
    sentenceMathSamplesPerType: SAMPLES_PER_TYPE,
  };
}
