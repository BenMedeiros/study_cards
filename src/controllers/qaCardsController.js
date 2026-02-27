import controllerFactory from './controller.js';
import collectionSettingsController from './collectionSettingsController.js';

const VIEW = 'qaCardsView';

function _validateQuestionAnswerField(value, collection) {
  if (typeof value !== 'string') throw new Error('field must be a string');
  const fieldKeys = new Set((Array.isArray(collection?.metadata?.fields) ? collection.metadata.fields : []).map(f => f.key));
  if (value && !fieldKeys.has(value)) throw new Error('field not in collection schema: ' + value);
}

function create(collKey) {
  const validators = {
    questionField: (v, collection) => _validateQuestionAnswerField(v, collection),
    answerField: (v, collection) => _validateQuestionAnswerField(v, collection),
  };
  const base = controllerFactory.createViewController(collKey, VIEW, {}, validators);
  return {
    collKey: base.collKey,
    ready: base.ready,
    get: base.get,
    set: base.set,
    subscribe: base.subscribe,
    dispose: base.dispose,
  };
}

async function forCollection(collKey) { const c = create(collKey); await c.ready; return c; }

export default { create, forCollection };
