function clampNumber(value, { min, max, fallback }) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

let voiceSettingsGetter = null;

// Allow the app shell/store to provide voice settings without this module
// reaching into storage directly.
export function setVoiceSettingsGetter(getter) {
  voiceSettingsGetter = (typeof getter === 'function') ? getter : null;
}

function loadPersistedVoiceSettings() {
  try {
    const v = voiceSettingsGetter ? voiceSettingsGetter() : null;
    return (v && typeof v === 'object') ? v : null;
  } catch (e) {
    return null;
  }
}

function normalizeLangTag(lang) {
  const raw = String(lang || '').trim();
  if (!raw) return '';
  const parts = raw.replace(/_/g, '-').split('-').filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0].toLowerCase();
  return `${parts[0].toLowerCase()}-${parts.slice(1).join('-').toUpperCase()}`;
}

function normalizeSpeechSettings(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  const out = {};

  if (src.fields && typeof src.fields === 'object' && !Array.isArray(src.fields)) {
    out.fields = {};
    for (const [fieldKey, value] of Object.entries(src.fields)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const normalizedFieldKey = String(fieldKey || '').trim();
      if (!normalizedFieldKey) continue;
      const next = {};
      if (value.lang != null) {
        const normalizedLang = normalizeLangTag(value.lang);
        if (normalizedLang) next.lang = normalizedLang;
      }
      for (const key of ['rate', 'pitch', 'volume', 'voiceURI', 'voiceName']) {
        if (value[key] == null || value[key] === '') continue;
        next[key] = value[key];
      }
      if (Object.keys(next).length) out.fields[normalizedFieldKey] = next;
    }
  }

  if (src.languages && typeof src.languages === 'object' && !Array.isArray(src.languages)) {
    out.languages = {};
    for (const [langKey, value] of Object.entries(src.languages)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const normalizedLang = normalizeLangTag(langKey);
      if (!normalizedLang) continue;
      const next = {};
      for (const key of ['rate', 'pitch', 'volume', 'voiceURI', 'voiceName']) {
        if (value[key] == null || value[key] === '') continue;
        next[key] = value[key];
      }
      if (Object.keys(next).length) out.languages[normalizedLang] = next;
    }
  }

  // Backward compatibility with legacy shell.voice settings.
  if (!out.languages) out.languages = {};
  if (src.engVoice && typeof src.engVoice === 'object') {
    out.languages['en-US'] = { ...(out.languages['en-US'] || {}), ...src.engVoice };
  }
  if (src.jpVoice && typeof src.jpVoice === 'object') {
    out.languages['ja-JP'] = { ...(out.languages['ja-JP'] || {}), ...src.jpVoice };
  }

  return out;
}

function getFieldSpeechSettings(allSettings, fieldKey) {
  const key = String(fieldKey || '').trim();
  if (!key) return null;
  const fields = (allSettings?.fields && typeof allSettings.fields === 'object') ? allSettings.fields : null;
  if (!fields) return null;
  const direct = fields[key];
  return (direct && typeof direct === 'object') ? direct : null;
}

function getLanguageSpeechSettings(allSettings, lang) {
  const normalizedLang = normalizeLangTag(lang);
  if (!normalizedLang) return null;
  const languages = (allSettings?.languages && typeof allSettings.languages === 'object') ? allSettings.languages : null;
  if (!languages) return null;
  if (languages[normalizedLang] && typeof languages[normalizedLang] === 'object') {
    return languages[normalizedLang];
  }
  const prefix = normalizedLang.split('-')[0];
  if (!prefix) return null;
  for (const [key, value] of Object.entries(languages)) {
    if (String(key || '').toLowerCase().startsWith(`${prefix.toLowerCase()}-`) && value && typeof value === 'object') {
      return value;
    }
  }
  return null;
}

function hasLanguageSupport(lang) {
  const normalizedLang = normalizeLangTag(lang);
  if (!normalizedLang) return false;
  const prefix = normalizedLang.split('-')[0];
  const voices = window.speechSynthesis?.getVoices?.() || [];
  return voices.some((voice) => {
    const candidate = normalizeLangTag(voice?.lang);
    if (!candidate) return false;
    if (candidate.toLowerCase() === normalizedLang.toLowerCase()) return true;
    return candidate.split('-')[0] === prefix;
  });
}

function getAvailableVoices() {
  return window.speechSynthesis?.getVoices?.() || [];
}

function resolveVoice({ voiceURI, voiceName, lang }) {
  const synth = window.speechSynthesis;
  if (!synth) return null;

  const voices = getAvailableVoices();
  if (!voices.length) return null;

  if (voiceURI) {
    const v = voices.find(vo => vo.voiceURI === voiceURI);
    if (v) return v;
  }

  if (voiceName) {
    const v = voices.find(vo => vo.name === voiceName);
    if (v) return v;
  }

  if (lang) {
    const v = voices.find(vo => String(vo.lang || '').toLowerCase() === String(lang).toLowerCase() && vo.default);
    if (v) return v;
  }

  return null;
}

export function speak(text, langOrOptions = 'en-US', maybeOptions = null) {
  if (!window.speechSynthesis) {
    console.warn('Speech synthesis not supported');
    return;
  }

  // Cancel any ongoing speech
  window.speechSynthesis.cancel();

  const persistedAll = normalizeSpeechSettings(loadPersistedVoiceSettings());

  let options = {};
  if (langOrOptions && typeof langOrOptions === 'object') {
    options = { ...langOrOptions };
  } else {
    options = { ...(maybeOptions && typeof maybeOptions === 'object' ? maybeOptions : {}) };
    if (typeof langOrOptions === 'string' && langOrOptions) {
      options.lang = options.lang || langOrOptions;
    }
  }

  const fieldKey = String(options.fieldKey || options.field || '').trim();
  const collectionCategory = String(
    options.collectionCategory
    || options.collectionKey
    || options.collection
    || ''
  ).trim();
  const explicitLang = normalizeLangTag(options.lang || (typeof langOrOptions === 'string' ? langOrOptions : ''));
  const fieldPersisted = getFieldSpeechSettings(persistedAll, fieldKey);
  const inferredFieldLang = normalizeLangTag(
    fieldPersisted?.lang
    || (fieldKey ? getLanguageCode(fieldKey, collectionCategory) : '')
  );
  const baseLang = explicitLang || inferredFieldLang || 'en-US';
  const languagePersisted = getLanguageSpeechSettings(persistedAll, baseLang);

  // Merge order: per-language defaults, then per-field overrides, then explicit call options.
  const merged = { ...(languagePersisted || {}), ...(fieldPersisted || {}), ...options };
  const lang = normalizeLangTag(merged.lang || baseLang || 'en-US');

  // Normalize text for better pronunciation
  const normalizedText = normalizeForSpeech(text, lang);

  const utterance = new SpeechSynthesisUtterance(normalizedText);
  const voices = getAvailableVoices();
  const canHonorLang = !!(lang && (!voices.length || hasLanguageSupport(lang)));
  if (lang && canHonorLang) {
    utterance.lang = lang;
  }

  // Defaults chosen for clarity
  utterance.rate = clampNumber(merged.rate, { min: 0.5, max: 1.5, fallback: 0.9 });
  utterance.pitch = clampNumber(merged.pitch, { min: 0.1, max: 1.5, fallback: 1 });
  utterance.volume = clampNumber(merged.volume, { min: 0.1, max: 1, fallback: 1 });

  const voice = resolveVoice({ voiceURI: merged.voiceURI, voiceName: merged.voiceName, lang: (voices.length && canHonorLang) ? lang : null });
  if (voice) utterance.voice = voice;
  
  window.speechSynthesis.speak(utterance);
}

function normalizeForSpeech(text, lang) {
  // Remove polytonic Greek diacritics for cleaner text
  // This helps even with English pronunciation
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function getLanguageCode(fieldKey, collectionCategory) {
  const key = String(fieldKey || '').trim();
  if (!key) return 'en-US';
  const collectionKey = String(collectionCategory || '').trim().replace(/\\/g, '/').toLowerCase();

  const languageMap = {
    kanji: 'ja-JP',
    reading: 'ja-JP',
    japaneseName: 'ja-JP',
    example_jp: 'ja-JP',
  };
  if (languageMap[key]) return languageMap[key];

  const normalized = key.toLowerCase();
  const isGreekCollection = collectionKey.includes('/greek/') || collectionKey.startsWith('greek/');
  const isSpanishCollection = collectionKey.includes('/spanish/') || collectionKey.startsWith('spanish/');
  const isPersianCollection = collectionKey.includes('/persian/') || collectionKey.startsWith('persian/');

  if (isGreekCollection) {
    if (
      normalized.includes('greek')
      || normalized === 'lowercase'
      || normalized === 'uppercase'
    ) return 'el-GR';

    if (normalized.includes('latin')) return 'it-IT';
  }

  if (isSpanishCollection) {
    if (
      normalized.includes('spanish')
      || normalized === 'es'
      || normalized === 'lemma'
      || normalized === 'term'
    ) return 'es-ES';
  }

  if (isPersianCollection) {
    if (
      normalized === 'char'
      || normalized.endsWith('_form')
      || normalized.endsWith('_word')
      || normalized.endsWith('_letters')
    ) return 'fa-IR';
  }

  if (
    normalized.includes('kanji')
    || normalized.includes('kana')
    || normalized.includes('reading')
    || normalized.includes('japanese')
    || normalized === 'jp'
    || normalized === 'ja'
  ) return 'ja-JP';

  if (
    normalized.includes('english')
    || normalized.includes('meaning')
    || normalized.includes('definition')
    || normalized.includes('gloss')
    || normalized === 'en'
  ) return 'en-US';

  return 'en-US';
}
