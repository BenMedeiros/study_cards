import { createAppShell } from './shell.js';
import { installHashRouter, navigateTo } from './router.js';
import { createStore } from './store.js';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app');

const store = createStore();
const shell = createAppShell({ store, onNavigate: navigateTo });
root.append(shell.el);

installHashRouter({
  onRoute: (route) => shell.renderRoute(route),
});

// Default route
if (!location.hash) {
  navigateTo('/');
}

// Start background initialization (storage, collections, backend check)
store.initialize().then(() => {
  shell.renderHeader();
  shell.renderRoute(shell.getCurrentRoute());
});
