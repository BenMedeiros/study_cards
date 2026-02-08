import { createAppShell } from './shell.js';
import { installHashRouter, navigateTo } from './router.js';
import { createStore } from './store.js';
import { setVoiceSettingsGetter } from './utils/speech.js';
import { isTimingEnabled, setTimingEnabled, timed } from './utils/timing.js';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app');

const store = createStore();
// Expose store for console debugging
window.__STORE__ = store;
// Expose timing controls for console debugging
window.__TIMING__ = {
  isEnabled: isTimingEnabled,
  setEnabled: setTimingEnabled,
};
setVoiceSettingsGetter(() => {
  return (store?.shell && typeof store.shell.getVoiceSettings === 'function')
    ? (store.shell.getVoiceSettings() || null)
    : null;
});
const shell = createAppShell({ store, onNavigate: navigateTo });
root.append(shell.el);

// Initialize store FIRST, then set up router
timed('store.initialize', () => store.initialize()).then(() => {
  // Now that persisted UI state is loaded, decide initial route.
  // If URL already has a hash, that wins. Otherwise restore last visited route.
  if (!location.hash) {
    const last = (store?.shell && typeof store.shell.getLastRoute === 'function') ? store.shell.getLastRoute() : null;
    navigateTo(last || '/');
  }

  // Now that collections are loaded, sync from URL and set up router
  const initialRoute = shell.getCurrentRoute();
  store.collections.syncCollectionFromURL(initialRoute);
  
  installHashRouter({
    onRoute: (route) => {
      if (store?.shell && typeof store.shell.setLastRoute === 'function') {
        store.shell.setLastRoute(route);
      }
      store.collections.syncCollectionFromURL(route);
      shell.renderRoute(route);
    },
  });
  
  shell.renderHeader();
  shell.renderRoute(initialRoute);
});
