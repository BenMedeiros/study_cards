import { validateMissingRelatedCollectionData } from '../../utils/common/collectionValidations.mjs';

export function buildMissingRelatedCollectionDataReport({ records, loadErrors = [] } = {}) {
  const report = validateMissingRelatedCollectionData(Array.isArray(records) ? records : []);
  report.loadErrors = Array.isArray(loadErrors) ? loadErrors.slice() : [];
  return report;
}

export default buildMissingRelatedCollectionDataReport;
