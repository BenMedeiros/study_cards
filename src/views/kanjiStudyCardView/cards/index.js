import { createKanjiMainCard } from './kanjiMainCard.js';
import { createKanjiRelatedCard } from './kanjiExampleCard.js';
import { createKanjiFullCard } from './kanjiFullCard.js';
import { createGenericFlatCard } from './genericFlatCard.js';
import { createJsonViewerCard } from './jsonViewerCard.js';

// Card registry used by views to auto-discover available card types.
export const CARD_REGISTRY = [
    { key: 'main', label: 'Main Card', factory: createKanjiMainCard, toggleFields: [] },
    { key: 'related', label: 'Related Card', factory: createKanjiRelatedCard, toggleFields: [] },
    { key: 'full', label: 'Full Details', factory: createKanjiFullCard, toggleFields: [] },
    { key: 'generic', label: 'Generic', factory: createGenericFlatCard, toggleFields: [] },
    { key: 'json', label: 'JSON Viewer', factory: createJsonViewerCard, toggleFields: [] },
];
