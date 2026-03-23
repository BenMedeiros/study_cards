import { validateDuplicatedKeys } from '../../utils/common/collectionValidations.mjs';

export function buildDuplicatedKeysReport({ records, loadErrors = [] } = {}) {
  const report = validateDuplicatedKeys(Array.isArray(records) ? records : []);
  report.loadErrors = Array.isArray(loadErrors) ? loadErrors.slice() : [];
  return report;
}

export default buildDuplicatedKeysReport;
