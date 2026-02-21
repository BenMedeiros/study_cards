// Central catalog + broker for settings persisted in localStorage key `study_cards:v1`
// (specifically `shell` and `apps` via the existing persistence layer).

function _now() {
  try { return Date.now(); } catch { return 0; }
}

function _safeString(v) {
  try {
    if (typeof v === 'string') return v;
    if (v == null) return String(v);
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function _typeOk(type, value) {
  const t = type || {};
  if (value == null) return !!t.nullable;

  if (t.kind === 'boolean') return typeof value === 'boolean';
  if (t.kind === 'string') return typeof value === 'string';
  if (t.kind === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (t.kind === 'enum') return typeof value === 'string' && Array.isArray(t.values) && t.values.includes(value);
  if (t.kind === 'json') return true;
  return false;
}

function _validateTypeRequired(def) {
  if (!def || typeof def !== 'object') throw new Error('Invalid setting definition');
  if (!def.type || typeof def.type !== 'object' || !def.type.kind) {
    throw new Error(`Setting ${def.id || '(unknown)'} missing required type`);
  }
}

function _normalizeDef(id, def) {
  const out = { ...def, id: String(id) };
  _validateTypeRequired(out);

  // Simplified model: persisted state uses the full setting id as the key.
  // Remove scope/appId complexity — callers only declare the id, type and default.
  out.key = out.key || out.id;
  // Clean up any legacy fields to avoid accidental use elsewhere.
  if ('scope' in out) delete out.scope;
  if ('appId' in out) delete out.appId;
  if (!('default' in out)) throw new Error(`Setting ${out.id} missing default`);
  return out;
}

// Hardcoded catalog: update here to add new persisted settings.
const CATALOG = Object.freeze((() => {
  const defs = {
    // shell.*
    'shell.activeCollectionId': { type: { kind: 'string', nullable: true }, default: null },
    'shell.activeCollectionPath': { type: { kind: 'string', nullable: true }, default: null },
    'shell.activeCollectionEntriesCount': { type: { kind: 'number' }, default: 0 },

    'shell.lastRoute': { type: { kind: 'string', nullable: true }, default: null },

    'shell.showFooterCaptions': { type: { kind: 'boolean' }, default: false },
    'shell.timingEnabled': { type: { kind: 'boolean' }, default: false },
    'shell.logEmits': { type: { kind: 'boolean' }, default: false },
    'shell.logSettings': { type: { kind: 'boolean' }, default: false },

    // Manager-specific log toggles for collectionDatabaseManager
    'managers.collectionDatabaseManager.log.enabled': { type: { kind: 'boolean' }, default: false },
    'managers.collectionDatabaseManager.log.cachedCollections': { type: { kind: 'boolean' }, default: false },

    // Whether table search inputs auto-normalize via cleanSearchQuery() (e.g. spaces -> '&').
    // Functional: whether table search inputs are auto-normalized via
    // `cleanSearchQuery()` (e.g. spaces -> '&'). Default: true.
    'utils.tableSearch.autoCleanQuery': { type: { kind: 'boolean' }, default: true },
    // Whether table search tokens without explicit wildcards should be
    // automatically wrapped as "%token%" by cleanSearchQuery(). Default: on.
    'utils.tableSearch.autoWildcard': { type: { kind: 'boolean' }, default: true },
    // Logging: whether `cleanSearchQuery()` emits debug logs (input/output).
    'utils.tableSearch.log.autoCleanQuery': { type: { kind: 'boolean' }, default: false },

    'shell.hideShellFooter': { type: { kind: 'boolean' }, default: false },
    'shell.hideViewHeaderTools': { type: { kind: 'boolean' }, default: false },
    'shell.hideViewFooterControls': { type: { kind: 'boolean' }, default: false },

    'shell.collectionContexts': { type: { kind: 'json' }, default: {} },
    'shell.voice': { type: { kind: 'json', nullable: true }, default: null },

    // apps.kanjiStudy.*
    'apps.kanjiStudy.defaultViewMode': { type: { kind: 'enum', values: ['kanji-only', 'full'] }, default: 'kanji-only' },
    'apps.kanjiStudy.isAutoSpeak': { type: { kind: 'boolean' }, default: false },
    'apps.kanjiStudy.autoplaySequence': { type: { kind: 'json' }, default: [] },

    // apps.viewFooter.*
    'apps.viewFooter.configs': { type: { kind: 'json' }, default: {} },

    // apps.entityExplorer.*
    'apps.entityExplorer.manager': { type: { kind: 'enum', values: ['idb', 'ls'] }, default: 'idb' },
    'apps.entityExplorer.db': { type: { kind: 'string', nullable: true }, default: null },
    'apps.entityExplorer.selection': { type: { kind: 'string', nullable: true }, default: null },
  };

  const out = {};
  for (const [id, def] of Object.entries(defs)) {
    out[id] = Object.freeze(_normalizeDef(id, def));
  }
  return out;
})());

export function createSettingsManager({ getShellState, setShellState, getAppState, setAppState } = {}) {
  if (typeof getShellState !== 'function' || typeof setShellState !== 'function') {
    throw new Error('SettingsManager requires getShellState/setShellState');
  }
  if (typeof getAppState !== 'function' || typeof setAppState !== 'function') {
    throw new Error('SettingsManager requires getAppState/setAppState');
  }

  let ready = false;

  // consumerId -> { onChange, settings:Set }
  const consumers = new Map();
  // settingId -> Set(consumerId)
  const settingConsumers = new Map();

  // settingId -> audit record
  const audit = new Map();

  function setReady(val) {
    const wasReady = !!ready;
    ready = !!val;

    // If transitioning to ready, notify all registered consumers of current values
    if (!wasReady && ready) {
      for (const [consumerId, c] of consumers.entries()) {
        try {
          const cb = c && typeof c.onChange === 'function' ? c.onChange : null;
          const settingsSet = c && c.settings ? Array.from(c.settings) : [];
          if (!cb || !settingsSet.length) continue;
          for (const sid of settingsSet) {
            try {
              const def = CATALOG[sid];
              if (!def) continue;
              const next = _resolveValue(def);
              try { cb({ settingId: def.id, prev: null, next, sourceConsumerId: 'settings.manager', timestamp: _now() }); } catch (e) {}
            } catch (e) { /* ignore per-setting errors */ }
          }
        } catch (e) { /* ignore consumer errors */ }
      }
    }
  }

  function isReady() {
    return !!ready;
  }

  function assertReady() {
    if (!ready) throw new Error('SettingsManager not ready (store not initialized)');
  }

  function assertKnown(settingId) {
    const id = String(settingId || '').trim();
    if (!id) throw new Error('Missing settingId');
    const def = CATALOG[id];
    if (!def) throw new Error(`Unknown settingId: ${id}`);
    return def;
  }

  function assertConsumerId(consumerId) {
    const id = String(consumerId || '').trim();
    if (!id) throw new Error('Missing consumerId');
    return id;
  }

  function _auditGetRecord(settingId) {
    const key = String(settingId);
    let rec = audit.get(key);
    if (!rec) {
      rec = { settingId: key, reads: 0, writes: 0, lastReadAt: null, lastWriteAt: null, lastReader: null, lastWriter: null };
      audit.set(key, rec);
    }
    return rec;
  }

  function _readRaw(def) {
    // Persisted exclusively in localStorage under `study_cards:settings`.
    const ls = (typeof localStorage !== 'undefined') ? localStorage : null;
    if (!ls) throw new Error('localStorage is not available for SettingsManager');

    const raw = ls.getItem('study_cards:settings');
    if (!raw) return undefined;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return undefined;
    return Object.prototype.hasOwnProperty.call(obj, def.id) ? obj[def.id] : undefined;
  }

  function _resolveValue(def) {
    const raw = _readRaw(def);
    if (raw === undefined) return def.default;
    if (_typeOk(def.type, raw)) return raw;
    return def.default;
  }

  function _isLogEnabled() {
    try {
      const def = CATALOG['shell.logSettings'];
      if (!def) return false;
      const raw = _readRaw(def);
      return typeof raw === 'boolean' ? raw : false;
    } catch {
      return false;
    }
  }

  function registerConsumer({ consumerId, settings = [], onChange = null } = {}) {
    const cid = assertConsumerId(consumerId);

    const ids = Array.isArray(settings) ? settings.map(s => String(s || '').trim()).filter(Boolean) : [];
    for (const settingId of ids) assertKnown(settingId);

    // remove previous registration if any
    if (consumers.has(cid)) {
      const prev = consumers.get(cid);
      if (prev && prev.settings) {
        for (const s of prev.settings) {
          const set = settingConsumers.get(s);
          if (set) {
            set.delete(cid);
            if (set.size === 0) settingConsumers.delete(s);
          }
        }
      }
    }

    const setIds = new Set(ids);
    consumers.set(cid, { onChange: (typeof onChange === 'function') ? onChange : null, settings: setIds });

    for (const s of setIds) {
      let set = settingConsumers.get(s);
      if (!set) { set = new Set(); settingConsumers.set(s, set); }
      set.add(cid);
    }

    // If manager is already ready, immediately notify this consumer of current values
    if (ready && typeof onChange === 'function' && setIds.size) {
      try {
        for (const sid of setIds) {
          try {
            const def = CATALOG[sid];
            if (!def) continue;
            const next = _resolveValue(def);
            try { onChange({ settingId: def.id, prev: null, next, sourceConsumerId: 'settings.manager', timestamp: _now() }); } catch (e) {}
          } catch (e) { /* ignore per-setting errors */ }
        }
      } catch (e) { /* ignore */ }
    }

    return () => {
      const cur = consumers.get(cid);
      consumers.delete(cid);
      if (cur && cur.settings) {
        for (const s of cur.settings) {
          const set = settingConsumers.get(s);
          if (set) {
            set.delete(cid);
            if (set.size === 0) settingConsumers.delete(s);
          }
        }
      }
    };
  }

  function get(settingId, { consumerId } = {}) {
    assertReady();
    const cid = assertConsumerId(consumerId);
    const def = assertKnown(settingId);

    const value = _resolveValue(def);

    const rec = _auditGetRecord(def.id);
    rec.reads += 1;
    rec.lastReadAt = _now();
    rec.lastReader = cid;

    if (_isLogEnabled()) {
      try {
        console.info(`[Settings] READ ${cid} ${def.id} = ${_safeString(value)}`);
      } catch {
        // ignore
      }
    }

    return value;
  }

  function set(settingId, nextValue, { consumerId, notifySelf = false, immediate = false, silent = false } = {}) {
    assertReady();
    const cid = assertConsumerId(consumerId);
    const def = assertKnown(settingId);

    if (!_typeOk(def.type, nextValue)) {
      throw new Error(`Invalid value for ${def.id} (type ${def.type.kind})`);
    }

    const prev = _resolveValue(def);
    const next = nextValue;

    if (Object.is(prev, next)) return next;

    // Persist exclusively to localStorage under `study_cards:settings`.
    const ls = (typeof localStorage !== 'undefined') ? localStorage : null;
    if (!ls) throw new Error('localStorage is not available for SettingsManager');

    const raw = ls.getItem('study_cards:settings');
    let obj = {};
    if (raw) {
      obj = JSON.parse(raw) || {};
      if (typeof obj !== 'object' || obj === null) obj = {};
    }
    obj[def.id] = next;
    ls.setItem('study_cards:settings', JSON.stringify(obj));

    const rec = _auditGetRecord(def.id);
    rec.writes += 1;
    rec.lastWriteAt = _now();
    rec.lastWriter = cid;

    if (_isLogEnabled()) {
      try {
        console.info(`[Settings] WRITE ${cid} ${def.id} : ${_safeString(prev)} -> ${_safeString(next)}`);
      } catch {
        // ignore
      }
    }

    // Notify other registered consumers via callbacks.
    const subs = settingConsumers.get(def.id);
    if (subs && subs.size) {
      for (const targetId of subs) {
        if (!notifySelf && targetId === cid) continue;
        const c = consumers.get(targetId);
        const cb = c && typeof c.onChange === 'function' ? c.onChange : null;
        if (!cb) continue;
        try {
          cb({ settingId: def.id, prev, next, sourceConsumerId: cid, timestamp: _now() });
        } catch (e) {
          try { console.warn('[Settings] consumer onChange error', targetId, e); } catch {}
        }
      }
    }

    return next;
  }

  function getCatalog() {
    return { ...CATALOG };
  }

  function getAudit() {
    const out = {};
    for (const [k, v] of audit.entries()) out[k] = { ...v };
    return out;
  }

  function getConsumersFor(settingId) {
    const def = assertKnown(settingId);
    const set = settingConsumers.get(def.id);
    return Array.from(set || []);
  }

  function getSettingsFor(consumerId) {
    const cid = assertConsumerId(consumerId);
    const c = consumers.get(cid);
    return Array.from((c && c.settings) ? c.settings : []);
  }

  return {
    setReady,
    isReady,
    registerConsumer,
    get,
    set,
    getCatalog,
    getAudit,
    getConsumersFor,
    getSettingsFor,
  };
}

// Optional global registry so other modules can obtain the active SettingsManager
let _globalSettingsManager = null;

export function setGlobalSettingsManager(mgr) {
  _globalSettingsManager = mgr;
}

export function getGlobalSettingsManager() {
  return _globalSettingsManager;
}
