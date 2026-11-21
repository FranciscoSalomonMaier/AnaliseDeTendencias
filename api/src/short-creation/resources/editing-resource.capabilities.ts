import {
  audioLimits,
  audioCompositionSchema,
  AUDIO_ENGINE_VERSION,
} from './audio/audio.schema';
import {
  inspectGraphicsDependencies,
  fontCatalog,
  GRAPHICS_RENDERER_VERSION,
  graphicsDependencyVersions,
} from './graphics/graphics-font-registry';
import {
  graphicsLimits,
  supportedEmoji,
  animationSchema,
} from './graphics/graphics.schema';
import { resourceDurationModel } from './editing-resource.duration';
import { z } from 'zod';
import { MediaProcess } from '../../video-render/media-process';
import { editingResourceRegistry } from './editing-resource.registry';
import {
  RESOURCE_CONTRACT_VERSION,
  RESOURCE_LIBRARY_VERSION,
  resourceUsageSchema,
} from './editing-resource.schema';
import {
  resourceExecutionEvidence,
  RESOURCE_EXECUTOR_VERSION,
} from './resource-execution.evidence';
import type {
  ResourceCapability,
  ResourceEnvironment,
} from './editing-resource.types';
const commonFilters = [
  'fps',
  'settb',
  'setpts',
  'trim',
  'format',
  'setsar',
  'scale',
  'crop',
  'pad',
  'tpad',
  'split',
  'concat',
];
export async function inspectResourceEnvironment(
  process: MediaProcess,
  binaries: { ffmpegPath: string; ffprobePath: string },
  signal?: AbortSignal,
): Promise<ResourceEnvironment> {
  let version = '',
    filters = new Set<string>(),
    encoders = new Set<string>(),
    xfadeTransitions = new Set<string>(),
    ffprobeAvailable = false,
    audioEncoders = new Set<string>(),
    audioDecoders = new Set<string>();
  try {
    const results = await Promise.allSettled([
      process.run(
        binaries.ffmpegPath,
        ['-hide_banner', '-version'],
        10000,
        signal,
      ),
      process.run(
        binaries.ffmpegPath,
        ['-hide_banner', '-filters'],
        10000,
        signal,
      ),
      process.run(
        binaries.ffmpegPath,
        ['-hide_banner', '-encoders'],
        10000,
        signal,
      ),
      process.run(
        binaries.ffmpegPath,
        ['-hide_banner', '-h', 'filter=xfade'],
        10000,
        signal,
      ),
      process.run(
        binaries.ffmpegPath,
        ['-hide_banner', '-decoders'],
        10000,
        signal,
      ),
    ]);
    const values = results.map((result) =>
      result.status === 'fulfilled' ? result.value : '',
    );
    audioEncoders = new Set(
      [...values[2].matchAll(/^\s*A[.A-Z]{5}\s+(\w+)\s+/gm)].map((m) => m[1]),
    );
    audioDecoders = new Set(
      [...values[4].matchAll(/^\s*A[.A-Z]{5}\s+(\w+)\s+/gm)].map((m) => m[1]),
    );
    version = values[0].split('\n')[0].slice(0, 180);
    filters = new Set(
      [...values[1].matchAll(/^\s*[TSC.]{3}\s+(\w+)\s+/gm)].map((m) => m[1]),
    );
    encoders = new Set(
      [...values[2].matchAll(/^\s*V[.A-Z]{5}\s+(\w+)\s+/gm)].map((m) => m[1]),
    );
    xfadeTransitions = new Set(
      [
        ...values[3].matchAll(
          /^\s+(fade|zoomin|slideleft|slideright|slideup|slidedown)\s+\d+/gm,
        ),
      ].map((m) => m[1]),
    );
  } catch {
    /* Fail closed; diagnostic details stay outside the planner catalog. */
  }
  try {
    await process.run(binaries.ffprobePath, ['-version'], 10000, signal);
    ffprobeAvailable = true;
  } catch {}
  return {
    audioEncoders,
    audioDecoders,
    graphicsAvailable: await inspectGraphicsDependencies(),
    ffmpegVersion: version,
    filters,
    encoders,
    xfadeTransitions,
    ffprobeAvailable,
  };
}
export function resourceCapabilities(
  environment: ResourceEnvironment,
): ResourceCapability[] {
  return editingResourceRegistry.map((def) => {
    const evidence = resourceExecutionEvidence[def.id];
    const executionVerified = Boolean(
      evidence &&
      evidence.resourceVersion === def.version &&
      evidence.executorVersion === RESOURCE_EXECUTOR_VERSION &&
      (def.category !== 'AUDIO' ||
        evidence.audioEngineVersion === AUDIO_ENGINE_VERSION) &&
      (def.category !== 'TEXT_AND_GRAPHICS' ||
        evidence.graphicsRendererVersion === GRAPHICS_RENDERER_VERSION),
    );
    const transitions =
      def.id === 'CROSSFADE'
        ? ['fade']
        : def.id === 'ZOOM_TRANSITION'
          ? ['zoomin']
          : def.id === 'SLIDE_TRANSITION'
            ? ['slideleft', 'slideright', 'slideup', 'slidedown']
            : [];
    const technicallyAvailable =
      /^ffmpeg version 7\./.test(environment.ffmpegVersion) &&
      (def.category !== 'TEXT_AND_GRAPHICS' ||
        environment.graphicsAvailable === true) &&
      environment.ffprobeAvailable &&
      (def.category === 'AUDIO'
        ? ['pcm_s16le', 'aac'].every((e) =>
            environment.audioEncoders?.has(e),
          ) &&
          ['pcm_s16le', 'mp3', 'aac', 'vorbis', 'opus', 'flac'].every((d) =>
            environment.audioDecoders?.has(d),
          )
        : environment.encoders.has('libx264')) &&
      [
        ...(def.category === 'AUDIO' ? [] : commonFilters),
        ...def.requiredFilters,
      ].every((filter) => environment.filters.has(filter)) &&
      transitions.every((t) => environment.xfadeTransitions.has(t));
    const reasons = [
      ...(!def.implemented ? ['Executor e contrato pendentes.'] : []),
      ...(!executionVerified
        ? ['Sem evidência versionada de teste real de execução.']
        : []),
      ...(!technicallyAvailable
        ? ['Requisitos de mídia não atendidos neste ambiente.']
        : []),
    ];
    return {
      id: def.id,
      version: def.version,
      registered: true,
      implemented: def.implemented,
      technicallyAvailable,
      executionVerified,
      available:
        def.implemented &&
        def.parametersSchema !== null &&
        executionVerified &&
        technicallyAvailable,
      reasons,
    };
  });
}
/** JSON-safe tool descriptions for a future planner; no paths, commands or filter strings. */
export function resourceCatalog(
  environment: ResourceEnvironment,
  availableOnly = true,
) {
  const capabilities = resourceCapabilities(environment);
  return {
    libraryVersion: RESOURCE_LIBRARY_VERSION,
    contractVersion: RESOURCE_CONTRACT_VERSION,
    usage: 'ISOLATED_MEDIA_RESOURCES_ONLY',
    audio: {
      engineVersion: AUDIO_ENGINE_VERSION,
      executor: 'AudioResourceExecutor',
      timelineContract: z.toJSONSchema(audioCompositionSchema, { io: 'input' }),
      limits: audioLimits,
      gainUnit: 'LINEAR_AMPLITUDE',
      sampleRate: 48000,
      channels: 2,
      outputFormats: ['WAV_PCM_S16LE', 'MP4_H264_COPY_AAC'],
      acceptedSourceFormats: [
        'MP3',
        'WAV',
        'AAC',
        'M4A',
        'OGG',
        'OPUS',
        'FLAC',
      ],
      duckingStrategies: ['KNOWN_INTERVALS'],
      normalization: 'NONE',
      clippingProtection: 'EXPLICIT_LIMITER_ONLY',
      synchronization:
        'EXPLICIT_SOURCE_INTERVAL_RATE_REPEAT_TIMELINE_OFFSET_AND_FADES',
      originalAudio: 'FIRST_AUDIO_STREAM_WITH_MATCHING_VIDEO_START_TIMESTAMP',
    },
    graphics: {
      rendererVersion: GRAPHICS_RENDERER_VERSION,
      dependencies: graphicsDependencyVersions,
      coordinateSpace: 'FINAL_COMPOSITION',
      clock: 'FINAL_PROCESSED_VIDEO_SECONDS',
      layering: 'GRAPHICS_AFTER_VIDEO_EFFECTS_LAYER_THEN_DECLARATION',
      fonts: fontCatalog,
      emoji: {
        supported: supportedEmoji,
        license: 'CC-BY-4.0',
        attribution:
          'Emoji graphics by Twemoji, https://github.com/jdecked/twemoji, CC BY 4.0',
      },
      imageFormats: ['PNG', 'JPEG', 'WEBP'],
      limits: graphicsLimits,
      animations: z.toJSONSchema(animationSchema, { io: 'input' }),
      runtimeAvailable: environment.graphicsAvailable ?? false,
    },
    compatibilityProfile: 'FFMPEG_7',
    requestContract: z.toJSONSchema(resourceUsageSchema, { io: 'input' }),
    timeUnits: 'SECONDS',
    timeRounding: '30_FPS_NEAREST_FRAME',
    resources: editingResourceRegistry.flatMap((def) => {
      const capability = capabilities.find((item) => item.id === def.id)!;
      if (availableOnly && !capability.available) return [];
      return [
        {
          name: def.name,
          description: def.description,
          category: def.category,
          ...capability,
          scopes: [...def.scopes],
          changesDuration: def.changesDuration,
          duration: def.implemented
            ? {
                ...resourceDurationModel(def.id),
                ...(def.category === 'AUDIO'
                  ? {
                      clock: 'SOURCE_AND_FINAL_COMPOSITION_EXPLICIT',
                      outputEquation:
                        def.id === 'AUDIO_LOOP'
                          ? 'parameters.duration (track); composition.duration (output)'
                          : 'composition.duration',
                      rounding: 'NEAREST_SAMPLE',
                      sampleRate: 48000,
                      fps: null,
                      audioExecution: true,
                      toleranceSeconds: 1 / 48000,
                    }
                  : {}),
                ...(def.category === 'TEXT_AND_GRAPHICS'
                  ? { clock: 'FINAL_COMPOSITION' }
                  : {}),
              }
            : { status: 'PENDING_CONTRACT' },
          parameters: def.parametersSchema
            ? z.toJSONSchema(def.parametersSchema, { io: 'input' })
            : null,
          restrictions: [...def.restrictions],
        },
      ];
    }),
  };
}
