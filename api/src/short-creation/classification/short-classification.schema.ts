import { z } from 'zod';
import { SHORT_CLASSIFICATION_VERSION } from './catalog-entry';
import { videoTypes } from './video-types.catalog';
import { videoTopics } from './video-topics.catalog';
import { editingStyles } from './editing-styles.catalog';
export const videoTypeSchema = z.enum(videoTypes.map((item) => item.id));
export const videoTopicSchema = z.enum(videoTopics.map((item) => item.id));
export const editingStyleSchema = z.enum(editingStyles.map((item) => item.id));
/** Metadata contract: registration is sufficient to store an editorial intention. */
export const shortClassificationSchema = z
  .object({
    version: z.literal(SHORT_CLASSIFICATION_VERSION),
    videoType: videoTypeSchema,
    videoTopic: videoTopicSchema,
    editingStyle: editingStyleSchema,
  })
  .strict();
export type ShortClassification = z.infer<typeof shortClassificationSchema>;
export type VideoType = z.infer<typeof videoTypeSchema>;
export type VideoTopic = z.infer<typeof videoTopicSchema>;
export type EditingStyle = z.infer<typeof editingStyleSchema>;
/** Separate capability gate; intentionally not used by metadata-only POST/PATCH.
 * This does not implement a planner or guarantee future combination compatibility. */
export const availableShortClassificationSchema =
  shortClassificationSchema.superRefine((value, ctx) => {
    for (const [field, catalog] of [
      ['videoType', videoTypes],
      ['videoTopic', videoTopics],
      ['editingStyle', editingStyles],
    ] as const) {
      if (!catalog.find((item) => item.id === value[field])?.available)
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message:
            'Classificação registrada, mas ainda indisponível para execução editorial.',
        });
    }
  });
