import { el } from './dom.js';

/**
 * Create a card component with optional title and subtitle
 * @param {Object} options
 * @param {string} options.title - Card title (h2)
 * @param {string} options.subtitle - Card subtitle (hint)
 * @param {string} options.cornerCaption - Small caption in top right corner
 * @param {string} options.className - Additional CSS classes
 * @param {string} options.id - Card ID
 * @param {Array} options.children - Child elements
 * @returns {HTMLElement}
 */
export function card({ title, subtitle, cornerCaption, className = '', id, children = [] }) {
  const titleEl = title ? el('h2', { text: title }) : null;
  const subtitleEl = subtitle ? el('p', { className: 'hint', text: subtitle }) : null;
  const cornerEl = cornerCaption ? el('div', { className: 'card-corner-caption', text: cornerCaption }) : null;
  
  return el('div', {
    className: `card ${className}`.trim(),
    id,
    children: [cornerEl, titleEl, subtitleEl, ...children].filter(Boolean)
  });
}
