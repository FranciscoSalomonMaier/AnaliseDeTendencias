import { editorialKnowledgeProfileSchema } from './editorial-knowledge.schema';
import type {
  EditorialKnowledgeProfile,
  KnowledgeAxis,
} from './editorial-knowledge.types';
import { shortClassificationCatalogs } from '../classification/short-classification.catalog';
import { topXKnowledge } from './profiles/video-types/top-x.knowledge';
import { humorKnowledge } from './profiles/video-topics/humor.knowledge';
import { dynamicKnowledge } from './profiles/editing-styles/dynamic.knowledge';

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
/** Validate once, detach from caller-owned data, and protect the static registry. */
export function defineKnowledgeRegistry(
  input: readonly EditorialKnowledgeProfile[],
): readonly EditorialKnowledgeProfile[] {
  const profiles = input.map((profile) =>
    editorialKnowledgeProfileSchema.parse(profile),
  );
  if (
    new Set(
      profiles.map((profile) => `${profile.axis}:${profile.classificationId}`),
    ).size !== profiles.length ||
    new Set(profiles.map((profile) => profile.profileId)).size !==
      profiles.length
  )
    throw new Error('Perfis editoriais duplicados.');
  return freeze(profiles);
}
export const editorialKnowledgeRegistry = defineKnowledgeRegistry([
  topXKnowledge,
  humorKnowledge,
  dynamicKnowledge,
]);
/** Every catalog entry is registered, including entries without authored knowledge.
 * Functional availability is read exclusively from the existing classification catalog. */
export function listEditorialKnowledgeProfiles() {
  const axes = [
    ['videoType', shortClassificationCatalogs.videoTypes],
    ['videoTopic', shortClassificationCatalogs.videoTopics],
    ['editingStyle', shortClassificationCatalogs.editingStyles],
  ] as const;
  return axes.flatMap(([axis, catalog]) =>
    catalog.map((item) => {
      const profile = getEditorialKnowledge(axis, item.id);
      return {
        axis,
        classificationId: item.id,
        knowledgeStatus: profile
          ? ('DEFINED' as const)
          : ('UNDEFINED' as const),
        profileId: profile?.profileId ?? null,
        profileVersion: profile?.profileVersion ?? null,
        available: item.available,
      };
    }),
  );
}
export function getEditorialKnowledge(
  axis: KnowledgeAxis,
  classificationId: string,
): EditorialKnowledgeProfile | null {
  const catalog: readonly { id: string }[] =
    axis === 'videoType'
      ? shortClassificationCatalogs.videoTypes
      : axis === 'videoTopic'
        ? shortClassificationCatalogs.videoTopics
        : axis === 'editingStyle'
          ? shortClassificationCatalogs.editingStyles
          : [];
  if (!catalog.some((item) => item.id === classificationId))
    throw new Error('Classificação editorial inexistente.');
  return (
    editorialKnowledgeRegistry.find(
      (profile) =>
        profile.axis === axis && profile.classificationId === classificationId,
    ) ?? null
  );
}
