// Simple helper to create a standardized header tools container for any view.
// Replaces the previous kanji-specific header container.
export function createViewHeaderTools() {
  const el = document.createElement('div');
  el.className = 'view-header-tools';
  return el;
}
