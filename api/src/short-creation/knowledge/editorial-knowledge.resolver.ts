import { shortClassificationSchema } from '../classification/short-classification.schema';
import {
  editorialContextSchema,
  EDITORIAL_KNOWLEDGE_VERSION,
} from './editorial-knowledge.schema';
import {
  defineKnowledgeRegistry,
  editorialKnowledgeRegistry,
} from './editorial-knowledge.registry';
import type {
  EditorialContext,
  EditorialConflict,
  EditorialKnowledgeProfile,
  KnowledgeAxis,
  KnowledgeOrigin,
} from './editorial-knowledge.types';

import { soundEffectKnowledge } from './sound-effect.knowledge';

const axes: KnowledgeAxis[] = ['videoType', 'videoTopic', 'editingStyle'];
const priority = { EDITORIAL: 0, STRUCTURAL: 1, TECHNICAL: 2, SAFETY: 2 };
const negative = (level: string) =>
  ['DISCOURAGED', 'FORBIDDEN'].includes(level);
/** Conservative, pairwise detection on a shared semantic target. No NLP or implicit overwrite.
 * Different conditions may coexist; equal-priority contradictions remain unresolved. */
function findConflicts(
  guidance: EditorialContext['guidance'],
): EditorialConflict[] {
  const conflicts: EditorialConflict[] = [];
  for (let i = 0; i < guidance.length; i++)
    for (let j = i + 1; j < guidance.length; j++) {
      const a = guidance[i],
        b = guidance[j];
      if (
        a.target !== b.target ||
        negative(a.level) === negative(b.level) ||
        ((a.level === 'OPTIONAL' || b.level === 'OPTIONAL') &&
          a.level !== 'FORBIDDEN' &&
          b.level !== 'FORBIDDEN')
      )
        continue;
      const reference = (rule: typeof a) => ({
        id: rule.id,
        origin: rule.origin,
      });
      const aPriority = priority[a.kind],
        bPriority = priority[b.kind];
      const contextual =
        a.kind === 'EDITORIAL' &&
        b.kind === 'EDITORIAL' &&
        (a.conditions.length > 0 || b.conditions.length > 0) &&
        JSON.stringify([...a.conditions].sort()) !==
          JSON.stringify([...b.conditions].sort());
      const preferred =
        aPriority === bPriority ? null : aPriority > bPriority ? a : b;
      conflicts.push({
        target: a.target,
        guidance: [reference(a), reference(b)],
        status: preferred
          ? 'PRIORITIZED'
          : contextual
            ? 'CONTEXTUAL'
            : 'UNRESOLVED',
        reason: preferred
          ? 'Preservar a restrição de maior prioridade; ambas as orientações e suas condições permanecem explícitas.'
          : contextual
            ? 'As condições diferem; contextualizar a preferência sem eliminar a orientação de preservação do conteúdo.'
            : 'Orientações opostas de mesma prioridade exigem revisão editorial.',
        preferredGuidance: preferred ? reference(preferred) : null,
      });
    }
  return conflicts;
}
export function resolveEditorialKnowledge(
  input: unknown,
  registry: readonly EditorialKnowledgeProfile[] = editorialKnowledgeRegistry,
): EditorialContext {
  const classification = shortClassificationSchema.parse(input);
  const validated = defineKnowledgeRegistry(registry);
  const profiles: KnowledgeOrigin[] = [];
  const missingProfiles: EditorialContext['missingProfiles'] = [];
  const guidance: EditorialContext['guidance'] = [];
  for (const axis of axes) {
    const classificationId = classification[axis];
    const profile = validated.find(
      (item) =>
        item.axis === axis && item.classificationId === classificationId,
    );
    if (!profile) {
      missingProfiles.push({
        axis,
        classificationId,
        status: 'REGISTERED_WITHOUT_KNOWLEDGE',
      });
      continue;
    }
    const origin: KnowledgeOrigin = {
      axis,
      classificationId,
      profileId: profile.profileId,
      profileVersion: profile.profileVersion,
      knowledgeVersion: profile.knowledgeVersion,
    };
    profiles.push(origin);
    for (const rule of profile.guidance) guidance.push({ ...rule, origin });
  }
  return editorialContextSchema.parse({
    knowledgeVersion: EDITORIAL_KNOWLEDGE_VERSION,
    classification,
    usage: 'EDITORIAL_CONTEXT_ONLY',
    knowledgeStatus:
      missingProfiles.length === 0
        ? 'COMPLETE'
        : profiles.length === 0
          ? 'MISSING'
          : 'PARTIAL',
    profiles,
    missingProfiles,
    guidance,
    conflicts: findConflicts(guidance),
    soundEffects: soundEffectKnowledge.filter((effect) =>
      guidance.some((rule) => rule.soundEffectIntents.includes(effect.id)),
    ),
  });
}
/** Legacy projects are intentionally left unclassified. No writes, defaults, or jobs. */
export function resolveProjectEditorialKnowledge(data: {
  classification?: unknown;
}): EditorialContext | null {
  return data.classification === undefined
    ? null
    : resolveEditorialKnowledge(data.classification);
}
