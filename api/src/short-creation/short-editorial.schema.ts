import { z } from 'zod';
import { shortClassificationSchema } from './classification/short-classification.schema';
import { resolveEditorialKnowledge } from './knowledge/editorial-knowledge.resolver';

export const editingModeSchema = z.enum([
  'LEGACY_REFERENCE',
  'EDITORIAL_CLASSIFICATION',
]);
export const EDITORIAL_INSTRUCTIONS_MAX = 3000;
// Preference controls describe intention only. They never advertise executable capabilities.
export const editorialResourcePreferences = [
  {
    id: 'titles',
    label: 'Títulos',
    description: 'Utilização de títulos durante o vídeo.',
  },
  {
    id: 'captions',
    label: 'Legendas',
    description: 'Apresentação de legendas.',
  },
  {
    id: 'textOverlays',
    label: 'Textos sobrepostos',
    description: 'Informações complementares.',
  },
  { id: 'emojis', label: 'Emojis', description: 'Emojis contextualizados.' },
  {
    id: 'dynamicZoom',
    label: 'Zoom dinâmico',
    description: 'Aproximações e afastamentos de imagem.',
  },
  {
    id: 'cameraShake',
    label: 'Tremor de câmera',
    description: 'Movimentos rápidos de câmera.',
  },
  {
    id: 'motionBlur',
    label: 'Motion blur',
    description: 'Desfoque de movimento.',
  },
  {
    id: 'soundEffects',
    label: 'Efeitos sonoros',
    description: 'Sons complementares.',
  },
  {
    id: 'originalAudio',
    label: 'Áudio original',
    description: 'Preservação do áudio dos vídeos enviados.',
  },
] as const;
const preference = z.enum(['AUTO', 'PREFER', 'AVOID']);
const resourceShape = Object.fromEntries(
  editorialResourcePreferences.map(({ id }) => [
    id,
    preference.default('AUTO'),
  ]),
) as {
  [K in (typeof editorialResourcePreferences)[number]['id']]: z.ZodDefault<
    typeof preference
  >;
};
export const editorialPreferencesSchema = z
  .object({
    version: z.literal(1),
    additionalInstructions: z
      .string()
      .trim()
      .max(EDITORIAL_INSTRUCTIONS_MAX)
      .default(''),
    cutRhythm: z.enum(['AUTO', 'SLOW', 'MODERATE', 'FAST']).default('AUTO'),
    resources: z
      .object(resourceShape)
      .strict()
      .default(
        () =>
          Object.fromEntries(
            editorialResourcePreferences.map(({ id }) => [id, 'AUTO']),
          ) as z.infer<z.ZodObject<typeof resourceShape>>,
      ),
  })
  .strict();
export type EditorialPreferences = z.infer<typeof editorialPreferencesSchema>;
export type EditingMode = z.infer<typeof editingModeSchema>;
export interface EditorialReview {
  version: 1;
  configurationRevision: number;
  approvedRevision: number | null;
}
export interface EditorialMetadata {
  editingMode?: EditingMode;
  classification?: unknown;
  editorialPreferences?: EditorialPreferences;
  editorialReview?: EditorialReview;
}
export const effectiveEditingMode = (data: EditorialMetadata): EditingMode =>
  data.editingMode ?? 'LEGACY_REFERENCE';
export const EDITORIAL_DEVELOPMENT_MESSAGE =
  'A execução da nova configuração de edição ainda está em desenvolvimento. Para continuar produzindo, escolha o fluxo legado de referências.';
export const editorialPreferenceOptions = {
  version: 1,
  maxInstructionsLength: EDITORIAL_INSTRUCTIONS_MAX,
  resources: editorialResourcePreferences,
  states: [
    { id: 'AUTO', label: 'Automático' },
    { id: 'PREFER', label: 'Preferir' },
    { id: 'AVOID', label: 'Evitar' },
  ],
  cutRhythms: [
    { id: 'AUTO', label: 'Automático' },
    { id: 'SLOW', label: 'Lento' },
    { id: 'MODERATE', label: 'Moderado' },
    { id: 'FAST', label: 'Rápido' },
  ],
};
/** Completeness, approval and execution are deliberately separate. No capability inference.
 * Execution remains blocked at the integration boundary until the new engine is implemented. */
export function editorialConfigurationStatus(data: EditorialMetadata) {
  const parsed = shortClassificationSchema.safeParse(data.classification);
  const revision = data.editorialReview?.configurationRevision ?? 0;
  return {
    mode: effectiveEditingMode(data),
    complete: parsed.success,
    saved: parsed.success,
    approved:
      parsed.success &&
      revision > 0 &&
      data.editorialReview?.approvedRevision === revision,
    configurationRevision: revision,
    executionAvailable: false,
    knowledgeStatus: parsed.success
      ? resolveEditorialKnowledge(parsed.data).knowledgeStatus
      : null,
  };
}
