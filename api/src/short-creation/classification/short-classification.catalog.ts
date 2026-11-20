import { SHORT_CLASSIFICATION_VERSION } from './catalog-entry';
import { videoTypes } from './video-types.catalog';
import { videoTopics } from './video-topics.catalog';
import { editingStyles } from './editing-styles.catalog';
/** Catalogued intentions may be persisted; available advertises functional support only. */
export const shortClassificationCatalogs = Object.freeze({
  version: SHORT_CLASSIFICATION_VERSION,
  usage: 'EDITORIAL_INTENT_ONLY' as const,
  videoTypes,
  videoTopics,
  editingStyles,
});
