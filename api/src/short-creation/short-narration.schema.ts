import { z } from 'zod';

export const narrationSchema = z
  .object({
    version: z.literal(1),
    mode: z.enum(['WITH_NARRATION', 'WITHOUT_NARRATION']),
  })
  .strict();
export type NarrationConfiguration = z.infer<typeof narrationSchema>;
export function resolveNarrationMode(data: {
  narration?: NarrationConfiguration;
}) {
  return data.narration?.mode ?? 'WITH_NARRATION';
}
export const UNNARRATED_RENDER_MESSAGE =
  'A montagem, a trilha sonora e a renderização sem narração ainda não estão disponíveis no fluxo atual. A escolha foi salva; texto e geração de voz estão dispensados.';
export function narrationJobBlock(
  data: { narration?: NarrationConfiguration },
  kind: string,
) {
  if (resolveNarrationMode(data) !== 'WITHOUT_NARRATION') return null;
  if (['TEXT', 'AUDIO'].includes(kind))
    return 'Narração dispensada. Ative Com narração para gerar texto ou voz.';
  if (['PLAN', 'RENDER'].includes(kind)) return UNNARRATED_RENDER_MESSAGE;
  return null;
}
