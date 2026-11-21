import { z } from 'zod';
import {
  planningModelResponseSchema,
  planningProviderResponseSchema,
} from './planning-model.schema';
/** Synthetic metadata and controlled observations only. No real media or API calls. */
import { editorialPreferencesSchema } from '../short-editorial.schema';
import { resolveEditorialKnowledge } from '../knowledge/editorial-knowledge.resolver';
import { editingResourceRegistry } from '../resources/editing-resource.registry';
import type { ResourceCapability } from '../resources/editing-resource.types';
import type { PlanningInput } from './planning.schema';
export const fixtureCapabilities: ResourceCapability[] =
  editingResourceRegistry.map((r) => ({
    id: r.id,
    version: r.version,
    registered: true,
    implemented: true,
    technicallyAvailable: true,
    executionVerified: true,
    available: true,
    reasons: [],
  }));
export function fixtureInput(
  kind:
    | 'ranking'
    | 'narrated'
    | 'gameplay'
    | 'horror'
    | 'insufficient' = 'gameplay',
): PlanningInput {
  const classification =
    kind === 'ranking'
      ? {
          version: 1 as const,
          videoType: 'TOP_X' as const,
          videoTopic: 'HUMOR' as const,
          editingStyle: 'DYNAMIC' as const,
        }
      : kind === 'narrated'
        ? {
            version: 1 as const,
            videoType: 'CURIOSITY' as const,
            videoTopic: 'GENERAL_CURIOSITIES' as const,
            editingStyle: 'DOCUMENTARY' as const,
          }
        : kind === 'horror'
          ? {
              version: 1 as const,
              videoType: 'VIBE' as const,
              videoTopic: 'HORROR' as const,
              editingStyle: 'ANALOG_HORROR' as const,
            }
          : {
              version: 1 as const,
              videoType: 'GAMEPLAY' as const,
              videoTopic: 'GAMING' as const,
              editingStyle: 'MINIMALIST' as const,
            };
  const meta = (id: string, duration = 6) => ({
    id,
    duration,
    sampleRate: 48000,
    channels: 2,
    codec: 'pcm_s16le',
    kind: 'AUDIO' as const,
  });
  const input: PlanningInput = {
    version: 1,
    planningId: `fixture-${kind}`,
    classification,
    editorialPreferences: editorialPreferencesSchema.parse({ version: 1 }),
    narration: {
      version: 1,
      mode: kind === 'narrated' ? 'WITH_NARRATION' : 'WITHOUT_NARRATION',
    },
    target: { width: 1080, height: 1920, fps: 30, durationSeconds: 6 },
    videos: [
      {
        metadata: {
          id: 'video1',
          duration: 12,
          width: 1280,
          height: 720,
          fps: 30,
        },
        hasAudio: true,
        audio: { ...meta('video1', 12), kind: 'VIDEO' },
        usableIntervals: [{ start: 0, end: 12 }],
        description: null,
      },
    ],
    audios: [
      {
        metadata: meta('music1'),
        role: 'MUSIC',
        usableIntervals: [{ start: 0, end: 6 }],
      },
      {
        metadata: meta('effect1', 1),
        role: 'EFFECT',
        usableIntervals: [{ start: 0, end: 1 }],
      },
    ],
    images: [],
    observations:
      kind === 'insufficient'
        ? []
        : [
            {
              id: 'ob1',
              sourceId: 'video1',
              interval: { start: 0, end: 3 },
              description: 'Objeto sintético desloca-se para a esquerda.',
              origin: 'USER',
              confidence: 1,
            },
            {
              id: 'ob2',
              sourceId: 'video1',
              interval: { start: 3, end: 6 },
              description: 'Objeto sintético desloca-se para a direita.',
              origin: 'USER',
              confidence: 1,
            },
          ],
    timedText: [],
    displayTexts: [],
    additionalInstructions: '',
  };
  if (kind === 'ranking') {
    input.ranking = {
      criterion: 'Ordem editorial demonstrativa definida pelo usuário.',
      items: [
        { position: 1, label: 'Esquerda', observationIds: ['ob1'] },
        { position: 2, label: 'Direita', observationIds: ['ob2'] },
      ],
    };
    input.editorialPreferences = editorialPreferencesSchema.parse({
      version: 1,
      cutRhythm: 'FAST',
      resources: {
        titles: 'PREFER',
        emojis: 'PREFER',
        dynamicZoom: 'PREFER',
        soundEffects: 'PREFER',
        originalAudio: 'PREFER',
      },
    });
  }
  if (kind === 'narrated') {
    input.audios.push({
      metadata: meta('voice1'),
      role: 'NARRATION',
      usableIntervals: [{ start: 0, end: 6 }],
    });
    input.timedText = [
      {
        id: 'words1',
        kind: 'CAPTION',
        sourceId: 'voice1',
        tokens: [
          { text: 'Exemplo sintético.', start: 0, end: 3 },
          { text: 'Segundo exemplo.', start: 3, end: 6 },
        ],
      },
    ];
  }
  return input;
}
export function op(
  id: string,
  resourceId: string,
  target: Record<string, unknown>,
  parameters: Record<string, unknown> = {},
  extras: Record<string, unknown> = {},
) {
  return {
    id,
    usage: {
      contractVersion: 1,
      resourceId,
      resourceVersion: 1,
      target,
      parameters,
    },
    reason: 'Seleção técnica/editorial controlada para o cenário de teste.',
    observationIds: [],
    ...extras,
  };
}
export function fixturePlan(
  kind: Parameters<typeof fixtureInput>[0] = 'gameplay',
) {
  const input = fixtureInput(kind);
  const target = { scope: 'COMPOSITION', clipId: 'clip1' };
  const plan = {
    version: 1,
    libraryVersion: 3,
    planningId: input.planningId,
    durationSeconds: 6,
    intent: kind === 'insufficient' ? 'TECHNICAL_ONLY' : 'EDITORIAL',
    clips: [{ clipId: 'clip1', sourceId: 'video1' }],
    visualOperations: [
      op('cut1', 'CUT', {
        scope: 'SOURCE_INTERVAL',
        sourceId: 'clip1',
        start: 0,
        end: 6,
      }),
    ],
    graphicOperations: [] as ReturnType<typeof op>[],
    audioOperations: [] as ReturnType<typeof op>[],
    events: [] as Record<string, unknown>[],
    ruleDecisions: resolveEditorialKnowledge(input.classification)
      .guidance.filter((r) => ['REQUIRED', 'FORBIDDEN'].includes(r.level))
      .map((r) => ({
        guidanceId: r.id,
        status: 'SATISFIED',
        operationIds: [],
        explanation:
          'Critério e itens foram fornecidos; conteúdo limitado às observações autorizadas.',
      })),
  };
  const track = (clipId: string) => ({ scope: 'COMPOSITION', clipId });
  if (kind === 'ranking') {
    plan.graphicOperations.push(
      op('ranking', 'RANKING_PANEL', target, {
        panelId: 'rank1',
        items: input.ranking!.items.map((i) => ({
          position: i.position,
          label: i.label,
        })),
        start: 0,
        end: 6,
      }),
      op('reveal', 'RANKING_REVEAL', target, {
        panelId: 'rank1',
        reveals: [
          { position: 2, revealAt: 1 },
          { position: 1, revealAt: 4 },
        ],
        highlightDuration: 0.5,
      }),
    );
    plan.audioOperations.push(
      op('sfx', 'SOUND_EFFECT', track('fx'), {
        clipId: 'fx1',
        sourceId: 'effect1',
        sourceStart: 0,
        sourceEnd: 1,
        timelineStart: 1,
        category: 'IMPACT',
      }),
    );
    plan.graphicOperations.push(
      op('criterion', 'FIXED_TITLE', target, {
        text: input.ranking!.criterion,
        start: 0,
        end: 6,
      }),
    );
    plan.events.push({
      id: 'event1',
      kind: 'RANKING_REVEAL',
      at: 1,
      position: 2,
      operationIds: ['reveal', 'sfx'],
    });
  }
  if (kind === 'narrated') {
    plan.audioOperations.push(
      op('voice', 'NARRATION', track('voice'), {
        clipId: 'voice-clip',
        sourceId: 'voice1',
        sourceStart: 0,
        sourceEnd: 6,
      }),
      op('music', 'BACKGROUND_MUSIC', track('music'), {
        clipId: 'music-clip',
        sourceId: 'music1',
        sourceStart: 0,
        sourceEnd: 6,
        gain: 0.15,
      }),
      op('duck', 'AUDIO_DUCKING', track('music'), {
        triggerTrackId: 'voice',
        intervals: [{ start: 0, end: 6 }],
        reduction: 0.25,
      }),
    );
    plan.graphicOperations.push(
      op(
        'captions',
        'CAPTIONS',
        target,
        { captions: input.timedText[0].tokens, start: 0, end: 6 },
        { timedTextId: 'words1' },
      ),
    );
  }
  if (kind === 'gameplay')
    plan.audioOperations.push(
      op('original', 'ORIGINAL_AUDIO', track('original'), {
        clipId: 'original-clip',
        sourceId: 'video1',
        sourceStart: 0,
        sourceEnd: 6,
      }),
    );
  if (kind === 'horror') {
    plan.visualOperations.push(
      op('vignette', 'VIGNETTE', { scope: 'CLIP', clipId: 'clip1' }, {}),
    );
    plan.audioOperations.push(
      op('music', 'BACKGROUND_MUSIC', track('music'), {
        clipId: 'music-clip',
        sourceId: 'music1',
        sourceStart: 0,
        sourceEnd: 6,
        gain: 0.1,
      }),
      op('sfx', 'SOUND_EFFECT', track('fx'), {
        clipId: 'fx1',
        sourceId: 'effect1',
        sourceStart: 0,
        sourceEnd: 1,
        timelineStart: 3,
        category: 'IMPACT',
      }),
    );
  }
  return plan;
}

/** Test-only encoder for the provider dialect. No model or network is involved. */
export function fixtureProviderResponse(value: unknown): unknown {
  const domain = planningModelResponseSchema.parse(value);
  const encode = (schema: z.ZodType, value: unknown): unknown => {
    if (schema instanceof z.ZodNullable)
      return value === undefined || value === null
        ? null
        : encode(schema.unwrap() as z.ZodType, value);
    if (schema instanceof z.ZodObject) {
      const data = value as Record<string, unknown>;
      return schema.parse(
        Object.fromEntries(
          Object.entries(schema.shape).map(([k, s]) => [
            k,
            encode(s as z.ZodType, data[k]),
          ]),
        ),
      );
    }
    if (schema instanceof z.ZodArray)
      return (value as unknown[]).map((v) =>
        encode(schema.element as z.ZodType, v),
      );
    if (schema instanceof z.ZodUnion) {
      for (const option of schema.options)
        try {
          return (option as z.ZodType).parse(
            encode(option as z.ZodType, value),
          );
        } catch {
          /* try the next official alternative */
        }
      throw Error('Fixture sem alternativa de recurso válida.');
    }
    return schema.parse(value);
  };
  return encode(planningProviderResponseSchema, domain);
}
