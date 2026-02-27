import controllerFactory from './controller.js';

const VIEW = 'flashcardsView';

function create(collKey) {
  const base = controllerFactory.createViewController(collKey, VIEW, {});
  return {
    collKey: base.collKey,
    ready: base.ready,
    get: base.get,
    set: base.set,
    setCurrentIndex: (i) => base.set({ currentIndex: i }),
    subscribe: base.subscribe,
    dispose: base.dispose,
  };
}

async function forCollection(collKey) { const c = create(collKey); await c.ready; return c; }

export default { create, forCollection };
