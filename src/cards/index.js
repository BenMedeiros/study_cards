import { createKanjiMainCard, kanjiMainCardToggleFields } from './kanjiMainCard.js';
import { createKanjiRelatedCard, kanjiExampleCardToggleFields } from './kanjiExampleCard.js';
import { createKanjiFullCard, kanjiFullCardToggleFields } from './kanjiFullCard.js';
import { createGenericFlatCard, genericFlatCardToggleFields } from './genericFlatCard.js';

// Export individual factories/fields for backwards compatibility
export { createKanjiMainCard, kanjiMainCardToggleFields };
export { createKanjiRelatedCard, kanjiExampleCardToggleFields };
export { createKanjiFullCard, kanjiFullCardToggleFields };
export { createGenericFlatCard, genericFlatCardToggleFields };

// Card registry used by views to auto-discover available card types.
export const CARD_REGISTRY = [
	{ key: 'main', label: 'Main Card', factory: createKanjiMainCard, toggleFields: kanjiMainCardToggleFields },
	{ key: 'related', label: 'Related Card', factory: createKanjiRelatedCard, toggleFields: kanjiExampleCardToggleFields },
	{ key: 'full', label: 'Full Details', factory: createKanjiFullCard, toggleFields: kanjiFullCardToggleFields },
	{ key: 'generic', label: 'Generic', factory: createGenericFlatCard, toggleFields: genericFlatCardToggleFields },
];
