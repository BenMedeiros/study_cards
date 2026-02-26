// Helper to add a study-filter dropdown into a view headerTools
// Usage: addStudyFilter(headerTools, { store, getCurrentCollectionKey, collState, onChange })
export function addStudyFilter(headerTools, { store, getCurrentCollectionKey, collState = {}, onChange } = {}) {
  if (!headerTools || typeof headerTools.addElement !== 'function') return null;

  const STUDY_FILTER_ITEMS = [
    { kind: 'action', action: 'toggleAllNone', value: '__toggle__', label: '(all/none)' },
    { value: 'null', label: 'null', left: 'state', right: 'null' },
    { value: 'focus', label: 'focus', left: 'state', right: 'focus' },
    { value: 'learned', label: 'learned', left: 'state', right: 'learned' },
  ];

  function orderStudyStates(values) {
    const order = ['null', 'focus', 'learned'];
    const arr = Array.isArray(values) ? values : (typeof values === 'string' ? String(values).split(/[,|\s]+/) : []);
    const set = new Set(arr.map(v => String(v || '').trim()).filter(Boolean));
    return order.filter(v => set.has(v));
  }

  function formatStudyFilterButtonLabel(selectedValues) {
    const ordered = orderStudyStates(selectedValues);
    if (!ordered.length) return 'none';
    if (ordered.length === 3) return 'all';
    if (ordered.length >= 2) return `${ordered.length} selected`;
    return ordered[0];
  }

  // derive initial selection from provided collState if present
  let initialStudyFilterValues = ['null', 'focus', 'learned'];
  try {
    const saved = collState && typeof collState.studyFilter === 'string' ? String(collState.studyFilter).trim() : null;
    if (saved) {
      if (saved === 'all') initialStudyFilterValues = ['null', 'focus', 'learned'];
      else initialStudyFilterValues = orderStudyStates(saved.split(/[,|\s]+/));
    } else if (typeof collState?.skipLearned === 'boolean' || typeof collState?.focusOnly === 'boolean') {
      if (collState.focusOnly) initialStudyFilterValues = ['focus'];
      else if (collState.skipLearned) initialStudyFilterValues = ['null', 'focus'];
    }
  } catch (e) {}

  return headerTools.addElement({
    type: 'dropdown', key: 'studyFilter', items: STUDY_FILTER_ITEMS, multi: true,
    values: Array.isArray(initialStudyFilterValues) ? initialStudyFilterValues.slice() : ['null', 'focus', 'learned'],
    commitOnClose: true,
    getButtonLabel: ({ selectedValues }) => formatStudyFilterButtonLabel(selectedValues),
    onChange: (vals) => {
      const chosen = (typeof vals === 'string' && vals === 'all') ? ['null', 'focus', 'learned'] : (Array.isArray(vals) ? vals.slice() : []);
      const ordered = orderStudyStates(chosen);
      try {
        const key = (typeof getCurrentCollectionKey === 'function') ? getCurrentCollectionKey() : (store?.collections?.getActiveCollection?.()?.key || null);
        if (key && store?.collections && typeof store.collections.setStudyFilter === 'function') {
          store.collections.setStudyFilter(key, { states: ordered });
        }
      } catch (e) {}
      try { if (typeof onChange === 'function') onChange(ordered); } catch (e) {}
    },
    className: 'data-expansion-dropdown',
    caption: 'col.study-filter'
  });
}
