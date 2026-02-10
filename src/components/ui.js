import { speak, getLanguageCode } from '../utils/speech.js';

/**
 * Simplified DOM element creation
 */
export function el(tag, options = {}) {
  const elem = document.createElement(tag);
  if (options.className) elem.className = options.className;
  if (options.id) elem.id = options.id;
  if (options.text != null) elem.textContent = options.text;
  if (options.html) elem.innerHTML = options.html;
  if (options.style) Object.assign(elem.style, options.style);
  if (options.attrs) {
    for (const [k, v] of Object.entries(options.attrs)) {
      elem.setAttribute(k, v);
    }
  }
  if (options.children) {
    elem.append(...options.children.filter(Boolean));
  }
  return elem;
}

/**
 * Create a key-value row element
 */
export function kv(key, value) {
  return el('div', {
    className: 'kv',
    children: [
      el('div', { className: 'k', text: key }),
      el('div', { text: String(value ?? '') })
    ]
  });
}

/**
 * Safely convert text to ID-compatible string
 */
export function safeId(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/**
 * Card UI wrapper
 */
export function card({ title, subtitle, cornerCaption, className = '', id, children = [] }) {
  const titleEl = title ? el('h2', { text: title }) : null;
  const subtitleEl = subtitle ? el('p', { className: 'hint', text: subtitle }) : null;
  // Always render the corner caption element to keep card layout consistent
  const cornerEl = el('div', { className: 'card-corner-caption', text: cornerCaption ?? '' });

  return el('div', {
    className: `card ${className}`.trim(),
    id,
    children: [cornerEl, titleEl, subtitleEl, ...children]
  });
}

/**
 * Shared speaker button used in multiple apps
 */
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
