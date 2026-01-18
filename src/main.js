import { createAppShell } from './shell.js';
import { installHashRouter, navigateTo } from './router.js';
import { createStore } from './store.js';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app');

const store = createStore();
const shell = createAppShell({ store, onNavigate: navigateTo });
root.append(shell.el);

// Default route
if (!location.hash) {
  navigateTo('/');
}

// Initialize store FIRST, then set up router
store.initialize().then(() => {
  // Now that collections are loaded, sync from URL and set up router
  const initialRoute = shell.getCurrentRoute();
  store.syncCollectionFromURL(initialRoute);
  
  installHashRouter({
    onRoute: (route) => {
      store.syncCollectionFromURL(route);
      shell.renderRoute(route);
    },
  });
  
  shell.renderHeader();
  shell.renderRoute(initialRoute);
});
