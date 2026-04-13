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
  if (/\.prompt\.json$/i.test(normalized) || /\.prompt\.md$/i.test(normalized)) return normalized;
  if (/\.json$/i.test(normalized)) return normalized.replace(/\.json$/i, '.prompt.json');
  return `${normalized}.prompt.json`;
}

export function getCollectionPromptDocumentCandidatePaths(collectionKey) {
  const normalized = normalizeCollectionPromptKey(collectionKey);
  if (!normalized) return [];
  const primary = getCollectionPromptDocumentPath(normalized);
  const candidates = [primary];
  if (/\.prompt\.json$/i.test(primary)) candidates.push(primary.replace(/\.prompt\.json$/i, '.prompt.md'));
  if (/\.prompt\.md$/i.test(primary)) candidates.push(primary.replace(/\.prompt\.md$/i, '.prompt.json'));
  return Array.from(new Set(candidates.filter(Boolean)));
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

function formatBulletSection(title, items) {
  const lines = Array.isArray(items)
    ? items.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  if (!lines.length) return '';
  return `${title}:\n${lines.map((line) => `- ${line}`).join('\n')}`;
}

function formatPromptFieldRules(fieldRules) {
  const rules = Array.isArray(fieldRules)
    ? fieldRules
      .filter((rule) => rule && typeof rule === 'object')
      .map((rule) => {
        const field = String(rule.field || '').trim();
        const type = String(rule.type || '').trim();
        const description = String(rule.description || '').trim();
        if (!field) return '';
        const parts = [`- ${field}${type ? `: ${type}` : ''}`];
        if (description) parts.push(`  ${description}`);
        return parts.join('\n');
      })
      .filter(Boolean)
    : [];
  if (!rules.length) return '';
  return `Field Rules:\n${rules.join('\n')}`;
}

function buildPromptTextFromJsonSpec(spec) {
  if (!spec || typeof spec !== 'object') return '';
  const shared = spec.shared && typeof spec.shared === 'object' ? spec.shared : {};
  const defaults = spec.defaults && typeof spec.defaults === 'object' ? spec.defaults : {};
  const stepId = String(defaults.stepId || '').trim();
  const steps = Array.isArray(spec.steps) ? spec.steps : [];
  const activeStep = steps.find((step) => String(step?.id || '').trim() === stepId) || null;
  const parts = [];

  const contextSection = formatBulletSection('Context', shared.context);
  if (contextSection) parts.push(contextSection);

  const outputSection = formatBulletSection('Output Requirements', shared.outputRequirements);
  if (outputSection) parts.push(outputSection);

  const rulesSection = formatBulletSection('Shared Rules', shared.rules);
  if (rulesSection) parts.push(rulesSection);

  if (activeStep) {
    const stepTitle = String(activeStep.title || activeStep.id || '').trim();
    const goal = String(activeStep.goal || '').trim();
    const stepHeader = [stepTitle ? `Step: ${stepTitle}` : '', goal ? `Goal:\n${goal}` : '']
      .filter(Boolean)
      .join('\n\n');
    if (stepHeader) parts.push(stepHeader);

    const inputSection = formatBulletSection('Input Contract', activeStep.inputContract);
    if (inputSection) parts.push(inputSection);

    const preserveSection = formatBulletSection('Preserve Existing Data', activeStep.preserveRules);
    if (preserveSection) parts.push(preserveSection);

    const fieldRulesSection = formatPromptFieldRules(activeStep.fieldRules);
    if (fieldRulesSection) parts.push(fieldRulesSection);

    const stepInstructions = formatBulletSection('Instructions', activeStep.instructions);
    if (stepInstructions) parts.push(stepInstructions);
  }

  return joinPromptSections(parts);
}

export async function loadCollectionPromptDocument(collectionKey, { force = false } = {}) {
  const normalizedKey = normalizeCollectionPromptKey(collectionKey);
  const candidatePaths = getCollectionPromptDocumentCandidatePaths(normalizedKey);
  const primaryPath = candidatePaths[0] || '';
  if (!normalizedKey || !primaryPath) return null;

  if (!force && PROMPT_DOCUMENT_CACHE.has(primaryPath)) {
    return PROMPT_DOCUMENT_CACHE.get(primaryPath);
  }

  const pending = Promise.resolve().then(async () => {
    for (const promptPath of candidatePaths) {
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

      if (!response.ok) continue;

      const text = await response.text();
      if (/\.prompt\.json$/i.test(promptPath)) {
        let spec = null;
        try {
          spec = JSON.parse(text);
        } catch (error) {
          return {
            collectionKey: normalizedKey,
            path: promptPath,
            url,
            exists: false,
            status: response.status,
            error: error?.message || String(error),
            frontmatter: {},
            rawText: text,
            bodyText: '',
          };
        }
        return {
          collectionKey: normalizedKey,
          path: promptPath,
          url,
          exists: true,
          status: response.status,
          error: null,
          frontmatter: {},
          rawText: text,
          bodyText: buildPromptTextFromJsonSpec(spec),
          spec,
        };
      }

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
    }

    return {
      collectionKey: normalizedKey,
      path: primaryPath,
      url: `./collections/${primaryPath}`,
      exists: false,
      status: 404,
      error: null,
      frontmatter: {},
      rawText: '',
      bodyText: '',
    };
  });

  PROMPT_DOCUMENT_CACHE.set(primaryPath, pending);
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
