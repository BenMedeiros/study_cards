// Helper to add a study-filter dropdown into a view headerTools
// Usage: addStudyFilter(headerTools, { getCurrentCollectionKey, onChange })
import collectionSettingsController from '../controllers/collectionSettingsController.js';

export function addStudyFilter(headerTools, { getCurrentCollectionKey, onChange } = {}) {
  if (!headerTools || typeof headerTools.addElement !== 'function') return null;

  const STUDY_FILTER_ITEMS = [
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

  // derive initial selection from persisted collection settings
  let initialStudyFilterValues = ['null', 'focus', 'learned'];
  const key = (typeof getCurrentCollectionKey === 'function') ? getCurrentCollectionKey() : null;
  if (key) {
    const st = collectionSettingsController.get(key) || {};
    const saved = typeof st.studyFilter === 'string' ? String(st.studyFilter).trim() : null;
    if (saved) {
      if (saved === 'all') initialStudyFilterValues = ['null', 'focus', 'learned'];
      else initialStudyFilterValues = orderStudyStates(saved.split(/[,|\s]+/));
    }
  }

  return headerTools.addElement({
    type: 'dropdown', key: 'studyFilter', items: STUDY_FILTER_ITEMS, multi: true,
    values: Array.isArray(initialStudyFilterValues) ? initialStudyFilterValues.slice() : ['null', 'focus', 'learned'],
    commitOnClose: true,
    getButtonLabel: ({ selectedValues }) => formatStudyFilterButtonLabel(selectedValues),
    onChange: (vals) => {
      const chosen = (typeof vals === 'string' && vals === 'all') ? ['null', 'focus', 'learned'] : (Array.isArray(vals) ? vals.slice() : []);
      const ordered = orderStudyStates(chosen);
      const key = (typeof getCurrentCollectionKey === 'function') ? getCurrentCollectionKey() : null;
      if (key) {
        collectionSettingsController.set(key, { studyFilter: ordered.join(',') });
      }
      if (typeof onChange === 'function') onChange(ordered);
    },
    includeAllNone: true,
    className: 'data-expansion-dropdown',
    caption: 'col.study-filter'
  });
}
