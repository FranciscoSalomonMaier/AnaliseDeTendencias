jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
import { randomUUID } from 'node:crypto';
import type { ContentProject } from '../content-projects/content-project.schema';
import type { RenderSnapshot } from '../video-render/render-job';
import { narrationTextHash } from '../content-narration/tts-settings';
import {
  defaultSubtitles,
  SubtitleSettingsSchema,
  validateSegments,
  SubtitleVersion,
} from './subtitle.schema';
import {
  groupWords,
  matchText,
  subtitleSnapshot,
  prepareAlignment,
} from './subtitle.builder';
import {
  exportAss,
  exportSrt,
  escapeAss,
  wrapSubtitle,
} from './subtitle.formats';
const settings = defaultSubtitles();
const words = [
  { text: 'Na', startSeconds: 0.3, endSeconds: 0.5 },
  { text: 'madrugada', startSeconds: 0.55, endSeconds: 1.1 },
  { text: 'escura.', startSeconds: 1.2, endSeconds: 1.6 },
  { text: 'Um', startSeconds: 2.2, endSeconds: 2.4 },
  { text: 'avião', startSeconds: 2.5, endSeconds: 3 },
];
function fixture() {
  const sceneId = randomUUID(),
    audioAssetId = randomUUID(),
    id = randomUUID(),
    projectId = randomUUID();
  const segments = groupWords(words, settings);
  const v: SubtitleVersion = {
    id,
    sceneId,
    audioAssetId,
    projectId,
    status: 'READY',
    error: null,
    createdAt: new Date().toISOString(),
    data: {
      referenceText: 'Na madrugada escura. Um avião',
      referenceHash: narrationTextHash('Na madrugada escura. Um avião'),
      language: 'pt',
      audioDurationSeconds: 4,
      settings,
      segments,
      words,
      granularity: 'WORD',
      provider: 'mock',
      model: 'mock',
      transcript: 'Na madrugada escura. Um avião',
      matchScore: 1,
      reviewRequired: false,
      edited: false,
    },
  };
  const p = {
    id: projectId,
    scenes: [{ id: sceneId, narration: v.data.referenceText }],
  } as ContentProject;
  const timeline = {
    scenes: [
      {
        sceneId,
        audioAssetId,
        order: 1,
        startSeconds: 12.5,
        audioDurationSeconds: 4,
      },
    ],
    totalDurationSeconds: 16.5,
  } as RenderSnapshot;
  return {
    v,
    p,
    timeline,
    state: {
      settings: { ...settings, enabled: true },
      selections: { [sceneId]: id },
    },
  };
}
describe('real timestamp grouping and immutable subtitle snapshots', () => {
  test('preserves original word intervals including pauses and punctuation', () => {
    const segments = groupWords(words, settings);
    expect(segments).toHaveLength(2);
    expect(segments[0].startSeconds).toBe(0.3);
    expect(segments[0].endSeconds).toBe(1.6);
    expect(segments[1].startSeconds).toBe(2.2);
    expect(segments.flatMap((s) => s.words!)).toEqual(words);
  });
  test('word and visual width limits never cut words', () => {
    const result = groupWords(words, {
      ...settings,
      maxWords: 2,
      maxCharacters: 16,
    });
    expect(result.every((s) => s.words!.length <= 2)).toBe(true);
    expect(result.map((s) => s.text).join(' ')).toBe(
      'Na madrugada escura. Um avião',
    );
  });
  test('absolute times use actual timeline start and never estimated duration', () => {
    const f = fixture(),
      result = subtitleSnapshot(f.timeline, f.p, f.state, [f.v]);
    expect(result.issues).toEqual([]);
    expect(result.snapshot.segments[0].startSeconds).toBe(12.8);
    expect(result.snapshot.segments[0].words![0].startSeconds).toBe(12.8);
  });
  test('snapshot owns text, words and style', () => {
    const f = fixture(),
      r = subtitleSnapshot(f.timeline, f.p, f.state, [f.v]);
    f.v.data.segments[0].text = 'changed';
    f.v.data.segments[0].words![0].text = 'changed';
    f.state.settings.textColor = '#000000';
    expect(r.snapshot.segments[0].text).toBe('Na madrugada escura.');
    expect(r.snapshot.segments[0].words![0].text).toBe('Na');
    expect(r.snapshot.settings.textColor).toBe('#FFFFFF');
  });
  test('switching audio rejects timestamps of previous version', () => {
    const f = fixture();
    f.timeline.scenes[0].audioAssetId = randomUUID();
    expect(
      subtitleSnapshot(f.timeline, f.p, f.state, [f.v]).issues[0].message,
    ).toContain('narração atual');
  });
  test('changed reference text is explicitly stale', () => {
    const f = fixture();
    f.p.scenes[0].narration = 'Outro texto';
    expect(
      subtitleSnapshot(f.timeline, f.p, f.state, [f.v]).issues[0].message,
    ).toContain('versão anterior');
  });
  test('foreign project or scene versions are rejected', () => {
    const f = fixture();
    f.v.projectId = randomUUID();
    expect(
      subtitleSnapshot(f.timeline, f.p, f.state, [f.v]).issues,
    ).toHaveLength(1);
  });
  test('disabled subtitles keep legacy rendering optional', () => {
    const f = fixture();
    f.state.settings.enabled = false;
    expect(subtitleSnapshot(f.timeline, f.p, f.state, [])).toMatchObject({
      snapshot: { segments: [], versions: [], settings: { enabled: false } },
      issues: [],
    });
  });
  test('invalid word timing falls back to actual valid provider segments without interpolation', () => {
    const result = prepareAlignment(
      {
        text: 'fala real',
        provider: 'mock',
        model: 'mock',
        granularity: 'WORD',
        segments: [{ text: 'fala real', startSeconds: 0.4, endSeconds: 1.8 }],
        words: [{ text: 'fala', startSeconds: 0.4, endSeconds: 0.4 }],
      },
      settings,
      3,
    );
    expect(result).toMatchObject({
      granularity: 'SEGMENT',
      words: undefined,
      segments: [{ text: 'fala real', startSeconds: 0.4, endSeconds: 1.8 }],
    });
    expect(result.alignmentNote).toContain('Revise');
  });
  test('unusable word and segment timestamps fail instead of inventing an alignment', () => {
    expect(() =>
      prepareAlignment(
        {
          text: 'fala',
          provider: 'mock',
          model: 'mock',
          granularity: 'WORD',
          segments: [{ text: 'fala', startSeconds: 2, endSeconds: 1 }],
          words: [{ text: 'fala', startSeconds: 0.4, endSeconds: 0.4 }],
        },
        settings,
        3,
      ),
    ).toThrow();
  });
  test('transcribed upload differs from reference without overwriting it', () => {
    expect(matchText('Era uma noite escura', 'O avião pousou')).toBeLessThan(
      0.85,
    );
    expect(matchText('Um avião desapareceu.', 'um aviao desapareceu')).toBe(1);
    expect(matchText('', 'fala')).toBeNull();
  });
  test.each([
    [-1, 1],
    [1, 1],
    [2, 1],
    [0, 5],
  ])('invalid interval %s %s rejected', (startSeconds, endSeconds) => {
    expect(() =>
      validateSegments(
        [
          {
            id: randomUUID(),
            order: 1,
            text: 'text',
            startSeconds,
            endSeconds,
          },
        ],
        4,
      ),
    ).toThrow();
  });
  test('overlap, empty text and duplicate IDs rejected', () => {
    const segments = groupWords(words, settings);
    segments[1].startSeconds = 1;
    expect(() => validateSegments(segments, 4)).toThrow();
    segments[1].startSeconds = 2.2;
    segments[1].id = segments[0].id;
    expect(() => validateSegments(segments, 4)).toThrow();
    segments[1].id = randomUUID();
    segments[1].text = ' ';
    expect(() => validateSegments(segments, 4)).toThrow();
  });
  test('styles bounded with strict color and position input', () => {
    expect(() =>
      SubtitleSettingsSchema.parse({ ...settings, textColor: 'red;movie=x' }),
    ).toThrow();
    expect(() =>
      SubtitleSettingsSchema.parse({ ...settings, fontSize: 1000 }),
    ).toThrow();
    expect(() =>
      SubtitleSettingsSchema.parse({ ...settings, verticalPosition: 1.5 }),
    ).toThrow();
    expect(settings.enabled).toBe(false);
  });
});
describe('UTF-8 SRT and safe ASS', () => {
  test('SRT uses millisecond absolute timestamps and accents', () => {
    const f = fixture(),
      r = subtitleSnapshot(f.timeline, f.p, f.state, [f.v]);
    const srt = exportSrt(r.snapshot);
    expect(srt).toContain('00:00:12,800 --> 00:00:14,100');
    expect(srt).toContain('Um avião');
    expect(srt).not.toContain('{\\');
  });
  test('ASS carries resolution, licensed font, stroke and explicit position', () => {
    const f = fixture(),
      r = subtitleSnapshot(f.timeline, f.p, f.state, [f.v]);
    const ass = exportAss(r.snapshot, 1920, 1080);
    expect(ass).toContain('PlayResX: 1920');
    expect(ass).toContain('Liberation Sans');
    expect(ass).toContain('\\pos(960,929)');
    expect(ass).toContain('Um avião');
  });
  test('user override sequences and backslashes cannot inject ASS tags', () => {
    expect(escapeAss('{\\pos(1,2)}café\nOlá')).toBe('｛＼pos(1,2)｝café\\NOlá');
  });
  test('dynamic highlights only during each real word interval', () => {
    const f = fixture();
    f.state.settings.preset = 'DYNAMIC';
    const ass = exportAss(
      subtitleSnapshot(f.timeline, f.p, f.state, [f.v]).snapshot,
      1920,
      1080,
    );
    expect(ass).toContain('0:00:12.80,0:00:13.00');
    expect(ass).toContain('0:00:13.00,0:00:13.05');
    expect(ass).toContain('{\\c&H0000D7FF&}Na');
  });
  test('segment-only dynamic never fabricates word highlights', () => {
    const f = fixture();
    f.state.settings.preset = 'DYNAMIC';
    f.v.data.segments = f.v.data.segments.map((s) => ({
      ...s,
      words: undefined,
    }));
    const ass = exportAss(
      subtitleSnapshot(f.timeline, f.p, f.state, [f.v]).snapshot,
      1920,
      1080,
    );
    expect(ass).not.toContain('{\\c');
  });
  test('line limits fail clearly instead of silently clipping paragraphs', () => {
    expect(() =>
      wrapSubtitle('uma legenda longa '.repeat(20), settings),
    ).toThrow('máximo de linhas');
  });
});
