export function speak(text, lang = 'en-US') {
  if (!window.speechSynthesis) {
    console.warn('Speech synthesis not supported');
    return;
  }

  // Cancel any ongoing speech
  window.speechSynthesis.cancel();

  // Normalize text for better pronunciation
  const normalizedText = normalizeForSpeech(text, lang);

  const utterance = new SpeechSynthesisUtterance(normalizedText);
  utterance.lang = lang;
  utterance.rate = 0.9; // Slightly slower for clarity
  
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
  };
  
  return languageMap[fieldKey] || 'en-US';
}
