const PROMPT_DOCUMENT_CACHE = new Map();

export const DEFAULT_PROMPT_REQUEST_TEXT = '<fill in the prompt request here>';

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeCollectionPromptKey(value) {
  return String(value || '').trim().replace(/\\/g, '/').replace(/^collections\//i, '');
}

export function getCollectionPromptDocumentPath(collectionKey) {
  const normalized = normalizeCollectionPromptKey(collectionKey);
  if (!normalized) return '';
  if (/\.json$/i.test(normalized)) return normalized.replace(/\.json$/i, '.prompt.md');
  if (/\.prompt\.md$/i.test(normalized)) return normalized;
  return `${normalized}.prompt.md`;
}

function parseFrontmatterValue(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

function parsePromptDocumentText(text) {
  const rawText = String(text || '');
  const normalized = rawText.replace(/^\uFEFF/, '');
  const frontmatter = {};
  let bodyText = normalized;

  if (normalized.startsWith('---')) {
    const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (match) {
      const frontmatterText = String(match[1] || '');
      frontmatterText.split(/\r?\n/g).forEach((line) => {
        const parsed = String(line || '').match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (!parsed) return;
        frontmatter[parsed[1]] = parseFrontmatterValue(parsed[2]);
      });
      bodyText = normalized.slice(match[0].length);
    }
  }

  return {
    frontmatter,
    bodyText: bodyText.trim(),
    rawText: normalized,
  };
}

export async function loadCollectionPromptDocument(collectionKey, { force = false } = {}) {
  const normalizedKey = normalizeCollectionPromptKey(collectionKey);
  const promptPath = getCollectionPromptDocumentPath(normalizedKey);
  if (!normalizedKey || !promptPath) return null;

  if (!force && PROMPT_DOCUMENT_CACHE.has(promptPath)) {
    return PROMPT_DOCUMENT_CACHE.get(promptPath);
  }

  const pending = Promise.resolve().then(async () => {
    const url = `./collections/${promptPath}`;
    let response;
    try {
      response = await fetch(url);
    } catch (error) {
      return {
        collectionKey: normalizedKey,
        path: promptPath,
        url,
        exists: false,
        status: null,
        error: error?.message || String(error),
        frontmatter: {},
        rawText: '',
        bodyText: '',
      };
    }

    if (!response.ok) {
      return {
        collectionKey: normalizedKey,
        path: promptPath,
        url,
        exists: false,
        status: response.status,
        error: null,
        frontmatter: {},
        rawText: '',
        bodyText: '',
      };
    }

    const text = await response.text();
    const parsed = parsePromptDocumentText(text);
    return {
      collectionKey: normalizedKey,
      path: promptPath,
      url,
      exists: true,
      status: response.status,
      error: null,
      frontmatter: parsed.frontmatter,
      rawText: parsed.rawText,
      bodyText: parsed.bodyText,
    };
  });

  PROMPT_DOCUMENT_CACHE.set(promptPath, pending);
  return pending;
}

function normalizePromptSection(section) {
  if (!section || typeof section !== 'object') return null;
  const title = String(section.title || '').trim();
  const content = String(section.content || '').trim();
  if (!title || !content) return null;
  return { title, content };
}

function joinPromptSections(parts) {
  return parts
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join('\n\n');
}

function replacePromptRequestSection(bodyText, promptRequestText) {
  const text = String(bodyText || '');
  const replacement = `Prompt Request:\n${String(promptRequestText || '').trim()}`;
  const pattern = /\bPrompt Request:\s*[\s\S]*$/;
  if (!pattern.test(text)) return text;
  return text.replace(pattern, replacement);
}

export function buildCollectionPromptText({
  promptDocument,
  promptRequestText = DEFAULT_PROMPT_REQUEST_TEXT,
  includePromptRequest = true,
  extraSections = [],
  replacePromptRequestSectionText = false,
} = {}) {
  const parts = [];
  const rawBodyText = String(promptDocument?.bodyText || '');
  const requestText = String(promptRequestText || DEFAULT_PROMPT_REQUEST_TEXT).trim() || DEFAULT_PROMPT_REQUEST_TEXT;
  const promptRequestPlaceholderPattern = new RegExp(escapeRegExp(DEFAULT_PROMPT_REQUEST_TEXT), 'g');
  const bodyIncludesPlaceholder = promptRequestPlaceholderPattern.test(rawBodyText);
  const bodyIncludesPromptRequestSection = /\bPrompt Request:\s*/.test(rawBodyText);
  let bodyText = rawBodyText;

  if (replacePromptRequestSectionText && includePromptRequest && bodyIncludesPromptRequestSection) {
    bodyText = replacePromptRequestSection(rawBodyText, requestText);
  } else if (bodyIncludesPlaceholder && includePromptRequest) {
    bodyText = rawBodyText.replace(promptRequestPlaceholderPattern, requestText);
  }

  if (String(bodyText || '').trim()) parts.push(String(bodyText || '').trim());

  if (includePromptRequest && !bodyIncludesPlaceholder && !bodyIncludesPromptRequestSection) {
    parts.push(`Prompt Request:\n${requestText}`);
  }

  extraSections
    .map(normalizePromptSection)
    .filter(Boolean)
    .forEach((section) => {
      parts.push(`${section.title}:\n${section.content}`);
    });

  return joinPromptSections(parts);
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

export function buildMissingRelationPromptText({
  promptDocument,
  sourceCollectionKey,
  targetCollectionKey,
  relation,
  missingValues,
  safeJsonStringify,
} = {}) {
  const stringify = typeof safeJsonStringify === 'function'
    ? safeJsonStringify
    : ((value, space = 2) => JSON.stringify(value, null, space));
  void sourceCollectionKey;
  void targetCollectionKey;
  void relation;

  const promptRequestText = `Create entries for the following words: ${stringify(Array.isArray(missingValues) ? missingValues : [], 0)}`;

  return buildCollectionPromptText({
    promptDocument,
    promptRequestText,
    includePromptRequest: true,
    replacePromptRequestSectionText: true,
  });
}