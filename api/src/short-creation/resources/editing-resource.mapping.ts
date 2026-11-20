import { editorialResourcePreferences } from '../short-editorial.schema';
import { getResourceDefinition } from './editing-resource.registry';
import type { EditorialContext } from '../knowledge/editorial-knowledge.types';
import type { ResourceCapability } from './editing-resource.types';
// Resolve conceptual aliases without modifying the 63 authored editorial directives.
const aliases: Readonly<Record<string, readonly string[]>> = {
  REPLAY: ['REPEAT_SEGMENT'],
  COLOR_FILTER: [
    'BRIGHTNESS',
    'CONTRAST',
    'SATURATION',
    'GAMMA',
    'COLOR_TEMPERATURE',
    'GRAYSCALE',
    'SEPIA',
  ],
  MOVEMENT_TRANSITION: ['SLIDE_TRANSITION'],
};
export function resolveResourceIntent(
  intent: string,
  capabilities: readonly ResourceCapability[],
) {
  const ids = aliases[intent] ?? [intent];
  return {
    intent,
    resources: ids.map((id) => {
      const definition = getResourceDefinition(id),
        capability = capabilities.find((item) => item.id === id);
      return {
        id,
        version: definition.version,
        registered: true,
        available: capability?.available ?? false,
      };
    }),
  };
}
export function knowledgeResourceCorrespondence(
  context: EditorialContext,
  capabilities: readonly ResourceCapability[],
) {
  return context.guidance.map((rule) => ({
    guidanceId: rule.id,
    origin: rule.origin,
    level: rule.level,
    resources: rule.resourceIntents.map((intent) =>
      resolveResourceIntent(intent, capabilities),
    ),
  }));
}
const preferences = {
  titles: ['FIXED_TITLE', 'TEMPORARY_TEXT'],
  captions: ['CAPTIONS', 'WORD_HIGHLIGHT'],
  textOverlays: ['TEMPORARY_TEXT', 'STYLED_TEXT'],
  emojis: ['EMOJI'],
  dynamicZoom: ['DYNAMIC_ZOOM'],
  cameraShake: ['CAMERA_SHAKE'],
  motionBlur: ['MOTION_BLUR'],
  soundEffects: ['SOUND_EFFECT'],
  originalAudio: ['ORIGINAL_AUDIO'],
} satisfies Record<
  (typeof editorialResourcePreferences)[number]['id'],
  readonly string[]
>;
/** Correspondence only; AUTO/PREFER/AVOID never trigger execution or change parameters. */
export function preferenceResourceCorrespondence(
  capabilities: readonly ResourceCapability[],
) {
  return Object.entries(preferences).map(([preference, ids]) => ({
    preference,
    interpretation: 'EDITORIAL_INTENT_ONLY',
    resources: ids.map(
      (id) => resolveResourceIntent(id, capabilities).resources[0],
    ),
  }));
}
