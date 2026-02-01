import { createAppShell } from './shell.js';
import { installHashRouter, navigateTo } from './router.js';
import { createStore } from './store.js';
import { setVoiceSettingsGetter } from './utils/speech.js';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app');

const store = createStore();
setVoiceSettingsGetter(() => {
  return (store && typeof store.getShellVoiceSettings === 'function')
    ? (store.getShellVoiceSettings() || null)
    : null;
});
const shell = createAppShell({ store, onNavigate: navigateTo });
root.append(shell.el);

// Initialize store FIRST, then set up router
store.initialize().then(() => {
  // Now that persisted UI state is loaded, decide initial route.
  // If URL already has a hash, that wins. Otherwise restore last visited route.
  if (!location.hash) {
    const last = (store && typeof store.getLastRoute === 'function') ? store.getLastRoute() : null;
    navigateTo(last || '/');
  }

  // Now that collections are loaded, sync from URL and set up router
  const initialRoute = shell.getCurrentRoute();
  store.syncCollectionFromURL(initialRoute);
  
  installHashRouter({
    onRoute: (route) => {
      if (store && typeof store.setLastRoute === 'function') {
        store.setLastRoute(route);
      }
      store.syncCollectionFromURL(route);
      shell.renderRoute(route);
    },
  });
  
  shell.renderHeader();
  shell.renderRoute(initialRoute);
});
