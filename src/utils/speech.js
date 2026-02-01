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

function isJapaneseLang(lang) {
  return String(lang || '').toLowerCase().startsWith('ja');
}

function resolveVoice({ voiceURI, voiceName, lang }) {
  const synth = window.speechSynthesis;
  if (!synth) return null;

  const voices = synth.getVoices?.() || [];
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

  const persistedAll = loadPersistedVoiceSettings();

  let options = {};
  if (langOrOptions && typeof langOrOptions === 'object') {
    options = { ...langOrOptions };
  } else {
    options = { ...(maybeOptions && typeof maybeOptions === 'object' ? maybeOptions : {}) };
    if (typeof langOrOptions === 'string' && langOrOptions) {
      options.lang = options.lang || langOrOptions;
    }
  }

  const baseLang = (options.lang || (typeof langOrOptions === 'string' ? langOrOptions : null) || 'en-US');
  const persisted = persistedAll
    ? (isJapaneseLang(baseLang) ? persistedAll.jpVoice : persistedAll.engVoice)
    : null;

  // Merge: explicit options > persisted per-language settings
  const merged = { ...(persisted || {}), ...options };
  const lang = merged.lang || baseLang;

  // Normalize text for better pronunciation
  const normalizedText = normalizeForSpeech(text, lang);

  const utterance = new SpeechSynthesisUtterance(normalizedText);
  utterance.lang = lang;

  // Defaults chosen for clarity
  utterance.rate = clampNumber(merged.rate, { min: 0.5, max: 1.5, fallback: 0.9 });
  utterance.pitch = clampNumber(merged.pitch, { min: 0.1, max: 1.5, fallback: 1 });
  utterance.volume = clampNumber(merged.volume, { min: 0.1, max: 1, fallback: 1 });

  const voice = resolveVoice({ voiceURI: merged.voiceURI, voiceName: merged.voiceName, lang });
  if (voice) utterance.voice = voice;
  
  window.speechSynthesis.speak(utterance);
}

function normalizeForSpeech(text, lang) {
  // Remove polytonic Greek diacritics for cleaner text
  // This helps even with English pronunciation
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function getLanguageCode(fieldKey, collectionCategory) {
  // Map field names to language codes
  const languageMap = {
    'greekName': 'en-US', // Use English for Greek names (Anglicized pronunciation)
    'latinName': 'en-US', // Use English for Latin names
    'kanji': 'ja-JP',     // Japanese
    'reading': 'ja-JP',   // Japanese
    'japaneseName': 'ja-JP', // Japanese
  };
  
  return languageMap[fieldKey] || 'en-US';
}
