import { parseHashRoute } from './utils/helpers.js';

const listeners = new Set();

export function getRouteFromHash() {
  return parseHashRoute(location.hash);
}

export function installHashRouter({ onRoute }) {
  const handler = () => {
    const route = getRouteFromHash();
    onRoute(route);
    for (const fn of listeners) fn(route);
  };

  window.addEventListener('hashchange', handler);
  handler();

  return () => window.removeEventListener('hashchange', handler);
}

export function navigateTo(path) {
  if (!path.startsWith('/')) path = `/${path}`;
  location.hash = path;
}

export function onRouteChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
