function normalizeToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function asNormalizedSet(values) {
  const set = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const token = normalizeToken(value);
    if (token) set.add(token);
  }
  return set;
}

function detectArrayKey(collection) {
  if (!collection || typeof collection !== 'object') return 'entries';
  for (const key of ['entries', 'sentences', 'paragraphs', 'items', 'cards']) {
    if (Array.isArray(collection[key])) return key;
  }
  for (const [key, value] of Object.entries(collection)) {
    if (key === 'metadata' || key === 'schema') continue;
    if (Array.isArray(value)) return key;
  }
  return 'entries';
}

function buildCollectionExamples({ collection, safeJsonStringify }) {
  const schema = Array.isArray(collection?.metadata?.schema) ? collection.metadata.schema : (Array.isArray(collection?.schema) ? collection.schema : []);
  const arrayKey = detectArrayKey(collection) || 'entries';
  const entriesArr = Array.isArray(collection?.[arrayKey]) ? collection[arrayKey] : [];

  if (!entriesArr.length) return [];

  const total = entriesArr.length;
  const idxSet = new Set();
  for (let i = 0; i < 100; i += 1) {
    const idx = Math.floor(i * total / 100);
    idxSet.add(Math.min(total - 1, Math.max(0, idx)));
  }
  const sampled = Array.from(idxSet).sort((a, b) => a - b).map((i) => entriesArr[i]).filter(Boolean);

  let fieldKeys = [];
  if (Array.isArray(schema) && schema.length) {
    fieldKeys = schema.map((field) => (field && typeof field === 'object' ? field.key : null)).filter(Boolean);
  }
  if (!fieldKeys.length) {
    const firstObj = entriesArr.find((entry) => entry && typeof entry === 'object');
    if (firstObj) fieldKeys = Object.keys(firstObj || []);
  }

  const valKey = (value) => {
    try { return safeJsonStringify(value); } catch (e) { return String(value); }
  };

  let groupingKey = null;
  let bestCounts = null;
  for (const key of fieldKeys) {
    const counts = new Map();
    for (const entry of sampled) {
      const value = entry && typeof entry === 'object' ? entry[key] : undefined;
      const valueKey = valKey(value);
      counts.set(valueKey, (counts.get(valueKey) || 0) + 1);
      if (counts.size > 200) break;
    }
    if (counts.size >= 5) {
      groupingKey = key;
      bestCounts = counts;
      break;
    }
  }

  function limitRelatedCollections(entry) {
    if (!entry || typeof entry !== 'object') return entry;
    const copy = { ...entry };
    if (copy.relatedCollections && typeof copy.relatedCollections === 'object') {
      const related = {};
      for (const [key, value] of Object.entries(copy.relatedCollections)) {
        if (Array.isArray(value)) related[key] = value.length ? [value[0]] : [];
        else related[key] = value;
      }
      copy.relatedCollections = related;
    }
    return copy;
  }

  if (!groupingKey || !bestCounts) {
    return sampled.slice(0, Math.min(5, sampled.length)).map(limitRelatedCollections);
  }

  const topValues = Array.from(bestCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map((entry) => entry[0]);

  const reps = [];
  for (const topValue of topValues) {
    const found = sampled.find((entry) => valKey(entry && entry[groupingKey]) === topValue)
      || entriesArr.find((entry) => valKey(entry && entry[groupingKey]) === topValue);
    if (found) reps.push(limitRelatedCollections(found));
  }
  return reps.slice(0, 5);
}

const TEMPLATE_REGISTRY = [
  // Add rare collection-specific variants above the default template.
  // Collections can opt in explicitly with metadata._aiPromptTemplate = "<template-id>".
  {
    id: 'generic',
    title: 'Generic collection import prompt',
    context:
      'Context: I will paste the metadata and several example entries from a collection. Using the provided schema in metadata, produce new entries that match the schema and reflect the concepts shown in the examples. Return only a JSON array of new entries.',
    instructions: [
      'Produce new entries that follow the schema exactly.',
      'Use the metadata and examples to preserve field meanings, formatting, and level of detail.',
      'Output only a JSON array of entries with no extra text.',
    ],
    match: { default: true },
  },
];

function getTemplateSignals({ collection, collectionKey }) {
  const metadata = (collection && typeof collection === 'object' && collection.metadata && typeof collection.metadata === 'object')
    ? collection.metadata
    : {};

  return {
    explicitTemplateId: String(metadata._aiPromptTemplate || metadata.aiPromptTemplate || '').trim(),
    collectionKey: String(collectionKey || '').trim(),
    category: String(metadata.category || '').trim(),
    name: String(metadata.name || '').trim(),
    entryKey: String(metadata.entry_key || '').trim(),
  };
}

function matchesTemplate(template, signals) {
  const match = (template && typeof template === 'object' && template.match && typeof template.match === 'object')
    ? template.match
    : {};

  if (match.default) return true;

  const keys = asNormalizedSet(match.collectionKeys);
  const categories = asNormalizedSet(match.categories);
  const names = asNormalizedSet(match.names);
  const entryKeys = asNormalizedSet(match.entryKeys);

  if (keys.size && keys.has(normalizeToken(signals.collectionKey))) return true;
  if (categories.size && categories.has(normalizeToken(signals.category))) return true;
  if (names.size && names.has(normalizeToken(signals.name))) return true;
  if (entryKeys.size && entryKeys.has(normalizeToken(signals.entryKey))) return true;
  return false;
}

export function resolveManageCollectionsAiPromptTemplate({ collection, collectionKey } = {}) {
  const signals = getTemplateSignals({ collection, collectionKey });
  const explicitId = normalizeToken(signals.explicitTemplateId);

  if (explicitId) {
    const explicit = TEMPLATE_REGISTRY.find((template) => normalizeToken(template.id) === explicitId);
    if (explicit) return explicit;
  }

  const specific = TEMPLATE_REGISTRY.find((template) => !template?.match?.default && matchesTemplate(template, signals));
  if (specific) return specific;

  return TEMPLATE_REGISTRY.find((template) => !!template?.match?.default) || TEMPLATE_REGISTRY[0];
}

export function buildManageCollectionsAiPrompt({
  collection,
  collectionKey,
  metadata,
  examples,
  safeJsonStringify,
} = {}) {
  const stringify = typeof safeJsonStringify === 'function'
    ? safeJsonStringify
    : (value, space = 2) => JSON.stringify(value, null, space);
  const template = resolveManageCollectionsAiPromptTemplate({ collection, collectionKey });
  const parts = [
    template.context,
    `Metadata:\n${stringify(metadata, 0)}`,
    `Examples:\n${stringify(examples, 0)}`,
    `Instructions:\n${template.instructions.map((line) => `- ${line}`).join('\n')}`,
  ];
  return parts.join('\n\n');
}

export function prepareManageCollectionsPromptPayload({ collection, safeJsonStringify } = {}) {
  const metadata = (collection?.metadata && typeof collection.metadata === 'object') ? { ...collection.metadata } : (collection?.metadata ?? {});
  try {
    if (metadata && typeof metadata === 'object') delete metadata.relatedCollections;
  } catch (e) {}

  const examples = buildCollectionExamples({ collection, safeJsonStringify }).map((entry) => {
    if (!entry || typeof entry !== 'object') return entry;
    const copy = { ...entry };
    try { delete copy.relatedCollections; } catch (e) {}
    return copy;
  });

  return { metadata, examples };
}

export function createBalancedMissingBatches(items, targetSize = 20) {
  const list = Array.isArray(items) ? items.slice().filter((item) => item != null) : [];
  const size = Math.max(1, Number(targetSize) || 20);
  if (!list.length) return [];

  const batchCount = Math.max(1, Math.ceil(list.length / size));
  const baseSize = Math.floor(list.length / batchCount);
  const remainder = list.length % batchCount;
  const batches = [];
  let cursor = 0;

  for (let index = 0; index < batchCount; index += 1) {
    const nextSize = baseSize + (index < remainder ? 1 : 0);
    batches.push(list.slice(cursor, cursor + nextSize));
    cursor += nextSize;
  }

  return batches.filter((batch) => batch.length > 0);
}

export function buildManageCollectionsMissingRecordsPrompt({
  targetCollection,
  targetCollectionKey,
  sourceCollectionKey,
  relation,
  missingValues,
  safeJsonStringify,
} = {}) {
  const stringify = typeof safeJsonStringify === 'function'
    ? safeJsonStringify
    : (value, space = 2) => JSON.stringify(value, null, space);
  const payload = prepareManageCollectionsPromptPayload({ collection: targetCollection, safeJsonStringify: stringify });
  const relationSummary = {
    sourceCollection: String(sourceCollectionKey || ''),
    targetCollection: String(targetCollectionKey || ''),
    relationName: String(relation?.name || ''),
    sourceKey: relation?.thisKey ?? null,
    targetReferenceField: relation?.foreignKey ?? null,
    requestedCount: Array.isArray(missingValues) ? missingValues.length : 0,
  };
  const parts = [
    'Context: I will paste the target collection metadata and examples, plus a batch of missing source references that still need records in the target collection. Produce new entries for the target collection only.',
    `Target Metadata:\n${stringify(payload.metadata, 0)}`,
    `Target Examples:\n${stringify(payload.examples, 0)}`,
    `Relation Summary:\n${stringify(relationSummary, 0)}`,
    `Missing Source References:\n${stringify(Array.isArray(missingValues) ? missingValues : [], 0)}`,
    [
      'Instructions:',
      '- Produce new entries that follow the target schema exactly.',
      '- Cover every missing source reference in this batch.',
      '- If the schema includes the target reference field, populate it so the source reference is preserved.',
      '- Match the style and level of detail shown in the target examples.',
      '- Output only a JSON array of entries with no extra text.',
    ].join('\n'),
  ];
  return parts.join('\n\n');
}

export { TEMPLATE_REGISTRY as manageCollectionsAiPromptTemplates };
