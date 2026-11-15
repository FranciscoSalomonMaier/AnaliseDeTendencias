jest.mock('@nestjs/config', () => ({
  ConfigService: class {
    constructor(private readonly values: Record<string, unknown> = {}) {}
    get(key: string) {
      return this.values[key];
    }
  },
}));
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  storyConfigSchema,
  segmentDraftSchema,
  storyResponseSchema,
  supportSchema,
  estimateSpeech,
  visualDuration,
  guardSupport,
  storyHash,
  type Evidence,
  type StoryConfig,
} from './remix-story.schema';
import { RemixStorySettings } from './remix-story.settings';
import { TtsSettings } from '../content-narration/tts-settings';
import { RemixVoiceService } from './remix-voice.service';
import { TtsProvider } from '../content-narration/tts.provider';
import { AudioFileValidator } from '../content-narration/audio-file.validator';
import { MediaProcess } from '../video-render/media-process';
import { RemixImportSettings } from './remix-import.settings';
const config: StoryConfig = {
  language: 'pt-BR',
  style: 'CURIOSIDADE',
  targetDuration: 35,
  voice: 'cedar',
  speed: 1,
};
const evidence = (start = 0, end = 10, fileId = 'file'): Evidence => ({
  id: randomUUID(),
  sourceId: 'source',
  fileId,
  analysisId: 'analysis',
  sceneIds: [],
  start,
  end,
  candidateRevision: 0,
  description: 'Personagem dirigindo',
  justification: 'Visível',
  confidence: 0.9,
  relevance: 99,
  evidenceType: 'OBSERVED',
  licensing: { userDeclaredRights: true },
  scenes: [],
  frames: [{ id: randomUUID(), timestamp: 5, key: 'internal.jpg' }],
});
describe('Video Remix script and narration', () => {
  test('initial configuration is Brazilian Portuguese and bounds voice/speed/duration', () => {
    expect(storyConfigSchema.parse(config)).toEqual(config);
    expect(() =>
      storyConfigSchema.parse({ ...config, language: 'en-US' }),
    ).toThrow();
    expect(() =>
      storyConfigSchema.parse({ ...config, voice: 'unknown' }),
    ).toThrow();
    expect(() => storyConfigSchema.parse({ ...config, speed: 4 })).toThrow();
    expect(() =>
      storyConfigSchema.parse({ ...config, targetDuration: 1 }),
    ).toThrow();
  });
  test('structured narrative supports flexible phases and mandatory source references', () => {
    const draft = {
      kind: 'HOOK',
      text: 'Veja este personagem.',
      candidateIds: [randomUUID()],
      notes: '',
    };
    expect(
      storyResponseSchema.parse({
        plan: { structure: 'Curta', visualGaps: [] },
        segments: [draft],
      }).segments,
    ).toHaveLength(1);
    expect(() =>
      segmentDraftSchema.parse({ ...draft, candidateIds: [] }),
    ).toThrow();
    expect(() =>
      segmentDraftSchema.parse({ ...draft, text: 'a'.repeat(1001) }),
    ).toThrow();
    expect(() =>
      segmentDraftSchema.parse({ ...draft, validation: 'SUPPORTED' }),
    ).toThrow();
  });
  test('does not trust arbitrary AI validation status', () => {
    expect(() =>
      supportSchema.parse({
        status: 'CERTAIN',
        reason: 'Sim',
        suggestedRewrite: '',
      }),
    ).toThrow();
  });
  test('word budget is approximate and depends on pauses, style and speed', () => {
    const text = 'Neste trecho, o personagem dirige pela cidade.';
    const base = estimateSpeech(text, config);
    expect(base.words).toBe(7);
    expect(
      estimateSpeech(text, { ...config, speed: 1.2 }).seconds,
    ).toBeLessThan(base.seconds);
    expect(
      estimateSpeech(text, { ...config, style: 'EXPLICATIVO' }).seconds,
    ).toBeGreaterThan(base.seconds);
    expect(estimateSpeech(text + '...', config).seconds).toBeGreaterThan(
      base.seconds,
    );
    expect(base.minSeconds).toBeLessThan(base.seconds);
    expect(base.maxSeconds).toBeGreaterThan(base.seconds);
  });
  test('counts overlapping intervals from a file only once', () => {
    expect(
      visualDuration([evidence(0, 10), evidence(5, 15), evidence(20, 25)]),
    ).toBe(20);
  });
  test('counts separate source files without assuming timestamp continuity', () => {
    expect(visualDuration([evidence(0, 10, 'a'), evidence(0, 10, 'b')])).toBe(
      20,
    );
  });
  test('high relevance does not prove truth when evidence is inferred', () => {
    const e = evidence();
    e.evidenceType = 'INFERRED';
    expect(
      guardSupport(
        {
          status: 'SUPPORTED',
          reason: 'Cenas semelhantes',
          suggestedRewrite: 'Talvez...',
        },
        [e],
      ).status,
    ).toBe('PARTIALLY_SUPPORTED');
  });
  test('rejects unsupported intervals with no representative frames', () => {
    const e = evidence();
    e.frames = [];
    expect(
      guardSupport(
        { status: 'SUPPORTED', reason: 'O tema afirma', suggestedRewrite: '' },
        [e],
      ).status,
    ).toBe('UNSUPPORTED');
  });
  test('does not upgrade an unsupported factual statement due to relevance', () => {
    expect(
      guardSupport(
        {
          status: 'UNSUPPORTED',
          reason: 'Dirigir não mostra atravessar uma parede.',
          suggestedRewrite: 'O personagem dirige.',
        },
        [evidence()],
      ).status,
    ).toBe('UNSUPPORTED');
  });
  test('low confidence evidence cannot silently become supported', () => {
    const e = evidence();
    e.confidence = 0.4;
    expect(
      guardSupport(
        { status: 'SUPPORTED', reason: 'Parcial', suggestedRewrite: '' },
        [e],
      ).status,
    ).toBe('PARTIALLY_SUPPORTED');
  });
  test('keeps supported observable description separate from unconfirmed events', () => {
    expect(
      guardSupport(
        {
          status: 'SUPPORTED',
          reason: 'Personagem visível nos frames.',
          suggestedRewrite: '',
        },
        [evidence()],
      ).status,
    ).toBe('SUPPORTED');
  });
  test('missing model disables paid generation without invented cost', () => {
    const tts = new TtsSettings(new ConfigService());
    const options = new RemixStorySettings(new ConfigService(), tts).options();
    expect(options.enabled).toBe(false);
    expect(options.estimatedUsd).toBeNull();
    expect(options.voices).toContain('cedar');
    expect(options.speed).toEqual({ min: 0.75, max: 1.25 });
  });
  test('supports existing vision model as explicit fallback', () => {
    const c = new ConfigService({
      OPENAI_API_KEY: 'mock',
      VIDEO_REMIX_ANALYSIS_MODEL: 'mock-vision',
    });
    expect(new RemixStorySettings(c, new TtsSettings(c)).model).toBe(
      'mock-vision',
    );
  });
  test('cache fingerprint includes text, voice, speed, model, language and style', () => {
    const c = new ConfigService(),
      tts = new TtsSettings(c),
      settings = new RemixStorySettings(c, tts);
    const voice = new RemixVoiceService(
      {} as TtsProvider,
      {} as AudioFileValidator,
      {} as MediaProcess,
      {} as RemixImportSettings,
      settings,
    );
    const base = voice.fingerprint('Texto', config);
    expect(voice.fingerprint('Texto ', config)).toBe(base);
    expect(voice.fingerprint('Outro texto', config)).not.toBe(base);
    for (const altered of [
      { ...config, voice: 'nova' },
      { ...config, speed: 1.1 },
      { ...config, style: 'NARRATIVO' as const },
    ])
      expect(voice.fingerprint('Texto', altered)).not.toBe(base);
  });
  test('stable content hash tracks references and revision', () => {
    expect(storyHash({ candidateId: 'a', revision: 1 })).not.toBe(
      storyHash({ candidateId: 'a', revision: 2 }),
    );
  });
});
