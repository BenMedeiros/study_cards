import { el } from './dom.js';

/**
 * Create a card component with optional title and subtitle
 * @param {Object} options
 * @param {string} options.title - Card title (h2)
 * @param {string} options.subtitle - Card subtitle (hint)
 * @param {string} options.className - Additional CSS classes
 * @param {string} options.id - Card ID
 * @param {Array} options.children - Child elements
 * @returns {HTMLElement}
 */
export function card({ title, subtitle, className = '', id, children = [] }) {
  const titleEl = title ? el('h2', { text: title }) : null;
  const subtitleEl = subtitle ? el('p', { className: 'hint', text: subtitle }) : null;
  
  return el('div', {
    className: `card ${className}`.trim(),
    id,
    children: [titleEl, subtitleEl, ...children].filter(Boolean)
  });
}
