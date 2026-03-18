import { el } from '../../utils/browser/ui.js';
import { createJsonViewer } from '../shared/jsonViewer.js';
import { confirmDialog } from './confirmDialog.js';
import {
  manageCollectionsAiPromptTemplates,
  prepareManageCollectionsPromptPayload,
  resolveManageCollectionsAiPromptTemplate,
} from '../../templates/aiPromptsManageCollections.js';

const DIALOG_STYLE_ID = 'ai-prompts-editor-dialog-styles';

const VALIDATION_OPTIONS = [
  {
    path: 'duplicated_keys',
    label: 'duplicated_keys',
    description: 'Collection-level validation for duplicate or invalid entry-key values.',
    supported: false,
  },
  {
    path: 'missing_related_collection_data',
    label: 'missing_related_collection_data',
    description: 'Relation validation for source references that do not yet exist in the target collection.',
    supported: true,
  },
];

const JSON_COMPRESSION_OPTIONS = [
  { value: 'none', label: 'none (pretty JSON)' },
  { value: 'no-pretty', label: 'no-pretty (single line)' },
  { value: 'key-tabularized', label: 'key-tabularized (compact arrays of objects)' },
];

const SAMPLE_SELECTION_OPTIONS = [
  { value: 'representative', label: 'Representative spread', description: 'Use the current builder behavior from the template helper.' },
  { value: 'first-five', label: 'First five', description: 'Keep the first five examples after payload prep.' },
  { value: 'last-five', label: 'Last five', description: 'Use the last five examples after payload prep.' },
];

const TOKEN_DEFS = [
  { token: '{context}', group: 'text', title: 'Context block', source: 'Custom text block' },
  { token: '{instructions_bulleted}', group: 'text', title: 'Instructions', source: 'Generated from instruction lines' },
  { token: '{metadata}', group: 'data', title: 'Metadata', source: 'Injected collection metadata JSON' },
  { token: '{examples}', group: 'data', title: 'Examples', source: 'Injected example records JSON' },
  { token: '{template_id}', group: 'data', title: 'Template id', source: 'Resolved template selection' },
  { token: '{collection}', group: 'data', title: 'Collection key', source: 'Resolved collection scope' },
  { token: '{relation_summary}', group: 'validation', title: 'Relation summary', source: 'Validation relation summary JSON', validationOnly: true, validationPaths: ['missing_related_collection_data'] },
  { token: '{missing_values}', group: 'validation', title: 'Missing values', source: 'Validation missing-reference batch JSON', validationOnly: true, validationPaths: ['missing_related_collection_data'] },
  { token: '{validation_paths}', group: 'validation', title: 'Validation paths', source: 'Selected validation scopes', validationOnly: true, validationPaths: ['*'] },
];

function ensureStyles() {
  if (document.getElementById(DIALOG_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = DIALOG_STYLE_ID;
  style.textContent = `
.ai-prompts-editor-dialog {
  position: fixed;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%) scale(0.98);
  width: min(1280px, calc(100vw - 32px));
  height: min(860px, calc(100vh - 32px));
  max-width: 1280px;
  max-height: 860px;
  display: flex;
  flex-direction: column;
  z-index: 100000;
  overflow: hidden;
  background: var(--panel);
  color: var(--text);
  border: var(--border-1);
  box-shadow: 0 10px 40px rgba(2, 6, 23, 0.7);
  opacity: 0;
  transition: opacity 120ms ease, transform 120ms cubic-bezier(.2, .9, .3, 1);
}
.ai-prompts-editor-dialog.open {
  opacity: 1;
  transform: translate(-50%, -50%) scale(1);
}
.ai-prompts-editor-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  padding: 16px 18px 12px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
}
.ai-prompts-editor-header-main {
  min-width: 0;
}
.ai-prompts-editor-title {
  font-size: 1.1rem;
  font-weight: 700;
}
.ai-prompts-editor-subtitle {
  margin-top: 4px;
  opacity: 0.8;
}
.ai-prompts-editor-header-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.ai-prompts-editor-shell {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 290px minmax(0, 1fr);
}
.ai-prompts-editor-sidebar {
  min-width: 0;
  border-right: 1px solid rgba(255,255,255,0.08);
  display: flex;
  flex-direction: column;
}
.ai-prompts-editor-sidebar-head {
  padding: 14px 14px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ai-prompts-editor-sidebar-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 10px 12px;
}
.ai-prompts-editor-item {
  width: 100%;
  text-align: left;
  border: 1px solid rgba(255,255,255,0.1);
  background: color-mix(in srgb, var(--panel, #0f172a) 90%, black 10%);
  border-radius: 10px;
  padding: 10px 12px;
  margin-bottom: 8px;
}
.ai-prompts-editor-item.active {
  border-color: rgba(120,180,255,0.7);
  background: rgba(120,180,255,0.12);
}
.ai-prompts-editor-item-title-row,
.ai-prompts-editor-row-between,
.ai-prompts-editor-chip-row,
.ai-prompts-editor-field-row,
.ai-prompts-editor-section-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
}
.ai-prompts-editor-item-title {
  font-weight: 600;
}
.ai-prompts-editor-item-meta,
.ai-prompts-editor-micro,
.ai-prompts-editor-helper,
.ai-prompts-editor-pill-muted {
  font-size: 0.85rem;
  opacity: 0.78;
}
.ai-prompts-editor-pill,
.ai-prompts-editor-tag,
.ai-prompts-editor-syntax {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 0.8rem;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.05);
}
.ai-prompts-editor-tag.unsupported {
  border-color: rgba(255,180,120,0.55);
  background: rgba(255,180,120,0.1);
}
.ai-prompts-editor-dirty-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #f6c453;
  display: inline-block;
}
.ai-prompts-editor-main {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 14px;
}
.ai-prompts-editor-grid {
  display: grid;
  gap: 12px;
}
.ai-prompts-editor-grid.two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.ai-prompts-editor-section {
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 12px;
  background: color-mix(in srgb, var(--panel, #0f172a) 92%, black 8%);
  padding: 12px;
}
.ai-prompts-editor-section-title {
  font-weight: 700;
  margin-bottom: 8px;
}
.ai-prompts-editor-section-subtitle {
  margin-bottom: 10px;
  font-size: 0.92rem;
  opacity: 0.8;
}
.ai-prompts-editor-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.ai-prompts-editor-field label {
  font-size: 0.9rem;
  font-weight: 600;
}
.ai-prompts-editor-field input[type="text"],
.ai-prompts-editor-field select,
.ai-prompts-editor-field textarea {
  width: 100%;
  min-width: 0;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.14);
  background: rgba(0,0,0,0.2);
  color: inherit;
  padding: 8px 10px;
}
.ai-prompts-editor-field textarea {
  resize: vertical;
  min-height: 110px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  line-height: 1.4;
}
.ai-prompts-editor-field select[multiple] {
  min-height: 120px;
}
.ai-prompts-editor-token-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}
.ai-prompts-editor-token-bar button,
.ai-prompts-editor-mini-btn {
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.05);
  color: inherit;
  padding: 4px 10px;
}
.ai-prompts-editor-token-groups {
  display: grid;
  gap: 10px;
}
.ai-prompts-editor-token-group {
  display: grid;
  gap: 8px;
}
.ai-prompts-editor-token-group-head {
  font-size: 0.85rem;
  font-weight: 700;
  opacity: 0.82;
}
.ai-prompts-editor-token-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.ai-prompts-editor-token-row .ai-prompts-editor-mini-btn {
  cursor: pointer;
}
.ai-prompts-editor-token-source {
  font-size: 0.82rem;
  opacity: 0.72;
}
.ai-prompts-editor-mini-btn[data-expanded="true"] {
  background: rgba(96,165,250,0.18);
  border-color: rgba(96,165,250,0.4);
}
.ai-prompts-editor-preview-body {
  padding: 0 12px 12px;
  display: grid;
  gap: 8px;
}
.ai-prompts-editor-preview-inline {
  display: grid;
  gap: 6px;
}
.ai-prompts-editor-preview-line {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.45;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.ai-prompts-editor-preview-token-line {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding-left: 16px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.ai-prompts-editor-preview-token-name {
  color: var(--muted);
  font-style: italic;
  border-radius: 6px;
  padding: 2px 6px;
  transition: background 120ms ease, color 120ms ease;
  cursor: pointer;
}
.ai-prompts-editor-preview-token-name:hover {
  background: rgba(96,165,250,0.1);
  color: var(--text);
}
.ai-prompts-editor-preview-token-body-wrap {
  border-radius: 10px;
  transition: background 120ms ease;
  cursor: pointer;
}
.ai-prompts-editor-preview-token-body-wrap:hover {
  background: rgba(96,165,250,0.06);
}
.ai-prompts-editor-preview-token-body {
  padding: 6px 10px 8px 34px;
}
.ai-prompts-editor-source-active {
  box-shadow: 0 0 0 2px rgba(96,165,250,0.45);
  border-radius: 10px;
}
.ai-prompts-editor-preview-text {
  border-radius: 10px;
  background: rgba(0,0,0,0.22);
  border: 1px solid rgba(255,255,255,0.08);
  padding: 10px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 260px;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  line-height: 1.45;
}
.ai-prompts-editor-json-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.ai-prompts-editor-json-card {
  min-width: 0;
}
.ai-prompts-editor-validation-list {
  display: grid;
  gap: 8px;
}
.ai-prompts-editor-validation-option {
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px;
  padding: 8px 10px;
  background: rgba(255,255,255,0.02);
}
.ai-prompts-editor-footer {
  border-top: 1px solid rgba(255,255,255,0.08);
  padding: 12px 16px;
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.ai-prompts-editor-empty {
  padding: 18px;
  text-align: center;
  opacity: 0.75;
}
@media (max-width: 980px) {
  .ai-prompts-editor-shell {
    grid-template-columns: 1fr;
  }
  .ai-prompts-editor-sidebar {
    border-right: 0;
    border-bottom: 1px solid rgba(255,255,255,0.08);
    max-height: 220px;
  }
  .ai-prompts-editor-grid.two,
  .ai-prompts-editor-json-grid {
    grid-template-columns: 1fr;
  }
}
`;
  document.head.appendChild(style);
}

function cloneJson(value, fallback = null) {
  try { return JSON.parse(JSON.stringify(value)); } catch (e) { return fallback; }
}

function normalizeCollectionPath(value) {
  const raw = String(value || '').trim().replace(/\\/g, '/');
  if (!raw) return '';
  return raw.replace(/^collections\//, '');
}

function titleCasePath(value) {
  const txt = String(value || '').trim();
  if (!txt) return '(unspecified)';
  return txt.split(/[_/]/g).filter(Boolean).join(' / ');
}

function safeStringify(value) {
  try { return JSON.stringify(value, null, 2); } catch (e) { return String(value); }
}

function tabularizeArrayObjects(value) {
  if (Array.isArray(value)) {
    const items = value.map((item) => tabularizeArrayObjects(item));
    const objectItems = items.filter((item) => item && typeof item === 'object' && !Array.isArray(item));
    if (items.length && objectItems.length === items.length) {
      const keys = [];
      const keySet = new Set();
      objectItems.forEach((item) => {
        Object.keys(item).forEach((key) => {
          if (!keySet.has(key)) {
            keySet.add(key);
            keys.push(key);
          }
        });
      });
      return {
        keys,
        rows: objectItems.map((item) => keys.map((key) => Object.prototype.hasOwnProperty.call(item, key) ? item[key] : null)),
      };
    }
    return items;
  }
  if (!value || typeof value !== 'object') return value;
  const out = {};
  Object.entries(value).forEach(([key, inner]) => {
    out[key] = tabularizeArrayObjects(inner);
  });
  return out;
}

function makeStringifier(mode) {
  return (value) => {
    try {
      if (mode === 'no-pretty') return JSON.stringify(value);
      if (mode === 'key-tabularized') return JSON.stringify(tabularizeArrayObjects(value));
      return JSON.stringify(value, null, 2);
    } catch (e) {
      return String(value);
    }
  };
}

function getCollectionOptions({ collectionsByPath, collections, collection, collectionKey } = {}) {
  const options = [];
  const seen = new Set();

  const pushOption = (path, label, value) => {
    const normalized = normalizeCollectionPath(path);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    options.push({
      value: normalized,
      label: String(label || normalized),
      collection: value && typeof value === 'object' ? value : null,
    });
  };

  if (collectionsByPath && typeof collectionsByPath === 'object') {
    Object.entries(collectionsByPath).forEach(([path, value]) => {
      pushOption(path, value?.metadata?.name || path, value);
    });
  }

  if (Array.isArray(collections)) {
    collections.forEach((entry, index) => {
      const path = entry?.path || entry?.key || entry?.collectionKey || index;
      pushOption(path, entry?.metadata?.name || entry?.name || path, entry?.collection || entry?.data || entry);
    });
  }

  if (collection || collectionKey) {
    pushOption(collectionKey || collection?.path || collection?.key || 'current', collection?.metadata?.name || collectionKey || 'Current collection', collection);
  }

  return options.sort((a, b) => String(a.label || a.value).localeCompare(String(b.label || b.value), 'en'));
}

function buildFallbackCollection(collectionKey = 'collections/example_collection') {
  const normalized = normalizeCollectionPath(collectionKey || 'example_collection') || 'example_collection';
  return {
    metadata: {
      name: titleCasePath(normalized),
      description: 'Fallback collection used for AI prompt editing previews.',
      entry_key: 'id',
      schema: [
        { key: 'id', type: 'string' },
        { key: 'front', type: 'string' },
        { key: 'back', type: 'string' },
        { key: 'tags', type: 'array<string>' },
      ],
      relatedCollections: {
        examples: [
          {
            path: 'collections/example_related',
            name: 'examples',
            foreign_key: 'sourceId',
          },
        ],
      },
    },
    entries: [
      { id: 'alpha', front: 'hola', back: 'hello', tags: ['greeting'] },
      { id: 'beta', front: 'adios', back: 'goodbye', tags: ['farewell'] },
      { id: 'gamma', front: 'gracias', back: 'thank you', tags: ['common'] },
      { id: 'delta', front: 'por favor', back: 'please', tags: ['common'] },
      { id: 'epsilon', front: 'perro', back: 'dog', tags: ['noun'] },
      { id: 'zeta', front: 'gato', back: 'cat', tags: ['noun'] },
    ],
  };
}

function chooseCollectionForDraft(draft, context) {
  if (draft.invocationMode === 'validation' && context.validationPreview?.targetCollection) {
    return context.validationPreview.targetCollection;
  }
  const options = context.collectionOptions || [];
  const byValue = new Map(options.map((item) => [normalizeCollectionPath(item.value), item.collection]));
  if (draft.collectionScope === 'selected') {
    const found = (draft.collectionTargets || []).map((value) => byValue.get(normalizeCollectionPath(value))).find(Boolean);
    if (found) return found;
  }
  return context.collection || options.find((item) => item.collection)?.collection || buildFallbackCollection(context.collectionKey);
}

function applySampleSelection(examples, mode) {
  const list = Array.isArray(examples) ? examples.slice() : [];
  if (mode === 'first-five') return list.slice(0, 5);
  if (mode === 'last-five') return list.slice(Math.max(0, list.length - 5));
  return list;
}

function normalizeValidationTargets(values) {
  const raw = Array.isArray(values) ? values.map((value) => String(value || '').trim()).filter(Boolean) : [];
  if (raw.includes('*')) return ['*'];
  const known = new Set(VALIDATION_OPTIONS.map((item) => item.path));
  return raw.filter((value, index) => known.has(value) && raw.indexOf(value) === index);
}

function getValidationModeValue(draft) {
  if (draft.invocationMode !== 'validation') return 'generic';
  const targets = normalizeValidationTargets(draft.validationTargets);
  if (!targets.length || targets.includes('*')) return 'all_validations';
  return targets[0];
}

function applyValidationModeValue(draft, value) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized === 'generic') {
    draft.invocationMode = 'generic';
    draft.validationTargets = ['*'];
    return;
  }
  draft.invocationMode = 'validation';
  if (normalized === 'all_validations') {
    draft.validationTargets = ['*'];
    return;
  }
  draft.validationTargets = [normalized];
}

function getValidationAvailabilityLabel(tokenDef) {
  const paths = Array.isArray(tokenDef?.validationPaths) ? tokenDef.validationPaths : [];
  if (!paths.length) return '';
  if (paths.includes('*')) return 'Available for all validations';
  return `Available for: ${paths.join(', ')}`;
}

function formatValidationInvocation(targets) {
  const normalized = normalizeValidationTargets(targets);
  if (!normalized.length || normalized.includes('*')) return 'validation:*';
  if (normalized.length === 1) return `validation:${normalized[0]}`;
  return `validation:[${normalized.join(', ')}]`;
}

function formatCollectionInvocation(draft) {
  if (draft.collectionScope === 'selected') {
    const targets = Array.isArray(draft.collectionTargets) ? draft.collectionTargets.filter(Boolean) : [];
    if (!targets.length) return 'collection:selected';
    return `collection:[${targets.join(', ')}]`;
  }
  return 'collection:*';
}

function getDraftInvocationText(draft) {
  if (draft.invocationMode === 'validation') return formatValidationInvocation(draft.validationTargets);
  return 'generic';
}

function createGenericDraft({ collection, collectionKey } = {}) {
  const template = resolveManageCollectionsAiPromptTemplate({ collection: collection || buildFallbackCollection(collectionKey), collectionKey });
  const key = normalizeCollectionPath(collectionKey);
  return {
    id: 'generic-base',
    baseId: 'generic-base',
    isVariant: false,
    kind: 'generic',
    name: template?.title || 'Generic collection import prompt',
    invocationMode: 'generic',
    validationTargets: ['*'],
    collectionScope: key ? 'selected' : 'all',
    collectionTargets: key ? [key] : [],
    jsonCompression: 'no-pretty',
    sampleSelection: 'representative',
    context: String(template?.context || ''),
    instructionsText: Array.isArray(template?.instructions) ? template.instructions.join('\n') : '',
    templateText: '{context}\n\nMetadata:\n{metadata}\n\nExamples:\n{examples}\n\nInstructions:\n{instructions_bulleted}',
    note: 'Current implementation resolves a collection template and injects metadata/examples directly.',
    initial: null,
  };
}

function createValidationDraft() {
  return {
    id: 'validation-base',
    baseId: 'validation-base',
    isVariant: false,
    kind: 'validation',
    name: 'Validation-focused prompt',
    invocationMode: 'validation',
    validationTargets: ['missing_related_collection_data'],
    collectionScope: 'all',
    collectionTargets: [],
    jsonCompression: 'no-pretty',
    sampleSelection: 'representative',
    context: 'Context: I will paste the target collection metadata and examples, plus a batch of missing source references that still need records in the target collection. Produce new entries for the target collection only.',
    instructionsText: [
      'Produce new entries that follow the target schema exactly.',
      'Cover every missing source reference in this batch.',
      'If the schema includes the target reference field, populate it so the source reference is preserved.',
      'Match the style and level of detail shown in the target examples.',
      'Output only a JSON array of entries with no extra text.',
    ].join('\n'),
    templateText: '{context}\n\nTarget Metadata:\n{metadata}\n\nTarget Examples:\n{examples}\n\nRelation Summary:\n{relation_summary}\n\nMissing Source References:\n{missing_values}\n\nInstructions:\n{instructions_bulleted}',
    note: 'Only `missing_related_collection_data` has a live builder today. Other validation paths can still be drafted here.',
    initial: null,
  };
}

function snapshotDraft(draft) {
  return cloneJson({
    name: draft.name,
    invocationMode: draft.invocationMode,
    validationTargets: draft.validationTargets,
    collectionScope: draft.collectionScope,
    collectionTargets: draft.collectionTargets,
    jsonCompression: draft.jsonCompression,
    sampleSelection: draft.sampleSelection,
    context: draft.context,
    instructionsText: draft.instructionsText,
    templateText: draft.templateText,
  }, {});
}

function isDraftDirty(draft) {
  return safeStringify(snapshotDraft(draft)) !== safeStringify(draft.initial || {});
}

function buildInstructionsArray(text) {
  return String(text || '')
    .split('\n')
    .map((line) => String(line || '').trim())
    .filter(Boolean);
}

function makeRelationSummary(draft, context) {
  const preview = context.validationPreview || null;
  if (draft.invocationMode === 'validation' && preview) {
    return {
      sourceCollection: normalizeCollectionPath(preview.sourceCollectionKey || context.collectionKey || '') || '',
      targetCollection: normalizeCollectionPath(preview.targetCollectionKey || draft.collectionTargets?.[0] || context.collectionKey || '') || '',
      relationName: String(preview.relation?.name || ''),
      sourceKey: preview.relation?.thisKey ?? null,
      targetReferenceField: preview.relation?.foreignKey ?? null,
      requestedCount: Array.isArray(preview.missingValues) ? preview.missingValues.length : 0,
    };
  }
  const sourceCollectionKey = normalizeCollectionPath(context.collectionKey || draft.collectionTargets?.[0] || 'collections/source_collection') || 'source_collection';
  const targetCollectionKey = normalizeCollectionPath(draft.collectionTargets?.[0] || context.collectionOptions?.[0]?.value || context.collectionKey || 'collections/target_collection') || 'target_collection';
  return {
    sourceCollection: sourceCollectionKey,
    targetCollection: targetCollectionKey,
    relationName: 'relatedItems',
    sourceKey: 'id',
    targetReferenceField: 'sourceId',
    requestedCount: 3,
  };
}

function buildDraftPayload(draft, context) {
  const activeCollection = chooseCollectionForDraft(draft, context) || buildFallbackCollection(context.collectionKey);
  const activeCollectionKey = normalizeCollectionPath(
    (draft.invocationMode === 'validation' && context.validationPreview?.targetCollectionKey)
      || draft.collectionTargets?.[0]
      || context.collectionKey
      || ''
  ) || 'current_collection';
  const stringifier = makeStringifier(draft.jsonCompression);
  const basePayload = prepareManageCollectionsPromptPayload({
    collection: activeCollection,
    safeJsonStringify: stringifier,
  });
  const metadata = cloneJson(basePayload?.metadata, {});
  const examples = applySampleSelection(cloneJson(basePayload?.examples, []), draft.sampleSelection);
  const relationSummary = makeRelationSummary(draft, context);
  const missingValues = (draft.invocationMode === 'validation' && Array.isArray(context.validationPreview?.missingValues))
    ? cloneJson(context.validationPreview.missingValues, [])
    : [];
  const resolvedTemplate = resolveManageCollectionsAiPromptTemplate({
    collection: activeCollection,
    collectionKey: activeCollectionKey,
  });
  return {
    activeCollection,
    activeCollectionKey,
    resolvedTemplate,
    metadata,
    examples,
    relationSummary,
    missingValues,
  };
}

function getPreviewTokenValues(draft, payload) {
  const instructions = buildInstructionsArray(draft.instructionsText);
  return {
    '{context}': String(draft.context || ''),
    '{metadata}': cloneJson(payload.metadata, {}),
    '{examples}': cloneJson(payload.examples, []),
    '{instructions_bulleted}': instructions.map((line) => `- ${line}`).join('\n'),
    '{relation_summary}': cloneJson(payload.relationSummary, {}),
    '{missing_values}': cloneJson(payload.missingValues, []),
    '{collection}': String(payload?.activeCollectionKey || ''),
    '{template_id}': String(payload?.resolvedTemplate?.id || ''),
    '{validation_paths}': normalizeValidationTargets(draft.validationTargets).join(', ') || '*',
  };
}

function getTokenDefs(draft) {
  const selectedValidationTargets = normalizeValidationTargets(draft.validationTargets);
  return TOKEN_DEFS.filter((item) => {
    if (!item.validationOnly) return true;
    if (draft.invocationMode !== 'validation') return false;
    const paths = Array.isArray(item.validationPaths) ? item.validationPaths : [];
    if (!paths.length || paths.includes('*')) return true;
    if (!selectedValidationTargets.length || selectedValidationTargets.includes('*')) return true;
    return paths.some((path) => selectedValidationTargets.includes(path));
  });
}

function toPreviewTokenLabel(token) {
  return `{{${String(token || '').replace(/^\{|\}$/g, '')}}}`;
}

function buildEditorPreviewContent({ draft, payload, previewTokenState = {}, onStateChange = null } = {}) {
  const tokenValues = getPreviewTokenValues(draft, payload);
  const stringify = makeStringifier(draft.jsonCompression);
  const root = el('div', { className: 'ai-prompts-editor-preview-inline' });
  const template = String(draft.templateText || '');
  const parts = template.split(/(\{[a-z_]+\})/g).filter((part) => part !== '');
  const tokenDefByToken = new Map(getTokenDefs(draft).map((item) => [item.token, item]));
  const rerender = () => {
    const next = buildEditorPreviewContent({ draft, payload, previewTokenState, onStateChange });
    root.replaceWith(next);
    if (typeof onStateChange === 'function') onStateChange();
  };

  parts.forEach((part) => {
    if (Object.prototype.hasOwnProperty.call(tokenValues, part)) {
      const tokenDef = tokenDefByToken.get(part) || { title: toPreviewTokenLabel(part) };
      const value = tokenValues[part];
      const expanded = !!previewTokenState[part];
      if (!expanded) {
        const line = el('div', { className: 'ai-prompts-editor-preview-token-line' });
        const name = el('span', { className: 'ai-prompts-editor-preview-token-name', text: toPreviewTokenLabel(part) });
        name.title = `${tokenDef.title || toPreviewTokenLabel(part)}. Click to expand.`;
        name.addEventListener('click', () => {
          previewTokenState[part] = true;
          rerender();
        });
        line.append(name);
        root.appendChild(line);
        return;
      }

      const bodyWrap = el('div', { className: 'ai-prompts-editor-preview-token-body-wrap' });
      const body = el('div', { className: 'ai-prompts-editor-preview-token-body' });
      bodyWrap.title = `${toPreviewTokenLabel(part)}. Click to collapse.`;
      bodyWrap.addEventListener('click', (event) => {
        if (event.target.closest('button')) return;
        previewTokenState[part] = false;
        rerender();
      });
      body.appendChild(el('div', {
        className: 'ai-prompts-editor-preview-line',
        text: value && typeof value === 'object' ? stringify(value) : String(value ?? ''),
      }));
      bodyWrap.appendChild(body);
      root.appendChild(bodyWrap);
      return;
    }

    root.appendChild(el('div', {
      className: 'ai-prompts-editor-preview-line',
      text: part,
    }));
  });

  return root;
}

function getTokenOptions(draft) {
  return getTokenDefs(draft).map((item) => item.token);
}

function insertTokenIntoTextarea(textarea, token, onChange) {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  const value = textarea.value || '';
  const next = value.slice(0, start) + token + value.slice(end);
  textarea.value = next;
  const cursor = start + token.length;
  try { textarea.setSelectionRange(cursor, cursor); } catch (e) {}
  onChange(next);
  try { textarea.focus(); } catch (e) {}
}

export function openAiPromptsEditorDialog({
  collection = null,
  collectionKey = '',
  collections = null,
  collectionsByPath = null,
  validationPreview = null,
} = {}) {
  try { document.dispatchEvent(new CustomEvent('ui:closeOverlays')); } catch (e) {}
  ensureStyles();

  const fallbackCollection = collection || buildFallbackCollection(collectionKey);
  const collectionOptions = getCollectionOptions({
    collectionsByPath,
    collections,
    collection: fallbackCollection,
    collectionKey,
  });

  const baseDrafts = [
    createGenericDraft({ collection: fallbackCollection, collectionKey }),
    createValidationDraft(),
  ].map((draft) => {
    const withInitial = { ...draft };
    withInitial.initial = snapshotDraft(withInitial);
    return withInitial;
  });

  const state = {
    selectedId: baseDrafts[0]?.id || '',
    drafts: baseDrafts,
    statusText: 'Edits are local to this dialog. Save is intentionally not wired yet.',
    previewTokenStates: {},
    selectedTokenByDraft: {},
  };

  const context = {
    collection: fallbackCollection,
    collectionKey: normalizeCollectionPath(collectionKey),
    collectionOptions,
    validationPreview: validationPreview && typeof validationPreview === 'object' ? validationPreview : null,
  };

  return new Promise((resolve) => {
    let done = false;
    let prevActive = null;

    const backdrop = el('div', { className: 'confirm-backdrop' });
    try { backdrop.style.zIndex = '99999'; } catch (e) {}

    const dialog = el('div', {
      className: 'ai-prompts-editor-dialog card',
      attrs: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'AI Prompts Editor',
      }
    });
    dialog.tabIndex = -1;

    const header = el('div', { className: 'ai-prompts-editor-header' });
    const headerMain = el('div', { className: 'ai-prompts-editor-header-main' });
    headerMain.append(
      el('div', { className: 'ai-prompts-editor-title', text: 'AI Prompts Editor' }),
      el('div', {
        className: 'ai-prompts-editor-subtitle',
        text: 'Inspect current prompt builders, create local draft variants, and preview payload-aware prompt output.',
      })
    );

    const headerActions = el('div', { className: 'ai-prompts-editor-header-actions' });
    const duplicateBtn = el('button', { className: 'btn small', text: 'Duplicate As Variant', attrs: { type: 'button' } });
    const saveBtn = el('button', { className: 'btn small primary', text: 'Save', attrs: { type: 'button' } });
    const closeBtn = el('button', { className: 'btn small', text: 'Close', attrs: { type: 'button' } });
    headerActions.append(duplicateBtn, saveBtn, closeBtn);
    header.append(headerMain, headerActions);

    const shell = el('div', { className: 'ai-prompts-editor-shell' });
    const sidebar = el('aside', { className: 'ai-prompts-editor-sidebar' });
    const sidebarHead = el('div', { className: 'ai-prompts-editor-sidebar-head' });
    const sidebarTitle = el('div', { className: 'ai-prompts-editor-section-title', text: 'Prompt Drafts' });
    const sidebarHelper = el('div', {
      className: 'ai-prompts-editor-helper',
      text: 'Base drafts reflect current code. Variants are local collection-specific experiments.',
    });
    const addVariantHint = el('div', {
      className: 'ai-prompts-editor-syntax',
      text: 'Use `validation:*` for all validations',
    });
    sidebarHead.append(sidebarTitle, sidebarHelper, addVariantHint);
    const sidebarList = el('div', { className: 'ai-prompts-editor-sidebar-list' });
    sidebar.append(sidebarHead, sidebarList);

    const main = el('div', { className: 'ai-prompts-editor-main' });
    const content = el('div');
    main.appendChild(content);
    shell.append(sidebar, main);

    const footer = el('div', { className: 'ai-prompts-editor-footer' });
    const statusEl = el('div', { className: 'ai-prompts-editor-helper', text: state.statusText });
    const footerMeta = el('div', {
      className: 'ai-prompts-editor-chip-row',
      children: [
        el('span', { className: 'ai-prompts-editor-pill', text: `Templates: ${manageCollectionsAiPromptTemplates.length}` }),
        el('span', { className: 'ai-prompts-editor-pill', text: `Validations: ${VALIDATION_OPTIONS.length}` }),
      ],
    });
    footer.append(statusEl, footerMeta);

    dialog.append(header, shell, footer);

    function getDraftById(id) {
      return state.drafts.find((draft) => draft.id === id) || null;
    }

    function getSelectedDraft() {
      return getDraftById(state.selectedId) || state.drafts[0] || null;
    }

    function setStatus(text) {
      state.statusText = String(text || '');
      statusEl.textContent = state.statusText;
    }

    function updateSidebar() {
      sidebarList.replaceChildren();
      if (!state.drafts.length) {
        sidebarList.appendChild(el('div', { className: 'ai-prompts-editor-empty', text: 'No prompt drafts available.' }));
        return;
      }
      state.drafts.forEach((draft) => {
        const isActive = draft.id === state.selectedId;
        const itemBtn = el('button', {
          className: `ai-prompts-editor-item ${isActive ? 'active' : ''}`.trim(),
          attrs: { type: 'button' },
        });
        const titleRow = el('div', { className: 'ai-prompts-editor-item-title-row' });
        const titleLeft = el('div', { className: 'ai-prompts-editor-item-title', text: draft.name || draft.id });
        const titleRight = el('div', {
          className: 'ai-prompts-editor-chip-row',
          children: [
            isDraftDirty(draft) ? el('span', { className: 'ai-prompts-editor-dirty-dot' }) : null,
            draft.isVariant ? el('span', { className: 'ai-prompts-editor-pill', text: 'variant' }) : null,
          ],
        });
        titleRow.append(titleLeft, titleRight);
        itemBtn.append(
          titleRow,
          el('div', { className: 'ai-prompts-editor-item-meta', text: getDraftInvocationText(draft) }),
          el('div', { className: 'ai-prompts-editor-micro', text: formatCollectionInvocation(draft) })
        );
        itemBtn.addEventListener('click', () => {
          state.selectedId = draft.id;
          updateSidebar();
          renderSelectedDraft();
        });
        sidebarList.appendChild(itemBtn);
      });
    }

    function removeDraft(id) {
      const idx = state.drafts.findIndex((draft) => draft.id === id);
      if (idx < 0) return;
      state.drafts.splice(idx, 1);
      if (!state.drafts.some((draft) => draft.id === state.selectedId)) {
        state.selectedId = state.drafts[0]?.id || '';
      }
      updateSidebar();
      renderSelectedDraft();
      setStatus('Removed local prompt variant.');
    }

    function duplicateSelectedDraft() {
      const draft = getSelectedDraft();
      if (!draft) return;
      const copy = cloneJson(draft, {});
      const stamp = `${Date.now()}`;
      copy.id = `${draft.baseId || draft.id}-variant-${stamp}`;
      copy.baseId = draft.baseId || draft.id;
      copy.isVariant = true;
      copy.name = `${draft.name} (custom)`;
      copy.collectionScope = context.collectionKey ? 'current' : (draft.collectionScope || 'selected');
      if (context.collectionKey) copy.collectionTargets = [context.collectionKey];
      copy.initial = snapshotDraft(copy);
      state.drafts.push(copy);
      state.selectedId = copy.id;
      updateSidebar();
      renderSelectedDraft();
      setStatus('Created a local variant draft. It is not persisted yet.');
    }

    function getPreviewTokenState(draft) {
      if (!draft?.id) return {};
      if (!state.previewTokenStates[draft.id]) {
        const defaults = {};
        getTokenOptions(draft).forEach((token) => {
          defaults[token] = false;
        });
        state.previewTokenStates[draft.id] = defaults;
      }
      return state.previewTokenStates[draft.id];
    }

    function getSelectedToken(draft) {
      const defs = getTokenDefs(draft);
      if (!defs.length) return null;
      const selected = state.selectedTokenByDraft[draft.id];
      if (selected && defs.some((item) => item.token === selected)) return selected;
      const fallback = defs[0].token;
      state.selectedTokenByDraft[draft.id] = fallback;
      return fallback;
    }

    function renderSelectedDraft() {
      const draft = getSelectedDraft();
      content.replaceChildren();
      if (!draft) {
        content.appendChild(el('div', { className: 'ai-prompts-editor-empty', text: 'Select a prompt draft.' }));
        return;
      }

      let payload = buildDraftPayload(draft, context);
      const resolvedTemplate = payload.resolvedTemplate;
      const previewTokenState = getPreviewTokenState(draft);
      let selectedToken = getSelectedToken(draft);
      const tokenDefByToken = new Map(getTokenDefs(draft).map((item) => [item.token, item]));

      const root = el('div', { className: 'ai-prompts-editor-grid' });

      const summary = el('section', { className: 'ai-prompts-editor-section' });
      summary.append(
        el('div', { className: 'ai-prompts-editor-section-title', text: 'Prompt Summary' }),
        el('div', {
          className: 'ai-prompts-editor-grid two',
          children: [
            (() => {
              const field = el('div', { className: 'ai-prompts-editor-field' });
              const label = el('label', { text: 'Prompt name' });
              const input = el('input', { attrs: { type: 'text', value: draft.name || '' } });
              input.addEventListener('input', () => {
                draft.name = input.value;
                updateSidebar();
                setStatus('Updated prompt name locally.');
              });
              field.append(label, input);
              return field;
            })(),
            (() => {
              const field = el('div', { className: 'ai-prompts-editor-field' });
              field.append(
                el('label', { text: 'Invocation' }),
                el('div', {
                  className: 'ai-prompts-editor-chip-row',
                  children: [
                    el('span', { className: 'ai-prompts-editor-pill', text: getDraftInvocationText(draft) }),
                    el('span', { className: 'ai-prompts-editor-pill', text: formatCollectionInvocation(draft) }),
                  ],
                }),
                el('div', {
                  className: 'ai-prompts-editor-helper',
                  text: draft.note || '',
                })
              );
              return field;
            })(),
          ],
        })
      );

      if (draft.invocationMode === 'generic') {
        summary.append(
          el('div', {
            className: 'ai-prompts-editor-chip-row',
            children: [
              el('span', { className: 'ai-prompts-editor-pill', text: `resolved template: ${resolvedTemplate?.id || 'generic'}` }),
              el('span', { className: 'ai-prompts-editor-pill', text: `available templates: ${manageCollectionsAiPromptTemplates.map((item) => item.id).join(', ')}` }),
            ],
          })
        );
      }

      const targeting = el('section', { className: 'ai-prompts-editor-section' });
      targeting.append(
        el('div', { className: 'ai-prompts-editor-section-title', text: 'Scope And Config' }),
        el('div', {
          className: 'ai-prompts-editor-grid two',
          children: [
            (() => {
              const field = el('div', { className: 'ai-prompts-editor-field' });
              const label = el('label', { text: 'Invocation scope' });
              const select = el('select');
              [
                { value: 'generic', label: 'generic' },
                { value: 'all_validations', label: 'all_validations' },
                ...VALIDATION_OPTIONS.map((option) => ({
                  value: option.path,
                  label: `validation:${option.path}`,
                })),
              ].forEach((option) => {
                const node = el('option', { text: option.label, attrs: { value: option.value } });
                if (getValidationModeValue(draft) === option.value) node.selected = true;
                select.appendChild(node);
              });
              select.addEventListener('change', () => {
                applyValidationModeValue(draft, select.value);
                renderSelectedDraft();
                updateSidebar();
                setStatus('Updated invocation scope.');
              });
              field.append(label, select);
              return field;
            })(),
            (() => {
              const field = el('div', { className: 'ai-prompts-editor-field' });
              const label = el('label', { text: 'Collection scope' });
              const select = el('select');
              [
                { value: 'all', label: 'All collections' },
                { value: 'selected', label: 'Selected collections' },
              ].forEach((option) => {
                const node = el('option', { text: option.label, attrs: { value: option.value } });
                if (draft.collectionScope === option.value) node.selected = true;
                select.appendChild(node);
              });
              select.addEventListener('change', () => {
                draft.collectionScope = select.value;
                renderSelectedDraft();
                updateSidebar();
                setStatus('Updated collection targeting.');
              });
              field.append(label, select);
              return field;
            })(),
            (() => {
              const field = el('div', { className: 'ai-prompts-editor-field' });
              const label = el('label', { text: 'JSON compression' });
              const select = el('select');
              JSON_COMPRESSION_OPTIONS.forEach((option) => {
                const node = el('option', { text: option.label, attrs: { value: option.value } });
                if (draft.jsonCompression === option.value) node.selected = true;
                select.appendChild(node);
              });
              select.addEventListener('change', () => {
                draft.jsonCompression = select.value;
                renderSelectedDraft();
                updateSidebar();
                setStatus('Updated JSON preview compression.');
              });
              field.append(label, select);
              return field;
            })(),
            (() => {
              const field = el('div', { className: 'ai-prompts-editor-field' });
              const label = el('label', { text: 'Sample helper' });
              const select = el('select');
              SAMPLE_SELECTION_OPTIONS.forEach((option) => {
                const node = el('option', { text: option.label, attrs: { value: option.value } });
                if (draft.sampleSelection === option.value) node.selected = true;
                select.appendChild(node);
              });
              select.addEventListener('change', () => {
                draft.sampleSelection = select.value;
                renderSelectedDraft();
                updateSidebar();
                setStatus('Updated example-selection helper.');
              });
              field.append(label, select);
              return field;
            })(),
            (() => {
              const field = el('div', { className: 'ai-prompts-editor-field' });
              const validationMode = getValidationModeValue(draft);
              const validationLabel = validationMode === 'generic'
                ? 'No validation-specific tokens enabled.'
                : (validationMode === 'all_validations'
                  ? 'Validation tokens shown for all validations.'
                  : `Validation tokens limited to ${validationMode}.`);
              field.append(
                el('label', { text: 'Payload notes' }),
                el('div', { className: 'ai-prompts-editor-helper', text: SAMPLE_SELECTION_OPTIONS.find((item) => item.value === draft.sampleSelection)?.description || '' }),
                el('div', { className: 'ai-prompts-editor-helper', text: JSON_COMPRESSION_OPTIONS.find((item) => item.value === draft.jsonCompression)?.label || '' }),
                el('div', { className: 'ai-prompts-editor-helper', text: validationLabel }),
              );
              return field;
            })(),
          ],
        })
      );

      if (draft.collectionScope === 'selected') {
        const collectionField = el('div', { className: 'ai-prompts-editor-field' });
        collectionField.appendChild(el('label', { text: 'Target collections' }));
        const select = el('select', { attrs: { multiple: 'multiple' } });
        context.collectionOptions.forEach((option) => {
          const node = el('option', {
            text: option.label,
            attrs: { value: option.value },
          });
          if ((draft.collectionTargets || []).includes(option.value)) node.selected = true;
          select.appendChild(node);
        });
        select.addEventListener('change', () => {
          draft.collectionTargets = Array.from(select.selectedOptions || []).map((option) => option.value);
          renderSelectedDraft();
          updateSidebar();
          setStatus('Updated selected collection targets.');
        });
        collectionField.append(select, el('div', {
          className: 'ai-prompts-editor-helper',
          text: 'These scopes are local-only for now. They do not write back to template files.',
        }));
        targeting.appendChild(collectionField);
      }

      let previewBodyEl = null;

      function refreshPreviewViews() {
        payload = buildDraftPayload(draft, context);
        selectedToken = getSelectedToken(draft);
        if (previewBodyEl) {
          previewBodyEl.replaceChildren(buildEditorPreviewContent({
            draft,
            payload,
            previewTokenState,
          }));
        }
        renderTokenInspector();
      }

      const editorSection = el('section', { className: 'ai-prompts-editor-section' });
      editorSection.append(
        el('div', { className: 'ai-prompts-editor-section-title', text: 'Prompt Body' }),
        el('div', { className: 'ai-prompts-editor-section-subtitle', text: 'Edit the human-readable prompt parts and assemble them with tokens. This is a local smart draft, not a persisted template source.' }),
      );

      let tokenInspectorBody = null;

      function renderTokenInspector() {
        if (!tokenInspectorBody) return;
        selectedToken = getSelectedToken(draft);
        const selectedDef = tokenDefByToken.get(selectedToken);
        const values = getPreviewTokenValues(draft, payload);
        tokenInspectorBody.replaceChildren();
        if (!selectedDef) {
          tokenInspectorBody.appendChild(el('div', { className: 'ai-prompts-editor-helper', text: 'Select a token to inspect.' }));
          return;
        }
        tokenInspectorBody.append(
          el('div', { className: 'ai-prompts-editor-section-subtitle', text: `${toPreviewTokenLabel(selectedToken)} • ${selectedDef.source || ''}` })
        );
        if (selectedToken === '{context}') {
          const area = el('textarea');
          area.value = draft.context || '';
          area.addEventListener('input', () => {
            draft.context = area.value;
            updateSidebar();
            setStatus('Edited context block locally.');
            refreshPreviewViews();
          });
          tokenInspectorBody.appendChild(area);
          return;
        }
        if (selectedToken === '{instructions_bulleted}') {
          const area = el('textarea');
          area.value = draft.instructionsText || '';
          area.addEventListener('input', () => {
            draft.instructionsText = area.value;
            updateSidebar();
            setStatus('Edited instruction lines locally.');
            refreshPreviewViews();
          });
          tokenInspectorBody.appendChild(area);
          return;
        }
        tokenInspectorBody.appendChild(createJsonViewer(values[selectedToken], {
          expanded: true,
          showMaximize: true,
          showToggle: true,
          showCopy: true,
          showWrap: true,
        }));
      }

      const templateField = el('div', { className: 'ai-prompts-editor-field' });
      templateField.appendChild(el('label', { text: 'Prompt template' }));
      const tokenGroups = el('div', { className: 'ai-prompts-editor-token-groups' });
      const templateTextarea = el('textarea');
      templateTextarea.style.minHeight = '180px';
      templateTextarea.value = draft.templateText || '';
      [
        { key: 'text', label: 'Text / Custom tokens' },
        { key: 'data', label: 'Variable / JSON / Formula tokens' },
        { key: 'validation', label: 'Validation tokens' },
      ].forEach((group) => {
        const defs = getTokenDefs(draft).filter((item) => item.group === group.key);
        if (!defs.length) return;
        const groupEl = el('div', { className: 'ai-prompts-editor-token-group' });
        groupEl.appendChild(el('div', { className: 'ai-prompts-editor-token-group-head', text: group.label }));
        defs.forEach((def) => {
          const row = el('div', { className: 'ai-prompts-editor-token-row' });
          const tokenBtn = el('button', {
            className: 'ai-prompts-editor-mini-btn',
            text: toPreviewTokenLabel(def.token),
            attrs: { type: 'button', title: `Inspect ${toPreviewTokenLabel(def.token)}` },
          });
          tokenBtn.addEventListener('click', () => {
            state.selectedTokenByDraft[draft.id] = def.token;
            if (Object.prototype.hasOwnProperty.call(previewTokenState, def.token)) {
              previewTokenState[def.token] = true;
            }
            refreshPreviewViews();
            setStatus(`Inspecting ${toPreviewTokenLabel(def.token)}.`);
          });

          row.append(
            tokenBtn,
            el('span', { className: 'ai-prompts-editor-token-source', text: def.source || '' }),
            def.group === 'validation'
              ? el('span', { className: 'ai-prompts-editor-token-source', text: getValidationAvailabilityLabel(def) })
              : null,
          );
          groupEl.appendChild(row);
        });
        tokenGroups.appendChild(groupEl);
      });
      templateTextarea.addEventListener('input', () => {
        draft.templateText = templateTextarea.value;
        updateSidebar();
        setStatus('Edited prompt template locally.');
        refreshPreviewViews();
      });
      templateField.append(tokenGroups, templateTextarea);
      editorSection.appendChild(templateField);

      const tokenInspectorSection = el('section', { className: 'ai-prompts-editor-section' });
      tokenInspectorSection.appendChild(el('div', { className: 'ai-prompts-editor-section-title', text: 'Token Inspector' }));
      tokenInspectorBody = el('div', { className: 'ai-prompts-editor-field' });
      renderTokenInspector();
      tokenInspectorSection.appendChild(tokenInspectorBody);

      const previewSection = el('section', { className: 'ai-prompts-editor-section' });
      previewSection.appendChild(el('div', { className: 'ai-prompts-editor-section-title', text: 'Editor Preview' }));
      const previewActions = el('div', { className: 'ai-prompts-editor-section-actions' });
      const resetBtn = el('button', { className: 'btn small', text: 'Reset Draft', attrs: { type: 'button' } });
      resetBtn.addEventListener('click', () => {
        const initial = cloneJson(draft.initial, {});
        Object.assign(draft, initial);
        draft.initial = cloneJson(initial, {});
        state.previewTokenStates[draft.id] = {};
        updateSidebar();
        renderSelectedDraft();
        setStatus('Reset draft to its base local snapshot.');
      });
      previewActions.append(resetBtn);
      if (draft.isVariant) {
        const removeBtn = el('button', { className: 'btn small danger', text: 'Remove Variant', attrs: { type: 'button' } });
        removeBtn.addEventListener('click', () => removeDraft(draft.id));
        previewActions.appendChild(removeBtn);
      }
      previewBodyEl = el('div');
      previewBodyEl.appendChild(buildEditorPreviewContent({
        draft,
        payload,
        previewTokenState,
      }));
      previewSection.append(previewActions, previewBodyEl);

      root.append(summary, targeting, editorSection, tokenInspectorSection, previewSection);
      content.appendChild(root);
    }

    async function onSaveAttempt() {
      await confirmDialog({
        title: 'Saving Not Supported',
        message: 'Prompt edits in this editor are local-only right now.',
        detail: 'You can inspect builders, copy resolved prompts, and experiment with collection-specific variants, but nothing is written back to /src/templates or /templates yet.',
        confirmText: 'OK',
        cancelText: 'Close',
      });
      setStatus('Save is not wired. Use Copy Resolved Prompt if you need the current draft output.');
    }

    function finish() {
      if (done) return;
      done = true;
      try {
        dialog.classList.remove('open');
        backdrop.classList.remove('show');
      } catch (e) {}
      const cleanup = () => {
        try { if (dialog.parentNode) dialog.parentNode.removeChild(dialog); } catch (e) {}
        try { if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop); } catch (e) {}
      };
      try { dialog.addEventListener('transitionend', cleanup); } catch (e) {}
      setTimeout(cleanup, 220);
      try { document.removeEventListener('keydown', onKeyDown); } catch (e) {}
      try { if (prevActive && prevActive.focus) prevActive.focus(); } catch (e) {}
      resolve({
        action: 'close',
        drafts: state.drafts.map((draft) => snapshotDraft(draft)),
      });
    }

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish();
        return;
      }
      if (event.key !== 'Tab') return;
      const sel = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';
      const focusables = Array.from(dialog.querySelectorAll(sel)).filter((node) => node.offsetParent !== null);
      if (!focusables.length) {
        event.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    duplicateBtn.addEventListener('click', duplicateSelectedDraft);
    saveBtn.addEventListener('click', onSaveAttempt);
    closeBtn.addEventListener('click', finish);
    backdrop.addEventListener('click', finish);

    prevActive = document.activeElement;
    const mount = document.getElementById('shell-root') || document.getElementById('app') || document.body;
    mount.append(backdrop, dialog);
    updateSidebar();
    renderSelectedDraft();

    requestAnimationFrame(() => {
      try {
        backdrop.classList.add('show');
        dialog.classList.add('open');
      } catch (e) {}
      try { dialog.focus(); } catch (e) {}
    });

    document.addEventListener('keydown', onKeyDown);
  });
}
