export function renderPlaceholderTool({ title, hint }) {
  const el = document.createElement('div');
  el.className = 'card';
  el.innerHTML = `
    <h2>${title}</h2>
    <p class="hint">${hint}</p>
  `;
  return el;
}
