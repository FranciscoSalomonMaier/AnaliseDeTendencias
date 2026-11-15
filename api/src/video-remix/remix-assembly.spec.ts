jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
import { randomUUID } from 'node:crypto';
import {
  buildRemixTimeline,
  type AssemblyInput,
} from './remix-timeline.builder';
import { assemblyConfigSchema, cutEditSchema } from './remix-assembly.schema';
import { pauseAlignedCaptions, voicedIntervals } from './remix-captions';
import { remixFraming } from './remix-assembly.renderer';
import { validateSegments } from '../content-subtitles/subtitle.schema';
import { exportAss } from '../content-subtitles/subtitle.formats';
import type { Evidence } from './remix-story.schema';
function fixture(): AssemblyInput {
  const sourceId = randomUUID(),
    fileId = randomUUID();
  const refs: Evidence[] = [
    {
      id: randomUUID(),
      sourceId,
      fileId,
      analysisId: randomUUID(),
      sceneIds: [],
      start: 12,
      end: 18,
      candidateRevision: 1,
      description: 'Observed',
      justification: 'Visible',
      confidence: 1,
      relevance: 80,
      evidenceType: 'OBSERVED',
      licensing: {},
      scenes: [],
      frames: [],
    },
  ];
  return {
    scriptId: randomUUID(),
    scriptVersion: 1,
    scriptRevision: 1,
    contextHash: 'hash',
    targetDuration: 4,
    segments: [
      {
        id: randomUUID(),
        text: 'Um trecho observado.',
        audioId: randomUUID(),
        audioKey: 'private.wav',
        audioFormat: 'wav',
        audioBytes: 100,
        audioDuration: 4,
        refs,
      },
    ],
  };
}
const config = () => assemblyConfigSchema.parse({});
const edits = (t: ReturnType<typeof buildRemixTimeline>) =>
  t.items.map((i) =>
    cutEditSchema.parse(
      Object.fromEntries(
        Object.entries(i).filter(([k]) => k in cutEditSchema.shape),
      ),
    ),
  );
describe('Remix assembly timeline', () => {
  it('keeps source timestamps separate and retains complete real narration duration', () => {
    const t = buildRemixTimeline(fixture(), config());
    expect(t.items[0]).toMatchObject({
      sourceStart: 12,
      sourceEnd: 16,
      timelineStart: 0,
      timelineEnd: 4,
      duration: 4,
      speed: 1,
      freeze: 0,
    });
    expect(t.issues).toEqual([]);
    expect(t.segments[0].duration).toBe(4);
  });
  it('never fills insufficient footage with unrelated sources', () => {
    const input = fixture();
    input.segments[0].refs[0].end = 14;
    const t = buildRemixTimeline(input, config());
    expect(t.duration).toBe(4);
    expect(t.items[0].duration).toBe(2);
    expect(t.issues.join(' ')).toContain('faltam 2.00s');
  });
  it('uses related additional cuts without repeating overlapping footage', () => {
    const input = fixture(),
      s = input.segments[0];
    s.refs[0].end = 14;
    s.refs.push({ ...s.refs[0], id: randomUUID(), start: 13, end: 17 });
    const t = buildRemixTimeline(input, config());
    expect(t.items.map((i) => [i.sourceStart, i.sourceEnd])).toEqual([
      [12, 14],
      [14, 16],
    ]);
    expect(t.issues).toEqual([]);
  });
  it('supports multiple authorized sources in narrative order', () => {
    const input = fixture();
    input.segments.push({
      ...input.segments[0],
      id: randomUUID(),
      audioId: randomUUID(),
      audioDuration: 2,
      refs: [
        {
          ...input.segments[0].refs[0],
          id: randomUUID(),
          sourceId: randomUUID(),
          fileId: randomUUID(),
          start: 1,
          end: 5,
        },
      ],
    });
    const t = buildRemixTimeline(input, config());
    expect(new Set(t.items.map((i) => i.sourceId)).size).toBe(2);
    expect(t.items[1].timelineStart).toBe(4);
    expect(t.items[1].sourceStart).toBe(1);
    expect(t.duration).toBe(6);
  });
  it('only permits speed changes after explicit configuration and never below 0.9', () => {
    const input = fixture();
    input.segments[0].refs[0].end = 15.6;
    const c = assemblyConfigSchema.parse({ allowSlowdown: true });
    const t = buildRemixTimeline(input, c);
    expect(t.items[0].speed).toBeCloseTo(0.9);
    expect(t.issues).toEqual([]);
    expect(() => buildRemixTimeline(input, config(), edits(t))).toThrow(
      'Ative',
    );
    expect(
      cutEditSchema.safeParse({ ...edits(t)[0], speed: 0.5 }).success,
    ).toBe(false);
  });
  it('uses a short explicit freeze and records its warning', () => {
    const input = fixture();
    input.segments[0].refs[0].end = 15.5;
    const t = buildRemixTimeline(
      input,
      assemblyConfigSchema.parse({ maxFreezeSeconds: 0.5 }),
    );
    expect(t.items[0].freeze).toBeCloseTo(0.5);
    expect(t.issues).toEqual([]);
    expect(t.warnings.join(' ')).toContain('congelamento');
  });
  it('rounds the end up to a frame without truncating the voice', () => {
    const input = fixture();
    input.segments[0].audioDuration = 1.251;
    const t = buildRemixTimeline(input, config());
    expect(t.duration).toBeGreaterThan(1.251);
    expect(t.duration - 1.251).toBeLessThan(1 / 30);
  });
  it('rejects cuts outside selected source bounds and arbitrary references', () => {
    const input = fixture(),
      t = buildRemixTimeline(input, config()),
      e = edits(t);
    e[0].sourceStart = 0;
    expect(() => buildRemixTimeline(input, config(), e)).toThrow('intervalo');
    e[0].sourceStart = 12;
    e[0].candidateId = randomUUID();
    expect(() => buildRemixTimeline(input, config(), e)).toThrow('intervalo');
  });
  it('removing all cuts produces a synchronization issue instead of dropping narration', () => {
    const t = buildRemixTimeline(fixture(), config(), []);
    expect(t.duration).toBe(4);
    expect(t.items).toHaveLength(0);
    expect(t.issues).toHaveLength(1);
  });
  it('records transition occupancy while preserving full narration', () => {
    const input = fixture(),
      t = buildRemixTimeline(input, config()),
      e = edits(t);
    e[0].transition = 'FADE';
    e[0].transitionSeconds = 0.2;
    const result = buildRemixTimeline(input, config(), e);
    expect(result.duration).toBe(4);
    expect(result.items[0].transitionSeconds).toBe(0.2);
  });
  it('validates crop coordinates and constructs only bounded filters', () => {
    const t = buildRemixTimeline(fixture(), config()),
      i = t.items[0];
    expect(remixFraming(i, 540, 960)).toContain('boxblur');
    i.framing = { mode: 'CENTER_CROP', x: 0.5, y: 0.5 };
    expect(remixFraming(i, 540, 960)).toContain('crop=540:960');
    i.framing = { mode: 'MANUAL_CROP', x: 0.1, y: 0.9 };
    expect(remixFraming(i, 540, 960)).toContain('(iw-ow)*0.1');
    expect(
      assemblyConfigSchema.safeParse({ framing: { mode: 'MANUAL_CROP', x: 2 } })
        .success,
    ).toBe(false);
  });
});
describe('Remix known-text caption timing', () => {
  it('uses measured silence intervals rather than equal word division', () => {
    const intervals = voicedIntervals(
      'lavfi.silence_start=0\nlavfi.silence_end=0.5\nlavfi.silence_start=2\nlavfi.silence_end=3\nlavfi.silence_start=5',
      6,
    );
    expect(intervals).toEqual([
      { start: 0.5, end: 2 },
      { start: 3, end: 5 },
    ]);
    const cues = pauseAlignedCaptions(
      'Olá. Incrivelmente interessante.',
      6,
      intervals,
      5,
      32,
    );
    validateSegments(cues, 6);
    expect(cues[0].startSeconds).toBe(0.5);
    expect(cues.at(-1)?.endSeconds).toBe(5);
    expect(cues[0].endSeconds - cues[0].startSeconds).toBeLessThan(
      cues[1].endSeconds - cues[1].startSeconds,
    );
    expect(cues.every((c) => !c.words)).toBe(true);
  });
  it('rejects silent audio and safely escapes ASS control text', () => {
    expect(() => pauseAlignedCaptions('Olá', 2, [], 5, 32)).toThrow(
      'atividade',
    );
    const cues = pauseAlignedCaptions(
      'Olá {\\pos(1,2)} mundo.',
      2,
      [{ start: 0, end: 2 }],
      5,
      32,
    );
    const ass = exportAss(
      {
        settings: config().subtitles,
        versions: [],
        segments: cues.map((c) => ({ ...c, sceneId: 's' })),
      },
      540,
      960,
    );
    expect(ass).not.toContain('{\\pos(1,2)}');
    expect(ass).toContain('[Events]');
  });
});
