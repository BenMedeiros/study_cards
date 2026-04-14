import controllerUtils from '../../utils/common/controllerUtils.mjs';
import { CARD_REGISTRY } from './cards/index.js';

const VIEW = 'kanjiStudyCardView';
const AVAILABLE_CARD_KEYS = new Set((CARD_REGISTRY || []).map(c => c.key));

const DEFAULT_VIEW = {
  currentIndex: 0,
  // Keep this app's naming, but default behavior should be collection-agnostic.
  entryFields: 'all',
  relatedFields: {},
  displayCards: 'all',
  headerTools: {},
  cards: {},
  speech: {},
};

const SPEECH_LANGUAGE_DEFAULTS_BY_COLLECTION = {
  'japanese/japanese_words.json': {
    kanji: 'ja-JP',
    reading: 'ja-JP',
  },
  'japanese/japanese_sentences.json': {
    ja: 'ja-JP',
  },
  'japanese/japanese_paragraphs.json': {
    ja: 'ja-JP',
  },
  'japanese/japanese_grammar.json': {
    example_jp: 'ja-JP',
  },
  'greek/greek_mythology.json': {
    greekName: 'el-GR',
    greekPronunciation: 'el-GR',
    latinName: 'it-IT',
    latinPronunciation: 'it-IT',
    japaneseName: 'ja-JP',
  },
  'greek/greek_alphabet.json': {
    lowercase: 'el-GR',
    uppercase: 'el-GR',
    classical_greek_name: 'el-GR',
  },
  'spanish/spanish_words.json': {
    term: 'es-ES',
  },
  'spanish/spanish_sentences.json': {
    es: 'es-ES',
  },
  'persian/persian_alphabet.json': {
    char: 'fa-IR',
    isolated_form: 'fa-IR',
    initial_form: 'fa-IR',
    medial_form: 'fa-IR',
    final_form: 'fa-IR',
    ex_initial_word: 'fa-IR',
    ex_initial_letters: 'fa-IR',
    ex_medial_word: 'fa-IR',
    ex_medial_letters: 'fa-IR',
    ex_final_word: 'fa-IR',
    ex_final_letters: 'fa-IR',
  },
  'pokemon.json': {
    japaneseName: 'ja-JP',
  },
};

function buildSpeechConfigFromLanguageDefaults(raw = null) {
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  const fields = {};
  for (const [fieldKey, lang] of Object.entries(src)) {
    const key = String(fieldKey || '').trim();
    const normalizedLang = String(lang || '').trim();
    if (!key || !normalizedLang) continue;
    fields[key] = { lang: normalizedLang };
  }
  return Object.keys(fields).length ? { fields } : {};
}

function cloneSpeechConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  if (raw.fields && typeof raw.fields === 'object' && !Array.isArray(raw.fields)) {
    out.fields = {};
    for (const [fieldKey, value] of Object.entries(raw.fields)) {
      const key = String(fieldKey || '').trim();
      if (!key || !value || typeof value !== 'object' || Array.isArray(value)) continue;
      const next = {};
      if (value.lang != null) {
        const lang = String(value.lang || '').trim();
        if (lang) next.lang = lang;
      }
      for (const prop of ['rate', 'pitch', 'volume', 'voiceURI', 'voiceName']) {
        if (value[prop] == null || value[prop] === '') continue;
        next[prop] = value[prop];
      }
      if (Object.keys(next).length) out.fields[key] = next;
    }
  }
  if (raw.languages && typeof raw.languages === 'object' && !Array.isArray(raw.languages)) {
    out.languages = {};
    for (const [langKey, value] of Object.entries(raw.languages)) {
      const key = String(langKey || '').trim();
      if (!key || !value || typeof value !== 'object' || Array.isArray(value)) continue;
      const next = {};
      for (const prop of ['rate', 'pitch', 'volume', 'voiceURI', 'voiceName']) {
        if (value[prop] == null || value[prop] === '') continue;
        next[prop] = value[prop];
      }
      if (Object.keys(next).length) out.languages[key] = next;
    }
  }
  return out;
}

function cloneHeaderToolsConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  if (Array.isArray(raw.items)) {
    const seen = new Set();
    out.items = raw.items
      .map((item, index) => {
        const key = String(item?.key || '').trim();
        if (!key || seen.has(key)) return null;
        seen.add(key);
        return {
          key,
          visible: item?.visible !== false,
          order: Number.isFinite(Number(item?.order)) ? Number(item.order) : index,
        };
      })
      .filter(Boolean);
    if (!out.items.length) delete out.items;
  }
  return out;
}

function inferRelatedFieldKeys(collection = null, relationName = '') {
  const name = String(relationName || '').trim();
  if (!name) return [];
  return ['title', 'japanese', 'english', 'notes', 'sentences', 'chunks'];
}

function mergeSpeechConfig(baseRaw, overrideRaw) {
  const base = cloneSpeechConfig(baseRaw);
  const override = cloneSpeechConfig(overrideRaw);
  const out = { ...base, ...override };
  if (base.fields || override.fields) {
    out.fields = { ...(base.fields || {}), ...(override.fields || {}) };
  }
  if (base.languages || override.languages) {
    out.languages = { ...(base.languages || {}), ...(override.languages || {}) };
  }
  return cloneSpeechConfig(out);
}

export function getDefaultSpeechConfigForCollection(collKey) {
  const key = String(collKey || '').trim();
  return cloneSpeechConfig(buildSpeechConfigFromLanguageDefaults(SPEECH_LANGUAGE_DEFAULTS_BY_COLLECTION[key]));
}

function getDefaultViewForCollection(collKey) {
  return {
    ...DEFAULT_VIEW,
    speech: getDefaultSpeechConfigForCollection(collKey),
  };
}

function cloneCardsConfig(cards) {
  if (!cards || typeof cards !== 'object' || Array.isArray(cards)) return {};
  const out = {};
  for (const [cardKey, rawConfig] of Object.entries(cards)) {
    const key = String(cardKey || '').trim();
    if (!key || !rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) continue;
    if (key === 'genericFlatCard' && rawConfig.configs && typeof rawConfig.configs === 'object' && !Array.isArray(rawConfig.configs)) {
      const rootConfig = cloneCardsConfig({ __genericRoot__: rawConfig }).__genericRoot__ || {};
      delete rootConfig.activeConfigId;
      delete rootConfig.configs;
      const presets = {};
      for (const [presetId, rawPreset] of Object.entries(rawConfig.configs)) {
        const id = String(presetId || '').trim();
        if (!id || !rawPreset || typeof rawPreset !== 'object' || Array.isArray(rawPreset)) continue;
        const nextPreset = {
          name: String(rawPreset.name || id).trim() || id,
        };
        const parentId = id === 'system'
          ? String(rawPreset.parentId || '__system__').trim() || '__system__'
          : String(rawPreset.parentId || 'system').trim() || 'system';
        nextPreset.parentId = parentId;
        nextPreset.inheritsFromParent = id === 'system'
          ? rawPreset.inheritsFromParent !== false
          : !!rawPreset.inheritsFromParent;
        nextPreset.config = cloneCardsConfig({ __preset__: rawPreset.config || {} }).__preset__ || {};
        presets[id] = nextPreset;
      }
      out[key] = {
        ...rootConfig,
        activeConfigId: String(rawConfig.activeConfigId || '').trim() || 'system',
        configs: presets,
      };
      continue;
    }
    const nextConfig = {};
    if (rawConfig.fields && typeof rawConfig.fields === 'object' && !Array.isArray(rawConfig.fields)) {
      nextConfig.fields = {};
      for (const [fieldKey, rawFieldConfig] of Object.entries(rawConfig.fields)) {
        const field = String(fieldKey || '').trim();
        if (!field || !rawFieldConfig || typeof rawFieldConfig !== 'object' || Array.isArray(rawFieldConfig)) continue;
        const nextFieldConfig = {};
        if (Object.prototype.hasOwnProperty.call(rawFieldConfig, 'hide')) nextFieldConfig.hide = !!rawFieldConfig.hide;
        if (Object.prototype.hasOwnProperty.call(rawFieldConfig, 'order') && Number.isFinite(Number(rawFieldConfig.order))) {
          nextFieldConfig.order = Number(rawFieldConfig.order);
        }
        if (Object.prototype.hasOwnProperty.call(rawFieldConfig, 'style')) {
          const style = String(rawFieldConfig.style || '').trim();
          nextFieldConfig.style = style || 'main';
        }
        nextConfig.fields[field] = nextFieldConfig;
      }
      if (!Object.keys(nextConfig.fields).length) delete nextConfig.fields;
    } else if (Array.isArray(rawConfig.fields)) {
      nextConfig.fields = Array.from(new Set(rawConfig.fields.map((field) => String(field || '').trim()).filter(Boolean)));
    }
    if (rawConfig.styles && typeof rawConfig.styles === 'object' && !Array.isArray(rawConfig.styles)) {
      nextConfig.styles = {};
      for (const [styleId, rawStyle] of Object.entries(rawConfig.styles)) {
        const id = String(styleId || '').trim();
        if (!id || !rawStyle || typeof rawStyle !== 'object' || Array.isArray(rawStyle)) continue;
        const nextStyle = {};
        const name = String(rawStyle.name || '').trim();
        if (name) nextStyle.name = name;
        for (const [styleKey, styleValue] of Object.entries(rawStyle)) {
          const key = String(styleKey || '').trim();
          const value = String(styleValue || '').trim();
          if (!key || !value || key === 'name') continue;
          nextStyle[key] = value;
        }
        nextConfig.styles[id] = nextStyle;
      }
      if (!Object.keys(nextConfig.styles).length) delete nextConfig.styles;
    } else if (rawConfig.style || rawConfig.customStyles) {
      nextConfig.styles = cloneCardsConfig({
        __styles__: {
          main: { ...(rawConfig.style || {}), name: 'Main Style' },
          ...(rawConfig.customStyles || {}),
        },
      }).__styles__;
      if (!Object.keys(nextConfig.styles || {}).length) delete nextConfig.styles;
    }
    if (Array.isArray(rawConfig.controls)) {
      nextConfig.controls = Array.from(new Set(rawConfig.controls.map((item) => String(item || '').trim()).filter(Boolean)));
    }
    if (rawConfig.layout && typeof rawConfig.layout === 'object' && !Array.isArray(rawConfig.layout)) {
      nextConfig.layout = {};
      for (const [slotKey, fieldKey] of Object.entries(rawConfig.layout)) {
        const slot = String(slotKey || '').trim();
        const field = String(fieldKey || '').trim();
        if (!slot) continue;
        nextConfig.layout[slot] = field;
      }
    }
    if (Array.isArray(rawConfig.collections)) {
      nextConfig.collections = Array.from(new Set(rawConfig.collections.map((item) => String(item || '').trim()).filter(Boolean)));
    }
    if (rawConfig.relatedCollections && typeof rawConfig.relatedCollections === 'object' && !Array.isArray(rawConfig.relatedCollections)) {
      nextConfig.relatedCollections = {};
      for (const [relationName, relationConfig] of Object.entries(rawConfig.relatedCollections)) {
        const name = String(relationName || '').trim();
        if (!name || !relationConfig || typeof relationConfig !== 'object' || Array.isArray(relationConfig)) continue;
        nextConfig.relatedCollections[name] = {};
        if (Array.isArray(relationConfig.fields)) {
          nextConfig.relatedCollections[name].fields = Array.from(new Set(relationConfig.fields.map((item) => String(item || '').trim()).filter(Boolean)));
        }
        const detailsMode = String(relationConfig.detailsMode || '').trim().toLowerCase();
        if (detailsMode === 'click' || detailsMode === 'always') {
          nextConfig.relatedCollections[name].detailsMode = detailsMode;
        }
        if (Object.prototype.hasOwnProperty.call(relationConfig, 'collapsePrimaryWhenExpanded')) {
          nextConfig.relatedCollections[name].collapsePrimaryWhenExpanded = !!relationConfig.collapsePrimaryWhenExpanded;
        }
      }
    }
    out[key] = nextConfig;
  }
  return out;
}

function getCollectionFieldKeys(collection) {
  const md = collection?.metadata || {};
  const defs = Array.isArray(md.fields)
    ? md.fields
    : (Array.isArray(md.schema) ? md.schema : []);
  const out = [];
  const seen = new Set();
  for (const def of defs) {
    const key = String((def && typeof def === 'object') ? (def.key || '') : (def || '')).trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function _validateDisplayCards(cards) {
  // Allow the compact 'all' marker (string) used by the UI dropdowns.
  if (typeof cards === 'string') {
    if (cards === 'all') return;
    throw new Error('displayCards must be an array or "all"');
  }
  if (!Array.isArray(cards)) throw new Error('displayCards must be an array');
  for (const c of cards) {
    if (typeof c !== 'string') throw new Error('displayCards entries must be strings');
    if (c === '__toggle__') continue;
    if (!AVAILABLE_CARD_KEYS.has(c)) throw new Error(`unknown display card type: ${c}`);
  }
}

function _validateEntryFields(fields, collection) {
  // Allow the compact 'all' marker (string) used by the UI dropdowns.
  if (typeof fields === 'string') {
    if (fields === 'all') return;
    throw new Error('entryFields must be an array or "all"');
  }
  if (!Array.isArray(fields)) throw new Error('entryFields must be an array');
  const fieldKeys = new Set(getCollectionFieldKeys(collection));
  for (const f of fields) {
    if (typeof f !== 'string') throw new Error('entryFields must contain strings');
    if (f === '__toggle__') continue;
    if (!fieldKeys.has(f)) throw new Error(`entry field not in collection schema: ${f}`);
  }
}

function _validateCards(cards, collection) {
  if (!cards || typeof cards !== 'object' || Array.isArray(cards)) throw new Error('cards must be an object');
  const fieldKeys = new Set(getCollectionFieldKeys(collection));
  const allowedMainLayoutSlots = new Set(['topLeft', 'main', 'bottomLeft', 'bottomRight']);
  const allowedJsonControls = new Set(['maximize', 'wrap', 'copy', 'toggle']);
  const allowedGenericStyleKeys = new Map([
    ['labelWidth', new Set(['6rem', '8rem', '10rem', '12rem', '14rem'])],
    ['labelSize', new Set(['2xs', 'xs', 'sm', 'body'])],
    ['labelTone', new Set(['muted', 'default'])],
    ['labelVisibility', new Set(['show', 'hidden'])],
    ['valueSize', new Set(['xs', 'sm', 'body', 'lg', 'xl'])],
    ['rowPadding', new Set(['compact', 'default', 'relaxed'])],
    ['rowDivider', new Set(['show', 'hide'])],
  ]);
  for (const [cardKey, rawConfig] of Object.entries(cards)) {
    const key = String(cardKey || '').trim();
    if (!key) continue;
    if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
      throw new Error(`cards.${key} must be an object`);
    }
    if (key === 'genericFlatCard' && Object.prototype.hasOwnProperty.call(rawConfig, 'configs')) {
      if (Object.prototype.hasOwnProperty.call(rawConfig, 'styles')) {
        if (!rawConfig.styles || typeof rawConfig.styles !== 'object' || Array.isArray(rawConfig.styles)) {
          throw new Error(`cards.${key}.styles must be an object`);
        }
        for (const [styleId, rawStyle] of Object.entries(rawConfig.styles)) {
          const id = String(styleId || '').trim();
          if (!id) throw new Error(`cards.${key}.styles keys must be non-empty strings`);
          if (!rawStyle || typeof rawStyle !== 'object' || Array.isArray(rawStyle)) {
            throw new Error(`cards.${key}.styles.${id} must be an object`);
          }
          for (const [styleKey, styleValue] of Object.entries(rawStyle)) {
            if (styleKey === 'name') continue;
            const styleName = String(styleKey || '').trim();
            const styleOption = String(styleValue || '').trim();
            const allowedValues = allowedGenericStyleKeys.get(styleName);
            if (!allowedValues) throw new Error(`cards.${key}.styles.${id} key not supported: ${styleName}`);
            if (!allowedValues.has(styleOption)) {
              throw new Error(`cards.${key}.styles.${id} value not supported for ${styleName}: ${styleOption}`);
            }
          }
        }
      }
      if (!rawConfig.configs || typeof rawConfig.configs !== 'object' || Array.isArray(rawConfig.configs)) {
        throw new Error(`cards.${key}.configs must be an object`);
      }
      const styleIds = new Set(Object.keys(rawConfig.styles || {}).map((item) => String(item || '').trim()).filter(Boolean));
      styleIds.add('main');
      const presetIds = new Set();
      for (const [presetId, rawPreset] of Object.entries(rawConfig.configs)) {
        const id = String(presetId || '').trim();
        if (!id) throw new Error(`cards.${key}.configs keys must be non-empty strings`);
        if (presetIds.has(id)) throw new Error(`cards.${key}.configs contains duplicate key: ${id}`);
        presetIds.add(id);
        if (!rawPreset || typeof rawPreset !== 'object' || Array.isArray(rawPreset)) {
          throw new Error(`cards.${key}.configs.${id} must be an object`);
        }
        if (id !== 'system') {
          const parentId = String(rawPreset.parentId || '').trim();
          if (!parentId) throw new Error(`cards.${key}.configs.${id}.parentId must be a non-empty string`);
          if (parentId === id) throw new Error(`cards.${key}.configs.${id}.parentId cannot reference itself`);
          if (parentId !== '__system__' && !rawConfig.configs[parentId]) {
            throw new Error(`cards.${key}.configs.${id}.parentId must reference cards.${key}.configs or __system__`);
          }
        } else {
          const parentId = String(rawPreset.parentId || '').trim();
          if (parentId && parentId !== '__system__') {
            throw new Error(`cards.${key}.configs.${id}.parentId must be __system__ when provided`);
          }
        }
        if (!rawPreset.config || typeof rawPreset.config !== 'object' || Array.isArray(rawPreset.config)) {
          throw new Error(`cards.${key}.configs.${id}.config must be an object`);
        }
        if (Object.prototype.hasOwnProperty.call(rawPreset.config, 'fields')) {
          if (!rawPreset.config.fields || typeof rawPreset.config.fields !== 'object' || Array.isArray(rawPreset.config.fields)) {
            throw new Error(`cards.${key}.configs.${id}.config.fields must be an object`);
          }
          for (const [fieldKey, fieldConfig] of Object.entries(rawPreset.config.fields)) {
            const field = String(fieldKey || '').trim();
            if (!field) throw new Error(`cards.${key}.configs.${id}.config.fields keys must be non-empty strings`);
            if (!fieldKeys.has(field)) throw new Error(`cards.${key}.configs.${id}.config.fields entry not in collection schema: ${field}`);
            if (!fieldConfig || typeof fieldConfig !== 'object' || Array.isArray(fieldConfig)) {
              throw new Error(`cards.${key}.configs.${id}.config.fields.${field} must be an object`);
            }
            if (Object.prototype.hasOwnProperty.call(fieldConfig, 'order') && !Number.isFinite(Number(fieldConfig.order))) {
              throw new Error(`cards.${key}.configs.${id}.config.fields.${field}.order must be numeric`);
            }
            if (Object.prototype.hasOwnProperty.call(fieldConfig, 'style')) {
              const style = String(fieldConfig.style || '').trim() || 'main';
              if (!styleIds.has(style)) {
                throw new Error(`cards.${key}.configs.${id}.config.fields.${field}.style must reference cards.${key}.styles`);
              }
            }
          }
        }
      }
      if (Object.prototype.hasOwnProperty.call(rawConfig, 'activeConfigId')) {
        const activeId = String(rawConfig.activeConfigId || '').trim();
        if (activeId && !presetIds.has(activeId)) {
          throw new Error(`cards.${key}.activeConfigId must reference cards.${key}.configs`);
        }
      }
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(rawConfig, 'fields')) {
      if (!Array.isArray(rawConfig.fields)) throw new Error(`cards.${key}.fields must be an array`);
      for (const fieldKey of rawConfig.fields) {
        const field = String(fieldKey || '').trim();
        if (!field) throw new Error(`cards.${key}.fields entries must be non-empty strings`);
        if (!fieldKeys.has(field)) throw new Error(`cards.${key}.fields entry not in collection schema: ${field}`);
      }
    }
    if (Object.prototype.hasOwnProperty.call(rawConfig, 'style')) {
      if (!rawConfig.style || typeof rawConfig.style !== 'object' || Array.isArray(rawConfig.style)) {
        throw new Error(`cards.${key}.style must be an object`);
      }
      if (key !== 'genericFlatCard') {
        throw new Error(`cards.${key}.style is not supported`);
      }
      for (const [styleKey, styleValue] of Object.entries(rawConfig.style)) {
        const styleName = String(styleKey || '').trim();
        const styleOption = String(styleValue || '').trim();
        const allowedValues = allowedGenericStyleKeys.get(styleName);
        if (!allowedValues) throw new Error(`cards.${key}.style key not supported: ${styleName}`);
        if (!allowedValues.has(styleOption)) {
          throw new Error(`cards.${key}.style value not supported for ${styleName}: ${styleOption}`);
        }
      }
    }
    if (Object.prototype.hasOwnProperty.call(rawConfig, 'customStyles')) {
      if (!rawConfig.customStyles || typeof rawConfig.customStyles !== 'object' || Array.isArray(rawConfig.customStyles)) {
        throw new Error(`cards.${key}.customStyles must be an object`);
      }
      if (key !== 'genericFlatCard') {
        throw new Error(`cards.${key}.customStyles is not supported`);
      }
      for (const [styleId, rawStyle] of Object.entries(rawConfig.customStyles)) {
        const id = String(styleId || '').trim();
        if (!id) throw new Error(`cards.${key}.customStyles keys must be non-empty strings`);
        if (!rawStyle || typeof rawStyle !== 'object' || Array.isArray(rawStyle)) {
          throw new Error(`cards.${key}.customStyles.${id} must be an object`);
        }
        for (const [styleKey, styleValue] of Object.entries(rawStyle)) {
          if (styleKey === 'name') continue;
          const styleName = String(styleKey || '').trim();
          const styleOption = String(styleValue || '').trim();
          const allowedValues = allowedGenericStyleKeys.get(styleName);
          if (!allowedValues) throw new Error(`cards.${key}.customStyles.${id} key not supported: ${styleName}`);
          if (!allowedValues.has(styleOption)) {
            throw new Error(`cards.${key}.customStyles.${id} value not supported for ${styleName}: ${styleOption}`);
          }
        }
      }
    }
    if (Object.prototype.hasOwnProperty.call(rawConfig, 'fieldStyles')) {
      if (!rawConfig.fieldStyles || typeof rawConfig.fieldStyles !== 'object' || Array.isArray(rawConfig.fieldStyles)) {
        throw new Error(`cards.${key}.fieldStyles must be an object`);
      }
      if (key !== 'genericFlatCard') {
        throw new Error(`cards.${key}.fieldStyles is not supported`);
      }
      const customStyleIds = new Set(Object.keys(rawConfig.customStyles || {}).map((item) => String(item || '').trim()).filter(Boolean));
      for (const [fieldKey, styleId] of Object.entries(rawConfig.fieldStyles)) {
        const field = String(fieldKey || '').trim();
        const style = String(styleId || '').trim();
        if (!field) throw new Error(`cards.${key}.fieldStyles keys must be non-empty strings`);
        if (!fieldKeys.has(field)) throw new Error(`cards.${key}.fieldStyles entry not in collection schema: ${field}`);
        if (!style || !customStyleIds.has(style)) {
          throw new Error(`cards.${key}.fieldStyles entry must reference a custom style: ${style}`);
        }
      }
    }
    if (Object.prototype.hasOwnProperty.call(rawConfig, 'controls')) {
      if (!Array.isArray(rawConfig.controls)) throw new Error(`cards.${key}.controls must be an array`);
      for (const controlKey of rawConfig.controls) {
        const control = String(controlKey || '').trim();
        if (!allowedJsonControls.has(control)) throw new Error(`cards.${key}.controls entry not supported: ${control}`);
      }
    }
    if (Object.prototype.hasOwnProperty.call(rawConfig, 'layout')) {
      if (!rawConfig.layout || typeof rawConfig.layout !== 'object' || Array.isArray(rawConfig.layout)) {
        throw new Error(`cards.${key}.layout must be an object`);
      }
      for (const [slotKey, fieldKey] of Object.entries(rawConfig.layout)) {
        const slot = String(slotKey || '').trim();
        const field = String(fieldKey || '').trim();
        if (!slot) throw new Error(`cards.${key}.layout slot keys must be non-empty strings`);
        if (key === 'main' && !allowedMainLayoutSlots.has(slot)) {
          throw new Error(`cards.${key}.layout slot not supported: ${slot}`);
        }
        if (field && !fieldKeys.has(field)) {
          throw new Error(`cards.${key}.layout entry not in collection schema: ${field}`);
        }
      }
    }
  }
}

function _validateHeaderTools(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('headerTools must be an object');
  if (!Object.prototype.hasOwnProperty.call(config, 'items')) return;
  if (!Array.isArray(config.items)) throw new Error('headerTools.items must be an array');
  const seen = new Set();
  for (const item of config.items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('headerTools.items entries must be objects');
    const key = String(item.key || '').trim();
    if (!key) throw new Error('headerTools.items entries must include a non-empty key');
    if (seen.has(key)) throw new Error(`headerTools.items contains duplicate key: ${key}`);
    seen.add(key);
    if (Object.prototype.hasOwnProperty.call(item, 'visible') && typeof item.visible !== 'boolean') {
      throw new Error(`headerTools.items.${key}.visible must be boolean`);
    }
    if (Object.prototype.hasOwnProperty.call(item, 'order') && !Number.isFinite(Number(item.order))) {
      throw new Error(`headerTools.items.${key}.order must be numeric`);
    }
  }
}

function create(collKey) {
  const collectionDefaults = getDefaultViewForCollection(collKey);
  const validators = {
    displayCards: (v) => _validateDisplayCards(v),
    entryFields: (v, collection) => _validateEntryFields(v, collection),
    headerTools: (v) => _validateHeaderTools(v),
    cards: (v, collection) => _validateCards(v, collection),
    speech: (v) => {
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('speech must be an object');
    },
    currentIndex: (v) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) throw new Error('currentIndex must be an integer >= 0');
    },
  };

  const base = controllerUtils.createViewController(collKey, VIEW, collectionDefaults, validators);

  // keep a local collection reference once ready so we can resolve metadata-driven maps
  let _collectionRef = null;
  base.ready.then((c) => { _collectionRef = c; }).catch(() => {});

  function _computeResolved(viewState) {
    const collection = _collectionRef || {};
    const md = collection.metadata || {};
    const fields = getCollectionFieldKeys(collection);
    const relatedDefs = Array.isArray(md.relatedCollections) ? md.relatedCollections.slice() : [];

    const effective = { ...DEFAULT_VIEW, ...(viewState || {}) };

    // entry field map
    const entryFieldMap = {};
    if (effective.entryFields === 'all') {
      for (const k of fields) entryFieldMap[String(k)] = true;
    } else if (Array.isArray(effective.entryFields)) {
      const s = new Set(effective.entryFields.map(String));
      for (const k of fields) entryFieldMap[String(k)] = !!s.has(String(k));
    } else {
      for (const k of fields) entryFieldMap[String(k)] = false;
    }

    // related field maps
    const relatedFieldMaps = {};
    for (const rd of relatedDefs) {
      const name = String(rd?.name || '').trim();
      if (!name) continue;
      const relFields = inferRelatedFieldKeys(collection, name);
      relatedFieldMaps[name] = {};
      const sel = effective.relatedFields && Object.prototype.hasOwnProperty.call(effective.relatedFields, name) ? effective.relatedFields[name] : 'all';
      if (sel === 'all') {
        for (const k of relFields) relatedFieldMaps[name][String(k)] = true;
      } else if (Array.isArray(sel)) {
        const s = new Set(sel.map(String));
        for (const k of relFields) relatedFieldMaps[name][String(k)] = !!s.has(String(k));
      } else {
        for (const k of relFields) relatedFieldMaps[name][String(k)] = false;
      }
    }

    // display cards resolved list (expand 'all')
    let displayCardsResolved = [];
    if (effective.displayCards === 'all') displayCardsResolved = Array.from(AVAILABLE_CARD_KEYS);
    else if (Array.isArray(effective.displayCards)) displayCardsResolved = effective.displayCards.filter(c => AVAILABLE_CARD_KEYS.has(c));
    else displayCardsResolved = Array.from(AVAILABLE_CARD_KEYS);

    return { entryFieldMap, relatedFieldMaps, displayCards: displayCardsResolved };
  }

  // convenience wrappers (same API as before) with augmented get/subscribe
  return {
    collKey: base.collKey,
    ready: base.ready,
    get: () => {
      const s = base.get();
      try { return { ...s, resolved: _computeResolved(s) }; } catch (e) { return s; }
    },
    set: async (patch) => {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('patch object required');
      const nextPatch = { ...patch };
      if (Object.prototype.hasOwnProperty.call(nextPatch, 'headerTools')) {
        nextPatch.headerTools = cloneHeaderToolsConfig(nextPatch.headerTools);
      }
      if (Object.prototype.hasOwnProperty.call(nextPatch, 'speech')) {
        nextPatch.speech = cloneSpeechConfig(nextPatch.speech);
      }
      return base.set(nextPatch);
    },
    reset: () => base.replace(collectionDefaults),
    setEntryFields: (fields) => base.set({ entryFields: fields }),
    setDisplayCards: (cards) => base.set({ displayCards: cards }),
    setHeaderTools: (headerTools) => base.set({ headerTools: cloneHeaderToolsConfig(headerTools) }),
    setCards: (cards) => base.set({ cards: cloneCardsConfig(cards) }),
    setSpeech: (speech) => base.set({ speech: cloneSpeechConfig(speech) }),
    getSpeech: () => {
      const current = base.get() || {};
      return mergeSpeechConfig(collectionDefaults.speech, current.speech);
    },
    setCardConfig: (cardKey, config) => {
      const key = String(cardKey || '').trim();
      if (!key) throw new Error('cardKey required');
      const current = base.get() || {};
      const nextCards = cloneCardsConfig(current.cards);
      if (!config || typeof config !== 'object' || Array.isArray(config)) delete nextCards[key];
      else nextCards[key] = cloneCardsConfig({ [key]: config })[key] || {};
      return base.set({ cards: nextCards });
    },
    getCardConfig: (cardKey) => {
      const key = String(cardKey || '').trim();
      if (!key) return {};
      const current = base.get() || {};
      const nextCards = cloneCardsConfig(current.cards);
      return nextCards[key] || {};
    },
    goToIndex: async (newIndex) => {
      const coll = await base.ready;
      const n = Array.isArray(coll?.entries) ? coll.entries.length : 0;
      if (!n) return;
      const ni = Math.min(Math.max(0, Number.isFinite(Number(newIndex)) ? Number(newIndex) : 0), n - 1);
      return base.set({ currentIndex: ni });
    },
    setCurrentIndex: (i) => base.set({ currentIndex: i }),
    nextIndex: async () => {
      const coll = await base.ready;
      const n = Array.isArray(coll?.entries) ? coll.entries.length : 0;
      if (!n) return;
      const st = base.get() || {};
      const cur = Number.isFinite(Number(st.currentIndex)) ? Number(st.currentIndex) : 0;
      const next = ((cur + 1) % n + n) % n;
      return base.set({ currentIndex: next });
    },
    prevIndex: async () => {
      const coll = await base.ready;
      const n = Array.isArray(coll?.entries) ? coll.entries.length : 0;
      if (!n) return;
      const st = base.get() || {};
      const cur = Number.isFinite(Number(st.currentIndex)) ? Number(st.currentIndex) : 0;
      const next = ((cur - 1) % n + n) % n;
      return base.set({ currentIndex: next });
    },
    subscribe: (cb) => {
      return base.subscribe((viewState, viewPatch, newState, patch) => {
        try {
          const resolved = _computeResolved(viewState || {});
          const vs = { ...viewState, resolved };
          const vp = { ...viewPatch, resolved };
          cb(vs, vp, newState, patch);
        } catch (e) {
          try { cb(viewState, viewPatch, newState, patch); } catch (e2) {}
        }
      });
    },
    dispose: base.dispose,
  };
}

async function forCollection(collKey) { const c = create(collKey); await c.ready; return c; }

export default { create, forCollection };
