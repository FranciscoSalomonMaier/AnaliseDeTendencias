import type { EditorialGuidance } from '../editorial-knowledge.types';
/** Compact authoring helper; validation remains in the shared Zod contract. */
export function guidance(
  id: string,
  category: string,
  target: string,
  level: EditorialGuidance['level'],
  instruction: string,
  options: Partial<
    Pick<
      EditorialGuidance,
      'kind' | 'conditions' | 'resourceIntents' | 'soundEffectIntents'
    >
  > = {},
): EditorialGuidance {
  return {
    id,
    category,
    target,
    level,
    instruction,
    kind: 'EDITORIAL',
    conditions: [],
    resourceIntents: [],
    soundEffectIntents: [],
    ...options,
  };
}
