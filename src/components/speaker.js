import { speak, getLanguageCode } from '../utils/speech.js';

export function createSpeakerButton({ text, lang, collectionCategory, fieldKey }) {
  const btn = document.createElement('button');
  btn.className = 'icon-button';
  btn.textContent = '🔊';
  btn.title = 'Listen';
  btn.style.marginLeft = '8px';
  
  btn.addEventListener('click', () => {
    const languageCode = lang || getLanguageCode(fieldKey, collectionCategory);
    speak(text, languageCode);
  });
  
  return btn;
}
