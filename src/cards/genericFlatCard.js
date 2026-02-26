// Generic flat card: renders an object's top-level keys as labeled rows.
// Styling mirrors the kanji full card (reuses .kanji-full-row/.kanji-full-label/.kanji-full-value).
export function createGenericFlatCard({ entry = null, config = {} } = {}) {
  console.log('[Card:Generic] createGenericFlatCard()', { entry, config });
  const root = document.createElement('div');
  root.className = 'card generic-flat-card';

  const body = document.createElement('div');
  body.className = 'generic-flat-body';

  root.appendChild(body);

  function makeRow(labelText) {
    const row = document.createElement('div');
    row.className = 'kanji-full-row';
    const label = document.createElement('div');
    label.className = 'kanji-full-label';
    label.textContent = labelText || '';
    const value = document.createElement('div');
    value.className = 'kanji-full-value';
    row.append(label, value);
    return { row, label, value };
  }

  // Maintain rows map so setFieldsVisible can operate similarly to kanjiFullCard
  let rows = {};

  function formatValue(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) return v.join(', ');
    // Avoid JSON.stringify to prevent unexpected exceptions (circular structures). Use generic string conversion.
    return String(v);
  }

  function setEntry(e) {
    console.log('[Card:Generic] setEntry()', e);
    const entryObj = e || {};
    rows = {};
    body.innerHTML = '';

    // Preserve the object's own key order (do not sort)
    const keys = Object.keys(entryObj || {});
    for (const k of keys) {
      const { row, label, value } = makeRow(k);
      value.textContent = formatValue(entryObj[k]);
      rows[k] = { row, label, value };
      body.appendChild(row);
    }
  }

  function setFieldVisible(field, visible) {
    const v = !!visible;
    const k = String(field || '');
    const r = rows[k];
    if (!r) return;
    r.value.style.visibility = v ? '' : 'hidden';
  }

  function setFieldsVisible(map) {
    if (!map || typeof map !== 'object') return;
    for (const k of Object.keys(map)) setFieldVisible(k, !!map[k]);
  }

  function setVisible(visible) {
    root.style.display = visible ? '' : 'none';
  }

  function destroy() {
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  // initialize
  setEntry(entry);

  // Provide a metadata-driven toggle descriptor so views can build per-card dropdowns.
  function getToggleFields(metadata) {
    console.log('[Card:Generic] getToggleFields()', { metadataKeys: metadata ? Object.keys(metadata) : null });
    if (!metadata || typeof metadata !== 'object') return [];
    const fields = Array.isArray(metadata.fields) ? metadata.fields : (Array.isArray(metadata.schema) ? metadata.schema : []);
    if (!Array.isArray(fields) || !fields.length) return [];
    return fields.map(f => ({ value: String(f.key || f), left: f.label || String(f.key || f), right: 'Visible' }));
  }

  return { el: root, setEntry, setFieldVisible, setFieldsVisible, setVisible, getToggleFields, destroy };
}

// Export a simple set of toggleable fields (empty by default — apps can use keys)
export const genericFlatCardToggleFields = [];
