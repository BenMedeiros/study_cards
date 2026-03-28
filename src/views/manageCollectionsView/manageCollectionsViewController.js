import controllerUtils from '../../utils/common/controllerUtils.mjs';
import { normalizeTableSettings, createDefaultTableSettings, cloneTableSettings } from '../../utils/browser/tableSettings.js';

const VIEW = 'manageCollectionsView';
const DEFAULT_ACTION_ORDER = ['clear', 'copyJson', 'copyFullJson'];
const DEFAULT_AI_PROMPT_BATCH_TARGET = 20;

const DEFAULT_VIEW = {
  historyTable: createDefaultTableSettings(DEFAULT_ACTION_ORDER),
  aiPromptBatchTarget: DEFAULT_AI_PROMPT_BATCH_TARGET,
};

function normalizeAiPromptBatchTarget(value) {
  const num = Math.round(Number(value));
  if (!Number.isFinite(num) || num < 1) return DEFAULT_AI_PROMPT_BATCH_TARGET;
  return Math.min(500, num);
}

function validateTable(v) {
  if (v == null) return;
  if (typeof v !== 'object' || Array.isArray(v)) {
    throw new Error('historyTable must be an object');
  }
  normalizeTableSettings(v);
}

function create(collKey) {
  const base = controllerUtils.createViewController(
    collKey,
    VIEW,
    cloneTableSettings(DEFAULT_VIEW, DEFAULT_VIEW),
    {
      historyTable: validateTable,
      aiPromptBatchTarget: () => {},
    }
  );

  function get() {
    const state = base.get() || {};
    const historyTable = normalizeTableSettings(state.historyTable);
    const aiPromptBatchTarget = normalizeAiPromptBatchTarget(state.aiPromptBatchTarget);
    return { ...state, historyTable, aiPromptBatchTarget };
  }

  function getHistoryTableSettings() {
    const state = get();
    return normalizeTableSettings(state.historyTable);
  }

  async function setHistoryTableSettings(nextTable) {
    const normalized = normalizeTableSettings(nextTable);
    return base.set({ historyTable: normalized });
  }

  function getAiPromptBatchTarget() {
    const state = get();
    return normalizeAiPromptBatchTarget(state.aiPromptBatchTarget);
  }

  async function setAiPromptBatchTarget(nextValue) {
    return base.set({ aiPromptBatchTarget: normalizeAiPromptBatchTarget(nextValue) });
  }

  return {
    collKey: base.collKey,
    ready: base.ready,
    get,
    set: base.set,
    subscribe: base.subscribe,
    dispose: base.dispose,
    getHistoryTableSettings,
    setHistoryTableSettings,
    getAiPromptBatchTarget,
    setAiPromptBatchTarget,
  };
}

function getDefaultHistoryTableSettings() {
  return createDefaultTableSettings(DEFAULT_ACTION_ORDER);
}

function getDefaultAiPromptBatchTarget() {
  return DEFAULT_AI_PROMPT_BATCH_TARGET;
}

async function forCollection(collKey) {
  const c = create(collKey);
  await c.ready;
  return c;
}

export default {
  create,
  forCollection,
  getDefaultHistoryTableSettings,
  getDefaultAiPromptBatchTarget,
};
