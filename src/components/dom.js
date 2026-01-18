/**
 * Simplified DOM element creation
 * @param {string} tag - HTML tag name
 * @param {Object} options - Element configuration
 * @param {string} options.className - CSS class(es)
 * @param {string} options.id - Element ID
 * @param {string} options.text - Text content
 * @param {string} options.html - Inner HTML
 * @param {Object} options.style - Inline styles
 * @param {Object} options.attrs - Additional attributes
 * @param {Array} options.children - Child elements/nodes
 * @returns {HTMLElement}
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
 * @param {string} key - Label text
 * @param {string} value - Value text
 * @returns {HTMLElement}
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
 * @param {string} value - Input string
 * @returns {string} Sanitized ID
 */
export function safeId(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}
