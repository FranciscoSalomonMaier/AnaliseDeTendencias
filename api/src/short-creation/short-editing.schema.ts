import { z } from 'zod';
import type {
  TimedText,
  SubtitleSegment,
} from '../content-subtitles/subtitle.schema';
export const editingFeatures = [
  'speechSpeed',
  'speechStyle',
  'cutPace',
  'captions',
  'overlays',
  'zoom',
  'transitions',
  'soundEffects',
  'music',
] as const;
export const featureSelection = z
  .array(z.enum(editingFeatures))
  .max(9)
  .refine((v) => new Set(v).size === v.length, 'Características duplicadas');
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const nullableNumber = (min: number, max: number) =>
  z.number().finite().min(min).max(max).nullable();
export const visualEditingSchema = z
  .object({
    captions: z.object({
      present: z.boolean().nullable(),
      position: z.enum(['TOP', 'CENTER', 'BOTTOM']).nullable(),
      fontSize: nullableNumber(24, 96),
      bold: z.boolean().nullable(),
      primaryColor: color.nullable(),
      highlightColor: color.nullable(),
      outline: z.boolean().nullable(),
      shadow: z.boolean().nullable(),
      wordsPerGroup: z.number().int().min(1).max(8).nullable(),
      highlightWord: z.boolean().nullable(),
      animated: z.boolean().nullable(),
    }),
    overlays: z.object({
      present: z.boolean().nullable(),
      position: z.enum(['TOP', 'CENTER', 'BOTTOM']).nullable(),
      frequency: z.enum(['SPARSE', 'MODERATE']).nullable(),
      types: z
        .array(z.enum(['TITLE', 'DATE', 'NAME', 'KEYWORD', 'FACT', 'QUESTION']))
        .max(6),
    }),
    zoom: z.object({
      mode: z.enum(['IN', 'OUT', 'NONE']).nullable(),
      frequency: z.enum(['OCCASIONAL', 'FREQUENT']).nullable(),
    }),
    transition: z.enum(['CUT', 'FADE', 'CROSSFADE']).nullable(),
    confidence: z.number().min(0).max(1),
    unknown: z.array(z.string().max(200)).max(20),
  })
  .strict();
export type VisualEditing = z.infer<typeof visualEditingSchema>;
export const editingConfigSchema = z
  .object({
    wordsPerMinute: z.number().min(80).max(240).nullable(),
    narrationStyle: z.enum([
      'NEUTRAL',
      'DYNAMIC',
      'INFORMATIVE',
      'DOCUMENTARY',
      'DRAMATIC',
      'RELAXED',
      'INVESTIGATIVE',
      'EXPLANATORY',
    ]),
    pauseSeconds: z.number().min(0).max(2).nullable(),
    shotSeconds: z.number().min(1).max(12).nullable(),
    captions: z
      .object({
        enabled: z.boolean(),
        highlightWord: z.boolean(),
        wordsPerGroup: z.number().int().min(1).max(8),
        fontSize: z.number().int().min(24).max(80),
        bold: z.boolean(),
        primaryColor: color,
        highlightColor: color,
        outline: z.number().min(0).max(6),
        shadow: z.number().min(0).max(6),
        position: z.enum(['TOP', 'CENTER', 'BOTTOM']),
      })
      .strict(),
    overlays: z
      .object({
        enabled: z.boolean(),
        frequency: z.enum(['SPARSE', 'MODERATE']),
      })
      .strict(),
    zoom: z.enum(['NONE', 'IN', 'OUT']),
    transition: z.enum(['CUT', 'FADE']),
  })
  .strict();
export type EditingConfig = z.infer<typeof editingConfigSchema>;
export interface ReferenceProfile {
  fileId: string;
  name: string;
  duration: number;
  analyzedSeconds: number;
  cached?: boolean;
  speech: {
    words: number | null;
    averageWpm: number | null;
    activeWpm: number | null;
    pauseCount: number | null;
    meanPause: number | null;
    granularity: 'WORD' | 'SEGMENT' | null;
  };
  cuts: {
    count: number;
    mean: number;
    median: number;
    perMinute: number;
    variation: number;
    pace: string;
    quarterCounts: number[];
  };
  visual: VisualEditing;
  limitations: string[];
}
export interface EditingState {
  enabled: boolean;
  features: Array<(typeof editingFeatures)[number]>;
  profiles?: ReferenceProfile[];
  config?: EditingConfig;
  approved?: boolean;
  notes?: string[];
}
export interface TextOverlay {
  text: string;
  start: number;
  end: number;
  position: 'TOP' | 'BOTTOM';
  fontSize: number;
  color: string;
  style: 'BOLD';
  animation: 'NONE' | 'FADE';
}
export interface EditingTimeline {
  audioFingerprint: string;
  segments: SubtitleSegment[];
  words?: TimedText[];
  granularity: 'WORD' | 'SEGMENT' | null;
  overlays: TextOverlay[];
  warnings: string[];
}
export const emptyVisual = (): VisualEditing => ({
  captions: {
    present: null,
    position: null,
    fontSize: null,
    bold: null,
    primaryColor: null,
    highlightColor: null,
    outline: null,
    shadow: null,
    wordsPerGroup: null,
    highlightWord: null,
    animated: null,
  },
  overlays: { present: null, position: null, frequency: null, types: [] },
  zoom: { mode: null, frequency: null },
  transition: null,
  confidence: 0,
  unknown: [],
});
const representative = (values: number[]) =>
  values.length
    ? [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) / 2)]
    : null;
export function consolidateReferences(
  profiles: ReferenceProfile[],
  features: EditingState['features'],
) {
  const notes: string[] = [];
  const recurrent = <T>(values: Array<T | null>): T | null => {
    const known = values.filter((v) => v !== null);
    if (!known.length) return null;
    const counts = new Map<T, number>();
    for (const value of known)
      counts.set(value!, (counts.get(value!) ?? 0) + 1);
    const best = [...counts].sort((a, b) => b[1] - a[1])[0];
    return best[1] > known.length / 2 ? best[0] : null;
  };
  const wpms = profiles
    .map((p) => p.speech.averageWpm)
    .filter((v): v is number => v !== null);
  const shots = profiles.map((p) => p.cuts.median);
  if (wpms.length > 1 && Math.max(...wpms) > Math.min(...wpms) * 1.4)
    notes.push(
      'As velocidades diferem entre as referências. Foi escolhida uma medição existente, sem criar uma média artificial; revise a velocidade.',
    );
  if (shots.length > 1 && Math.max(...shots) > Math.min(...shots) * 2)
    notes.push(
      'Há ritmos de corte diferentes. Revise a duração sugerida dos planos.',
    );
  const v = profiles
      .filter((p) => p.visual.confidence >= 0.6)
      .map((p) => p.visual),
    has = (f: EditingState['features'][number]) => features.includes(f);
  if (v.length < profiles.length)
    notes.push(
      'Observações visuais com baixa confiança não foram aplicadas automaticamente.',
    );
  if (v.length < profiles.length)
    notes.push(
      'Observações visuais com baixa confiança não foram aplicadas automaticamente.',
    );
  const caps = v.map((v) => v.captions);
  const clamp = (v: number, min: number, max: number) =>
    Math.max(min, Math.min(max, v));
  const wpm = representative(wpms),
    shot = representative(shots);
  const config: EditingConfig = {
    wordsPerMinute:
      has('speechSpeed') && wpm !== null ? clamp(wpm, 80, 240) : null,
    narrationStyle: 'NEUTRAL',
    pauseSeconds: has('speechSpeed')
      ? ((value) => (value === null ? null : clamp(value, 0, 2)))(
          representative(
            profiles
              .map((p) => p.speech.meanPause)
              .filter((v): v is number => v !== null),
          ),
        )
      : null,
    shotSeconds: has('cutPace') && shot !== null ? clamp(shot, 1, 12) : null,
    captions: {
      enabled:
        has('captions') && recurrent(caps.map((v) => v.present)) === true,
      highlightWord: recurrent(caps.map((v) => v.highlightWord)) === true,
      wordsPerGroup: Math.round(
        representative(
          caps
            .map((v) => v.wordsPerGroup)
            .filter((v): v is number => v !== null),
        ) ?? 4,
      ),
      fontSize: Math.round(
        clamp(
          representative(
            caps.map((v) => v.fontSize).filter((v): v is number => v !== null),
          ) ?? 54,
          24,
          80,
        ),
      ),
      bold: recurrent(caps.map((v) => v.bold)) ?? true,
      primaryColor: recurrent(caps.map((v) => v.primaryColor)) ?? '#FFFFFF',
      highlightColor: recurrent(caps.map((v) => v.highlightColor)) ?? '#FFFF00',
      outline: recurrent(caps.map((v) => v.outline)) === false ? 0 : 2,
      shadow: recurrent(caps.map((v) => v.shadow)) === false ? 0 : 1,
      position: recurrent(caps.map((v) => v.position)) ?? 'BOTTOM',
    },
    overlays: {
      enabled:
        has('overlays') && recurrent(v.map((v) => v.overlays.present)) === true,
      frequency: recurrent(v.map((v) => v.overlays.frequency)) ?? 'SPARSE',
    },
    zoom: has('zoom')
      ? (recurrent(v.map((v) => v.zoom.mode)) ?? 'NONE')
      : 'NONE',
    transition:
      has('transitions') && recurrent(v.map((v) => v.transition)) === 'FADE'
        ? 'FADE'
        : 'CUT',
  };
  notes.push(
    'Parâmetros visuais desconhecidos usam sugestões de aplicação, não medições. Revise antes de aprovar.',
    'Entonação, intensidade e identidade vocal não são identificadas por análise de imagens. O estilo de voz pode ser escolhido manualmente; não há clonagem.',
  );
  if (features.includes('soundEffects') || features.includes('music'))
    notes.push(
      'Música e efeitos sonoros não são extraídos nem copiados das referências. Adicione uma música autorizada na etapa Trilha sonora, ou continue apenas com a narração.',
    );
  if (v.some((v) => v.transition === 'CROSSFADE'))
    notes.push(
      'Crossfade identificado não é aplicado neste fluxo; são suportados corte seco e fades de entrada/saída.',
    );
  return { config: editingConfigSchema.parse(config), notes };
}
export function activeEditing(data: { editing?: EditingState }) {
  const state = data.editing;
  if (!state?.enabled || !state.approved || !state.config) return undefined;
  const c = structuredClone(state.config),
    has = (key: (typeof editingFeatures)[number]) =>
      state.features.includes(key);
  if (!has('speechSpeed')) {
    c.wordsPerMinute = null;
    c.pauseSeconds = null;
  }
  if (!has('speechStyle')) c.narrationStyle = 'NEUTRAL';
  if (!has('cutPace')) c.shotSeconds = null;
  if (!has('captions')) c.captions.enabled = false;
  if (!has('overlays')) c.overlays.enabled = false;
  if (!has('zoom')) c.zoom = 'NONE';
  if (!has('transitions')) c.transition = 'CUT';
  return c;
}

export function applyCutRhythm(
  clips: import('./short.schema').ShortClip[],
  target: number | null,
  phraseEnds: number[] = [],
  alternateSources = false,
) {
  if (target === null) return clips;
  const output: import('./short.schema').ShortClip[] = [];
  let offset = 0;
  for (const clip of clips) {
    let used = 0;
    const available = clip.end - clip.start;
    while (available - used > 0.001) {
      const remaining = available - used;
      let length = remaining;
      if (remaining > target * 1.4) {
        const desired = offset + target;
        const natural = phraseEnds
          .filter(
            (t) =>
              t >= offset + Math.max(0.8, target * 0.65) &&
              t <= offset + target * 1.35,
          )
          .sort((a, b) => Math.abs(a - desired) - Math.abs(b - desired))[0];
        length =
          natural !== undefined
            ? natural - offset
            : target * [1, 0.88, 1.12][output.length % 3];
        length = Math.min(length, remaining);
        if (remaining - length < 0.8) length = remaining;
      }
      output.push({
        ...clip,
        start: clip.start + used,
        end: clip.start + used + length,
      });
      used += length;
      offset += length;
    }
  }
  if (output.length > 120)
    throw Error(
      'Plano de cortes acima do limite. Aumente a duração dos planos.',
    );
  if (alternateSources) {
    // Alternate only the already selected montage material; retain chronology per source.
    const groups = [...new Set(output.map((c) => c.fileId))].map((id) =>
      output.filter((c) => c.fileId === id),
    );
    const ordered: typeof output = [];
    for (let i = 0; i < Math.max(...groups.map((g) => g.length)); i++)
      for (const group of groups) if (group[i]) ordered.push(group[i]);
    return ordered;
  }
  return output;
}
