import { createJsonViewer } from '../components/jsonViewer.js';

// Simple card that renders the full entry using the reusable JSON viewer.
export function createJsonViewerCard({ entry = null, config = {} } = {}) {
  const root = document.createElement('div');
  root.className = 'card json-viewer-card';

  const body = document.createElement('div');
  body.className = 'json-viewer-body';
  root.appendChild(body);

  let current = null;

  function setEntry(e) {
    current = e;
    body.innerHTML = '';
    const viewer = createJsonViewer(current, { expanded: true, showToggle: true });
    body.appendChild(viewer);
  }

  function setVisible(visible) {
    root.style.display = visible ? '' : 'none';
  }

  function destroy() {
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  // initialize
  setEntry(entry);

  return { el: root, setEntry, setVisible, destroy };
}

// No toggle fields; visibility is controlled by the view layer now.
