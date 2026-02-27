import { openRightClickMenu, registerRightClickContext } from './rightClickMenu.js';
import { isTimingEnabled, setTimingEnabled } from '../utils/timing.js';
import * as idb from '../utils/idb.js';

export function createShellTitleContextMenu({
  store = null,
  settings = null,
  settingIds = [],
  updateShellLayoutVars = null,
  context = 'brand-context-menu',
} = {}) {
  const consumerId = 'shellTitleContextMenu';
  const ids = Array.isArray(settingIds) ? settingIds.map(s => String(s || '').trim()).filter(Boolean) : [];
  const values = new Map();
  let unsubscribe = null;
  let menuHandle = null;

  try { registerRightClickContext(context); } catch (e) {}

  function _canUseSettings() {
    try {
      return !!(settings && typeof settings.isReady === 'function' && settings.isReady() && typeof settings.get === 'function' && typeof settings.set === 'function');
    } catch {
      return false;
    }
  }

  function _read(settingId, fallback = undefined) {
    const id = String(settingId || '').trim();
    if (!id) return fallback;
    if (values.has(id)) return values.get(id);
    if (_canUseSettings()) {
      try {
        const v = settings.get(id, { consumerId });
        values.set(id, v);
        return v;
      } catch (e) {
        return fallback;
      }
    }
    return fallback;
  }

  function _write(settingId, next, { immediate = true } = {}) {
    const id = String(settingId || '').trim();
    if (!id) return;
    if (_canUseSettings()) {
      settings.set(id, next, { consumerId, immediate: !!immediate });
      values.set(id, next);
    }
  }

  function _syncAll() {
    if (!_canUseSettings()) return;
    for (const id of ids) {
      try {
        const v = settings.get(id, { consumerId });
        values.set(id, v);
      } catch (e) {}
    }
  }

  function close() {
    try { if (menuHandle && typeof menuHandle.close === 'function') menuHandle.close(); } catch (e) {}
    menuHandle = null;
  }

  function openAt(x, y) {
    close();
    _syncAll();

    const items = [];

    items.push({
      label: 'Log Persisted Data (IDB)',
      onClick: () => {
        try {
          console.group('Persisted Data (IndexedDB)');
          idb.idbDumpAll().then((dump) => {
            const kvRecs = dump?.kv || [];
            const collRecs = dump?.collections || [];
            console.log('idb.kv (all records):');
            for (const r of Array.isArray(kvRecs) ? kvRecs : []) {
              const key = r?.key ?? '(no key)';
              const val = r?.value ?? r;
              console.log(key, val);
            }
            console.log('idb.collections (array):', collRecs);
            console.groupEnd();
          }).catch((err) => { console.error('IDB read error', err); console.groupEnd(); });
        } catch (err) {
          console.error('Log Persisted Data failed', err);
        }
      }
    });

    try {
      const enabled = isTimingEnabled();
      items.push({
        label: `${enabled ? '☑' : '☐'} Timing Logs`,
        onClick: () => {
          const next = setTimingEnabled(!isTimingEnabled());
          try { console.info(`[Timing] ${next ? 'enabled' : 'disabled'}`); } catch (e) {}
        }
      });
    } catch (e) {}

    // Emit logging toggle
    try {
      const emitsEnabled = !!_read('shell.logEmits', false);
      items.push({
        label: `${emitsEnabled ? '☑' : '☐'} Log Emits`,
        onClick: () => {
          try {
            const cur = !!_read('shell.logEmits', false);
            const next = !cur;
            try { window.__LOG_EMITS__ = !!next; } catch (e) {}
            _write('shell.logEmits', !!next, { immediate: true });
            try { console.info(`[Emitter] emits logging ${next ? 'enabled' : 'disabled'}`); } catch (e) {}
          } catch (e) {}
        }
      });
    } catch (e) {}

    // SettingsManager read/write logging toggle
    try {
      const settingsLogsEnabled = !!_read('shell.logSettings', false);
      items.push({
        label: `${settingsLogsEnabled ? '☑' : '☐'} Log Settings`,
        onClick: () => {
          try {
            const cur = !!_read('shell.logSettings', false);
            const next = !cur;
            _write('shell.logSettings', !!next, { immediate: true });
          } catch (e) {}
        }
      });
    } catch (e) {}

    // CollectionDB manager logging toggles
    try {
      const collDbLogsEnabled = !!_read('managers.collectionDatabaseManager.log.enabled', false);
      items.push({
        label: `${collDbLogsEnabled ? '☑' : '☐'} CollectionDB Logs`,
        onClick: () => {
          try {
            const cur = !!_read('managers.collectionDatabaseManager.log.enabled', false);
            const next = !cur;
            _write('managers.collectionDatabaseManager.log.enabled', !!next, { immediate: true });
          } catch (e) {}
        }
      });
    } catch (e) {}

    try {
      const cachedColls = !!_read('managers.collectionDatabaseManager.log.cachedCollections', false);
      items.push({
        label: `${cachedColls ? '☑' : '☐'} Log Cached Collections`,
        onClick: () => {
          try {
            const cur = !!_read('managers.collectionDatabaseManager.log.cachedCollections', false);
            const next = !cur;
            _write('managers.collectionDatabaseManager.log.cachedCollections', !!next, { immediate: true });
          } catch (e) {}
        }
      });
    } catch (e) {}

    // Controller logging toggle (managers.controllerLogging)
    try {
      const controllersLogs = !!_read('managers.controllerLogging', false);
      items.push({
        label: `${controllersLogs ? '☑' : '☐'} Controller Logs`,
        onClick: () => {
          try {
            const cur = !!_read('managers.controllerLogging', false);
            const next = !cur;
            _write('managers.controllerLogging', !!next, { immediate: true });
            try { console.info(`[Controllers] logging ${next ? 'enabled' : 'disabled'}`); } catch (e) {}
          } catch (e) {}
        }
      });
    } catch (e) {}

    // Table search auto-clean toggle
    try {
      const autoClean = !!_read('utils.tableSearch.log.autoCleanQuery', true);
      items.push({
        label: `${autoClean ? '☑' : '☐'} Auto-clean Table Search`,
        onClick: () => {
          try {
            const cur = !!_read('utils.tableSearch.log.autoCleanQuery', true);
            const next = !cur;
            _write('utils.tableSearch.log.autoCleanQuery', !!next, { immediate: true });
          } catch (e) {}
        }
      });
    } catch (e) {}

    // Table search auto-wildcard toggle
    try {
      const autoWildcard = !!_read('utils.tableSearch.autoWildcard', true);
      items.push({
        label: `${autoWildcard ? '☑' : '☐'} Table Search Auto-Wildcard`,
        onClick: () => {
          try {
            const cur = !!_read('utils.tableSearch.autoWildcard', true);
            const next = !cur;
            _write('utils.tableSearch.autoWildcard', !!next, { immediate: true });
          } catch (e) {}
        }
      });
    } catch (e) {}

    // Caption visibility toggle (persisted)
    try {
      const cur = !!_read('shell.showFooterCaptions', false);
      items.push({
        label: `${cur ? '☑' : '☐'} Show Footer Captions`,
        onClick: () => {
          const next = !cur;
          try {
            if (next) document.body.classList.add('using-keyboard');
            else document.body.classList.remove('using-keyboard');
          } catch (e) {}
          try { _write('shell.showFooterCaptions', !!next, { immediate: true }); } catch (e) {}
        }
      });
    } catch (e) {}

    // Visibility toggles for debugging/compact layouts (persist when possible)
    try {
      const hideShellFooter = !!_read('shell.hideShellFooter', false);
      items.push({
        label: `${hideShellFooter ? '☑' : '☐'} Hide Shell Footer`,
        onClick: () => {
          const next = !hideShellFooter;
          try { document.body.classList.toggle('hide-shell-footer', next); } catch (e) {}
          try { _write('shell.hideShellFooter', !!next, { immediate: true }); } catch (e) {}
        }
      });
    } catch (e) {}

    try {
      const hideViewHeader = !!_read('shell.hideViewHeaderTools', false);
      items.push({
        label: `${hideViewHeader ? '☑' : '☐'} Hide View Header Tools`,
        onClick: () => {
          const next = !hideViewHeader;
          try { document.body.classList.toggle('hide-view-header-tools', next); } catch (e) {}
          try { _write('shell.hideViewHeaderTools', !!next, { immediate: true }); } catch (e) {}
        }
      });
    } catch (e) {}

    try {
      const compactNav = !!_read('shell.compactNav', false);
      items.push({
        label: `${compactNav ? '☑' : '☐'} Compact Nav (use dropdown)`,
        onClick: () => {
          try {
            const cur = !!_read('shell.compactNav', false);
            const next = !cur;
            _write('shell.compactNav', !!next, { immediate: true });
          } catch (e) {}
        }
      });
    } catch (e) {}

    try {
      const hideViewFooter = !!_read('shell.hideViewFooterControls', false);
      items.push({
        label: `${hideViewFooter ? '☑' : '☐'} Hide View Footer Controls`,
        onClick: () => {
          const next = !hideViewFooter;
          try { document.body.classList.toggle('hide-view-footer-controls', next); } catch (e) {}
          try { _write('shell.hideViewFooterControls', !!next, { immediate: true }); } catch (e) {}
          try { if (typeof updateShellLayoutVars === 'function') updateShellLayoutVars(); } catch (e) {}
        }
      });
    } catch (e) {}

    try {
      menuHandle = openRightClickMenu({ x, y, items, context });
    } catch (e) {
      menuHandle = null;
    }
  }

  function attach() {
    if (!_canUseSettings()) return;
    try {
      unsubscribe = settings.registerConsumer({
        consumerId,
        settings: ids,
        onChange: ({ settingId, next } = {}) => {
          try {
            const id = String(settingId || '').trim();
            if (!id) return;
            values.set(id, next);
          } catch (e) {}
        },
      });
    } catch (e) {
      unsubscribe = null;
    }
    _syncAll();
  }

  function dispose() {
    close();
    try { if (typeof unsubscribe === 'function') unsubscribe(); } catch (e) {}
    unsubscribe = null;
    values.clear();
  }

  // Auto-attach if possible.
  try { attach(); } catch (e) {}

  return {
    openAt,
    close,
    dispose,
    attach,
  };
}
