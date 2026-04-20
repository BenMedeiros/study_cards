import { idbGetAll, idbPut } from '../utils/browser/idb.js';
import { resolveStudyRecordState } from '../utils/common/studyProgressState.js';

const MIGRATION_ID = 'study_progress_seen_to_state_v1';

function cloneObject(value) {
  return (value && typeof value === 'object' && !Array.isArray(value)) ? { ...value } : {};
}

function normalizeValue(value) {
  return String(value ?? '').trim();
}

export const studyProgressSeenStateMigration = {
  id: MIGRATION_ID,
  version: 1,
  async run() {
    const rows = await idbGetAll('study_progress').catch(() => []);
    if (!Array.isArray(rows) || !rows.length) {
      return { id: MIGRATION_ID, updatedCount: 0 };
    }

    let updatedCount = 0;
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const id = normalizeValue(row.id);
      if (!id) continue;

      const currentValue = cloneObject(row.value);
      const nextState = resolveStudyRecordState(currentValue);
      const hasLegacySeenField = Object.prototype.hasOwnProperty.call(currentValue, 'seen');
      const normalizedCurrentState = normalizeValue(currentValue.state) || null;
      const normalizedNextState = normalizeValue(nextState) || null;
      const shouldUpdate = hasLegacySeenField || normalizedCurrentState !== normalizedNextState;
      if (!shouldUpdate) continue;

      const nextValue = { ...currentValue };
      if (normalizedNextState) nextValue.state = normalizedNextState;
      else delete nextValue.state;
      delete nextValue.seen;

      await idbPut('study_progress', {
        ...row,
        value: nextValue,
      });
      updatedCount += 1;
    }

    return { id: MIGRATION_ID, updatedCount };
  },
};
