jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
import {
  EXPORT_PRESETS,
  exportPreset,
  customExportSchema,
  technicalIssues,
  compatible,
  safeExportName,
  reviewSchema,
  metadataSchema,
  type MediaInfo,
} from './remix-review.schema';
const valid = (): MediaInfo => ({
  container: 'mov,mp4,m4a,3gp,3g2,mj2',
  brand: 'isom',
  videoCodec: 'h264',
  audioCodec: 'aac',
  width: 1080,
  height: 1920,
  fps: 30,
  duration: 35,
  videoDuration: 35,
  audioDuration: 35,
  byteSize: 10000,
});
const expected = {
  width: 1080,
  height: 1920,
  fps: 30,
  duration: 35,
  size: 10000,
};
describe('Remix review/export contracts', () => {
  it('centralizes three presets without inventing platform duration limits', () => {
    expect(EXPORT_PRESETS.map((p) => p.id)).toEqual([
      'YOUTUBE_SHORTS',
      'INSTAGRAM_REELS',
      'TIKTOK',
    ]);
    expect(
      EXPORT_PRESETS.every(
        (p) =>
          !('maxDuration' in p) &&
          p.width === 1080 &&
          p.height === 1920 &&
          p.fps === 30,
      ),
    ).toBe(true);
  });
  it('only accepts bounded custom formats and matching 9:16 dimensions', () => {
    expect(
      exportPreset('CUSTOM', { width: 540, height: 960, fps: 24 }).fps,
    ).toBe(24);
    expect(
      customExportSchema.safeParse({ width: 540, height: 1920, fps: 30 })
        .success,
    ).toBe(false);
    expect(
      customExportSchema.safeParse({ width: 1080, height: 1920, fps: 120 })
        .success,
    ).toBe(false);
    expect(
      customExportSchema.safeParse({
        width: 1080,
        height: 1920,
        fps: 30,
        filter: 'unsafe',
      }).success,
    ).toBe(false);
  });
  it('reuses compatible files and requires conversion for resolution/FPS/codec changes', () => {
    const m = valid(),
      p = exportPreset('YOUTUBE_SHORTS');
    expect(compatible(m, p)).toBe(true);
    expect(compatible({ ...m, width: 540, height: 960 }, p)).toBe(false);
    expect(compatible({ ...m, fps: 24 }, p)).toBe(false);
    expect(compatible({ ...m, audioCodec: 'mp3' }, p)).toBe(false);
  });
  it('validates codec, size, resolution, fps, container, duration and complete audio', () => {
    expect(technicalIssues(valid(), expected)).toEqual([]);
    expect(
      technicalIssues({ ...valid(), videoDuration: 1 }, expected).some(
        (i) => i.code === 'VIDEO_DURATION',
      ),
    ).toBe(true);
    const issues = technicalIssues(
      {
        ...valid(),
        container: 'matroska',
        videoCodec: 'vp9',
        audioCodec: '',
        width: 540,
        fps: NaN,
        duration: 30,
        audioDuration: 1,
        byteSize: 0,
      },
      expected,
    );
    expect(new Set(issues.map((i) => i.code)).size).toBe(8);
    expect(issues.every((i) => i.severity === 'ERROR')).toBe(true);
    expect(
      technicalIssues({ ...valid(), brand: 'qt  ' }, expected)[0].code,
    ).toBe('CONTAINER');
  });
  it('preserves full narration with a small mux/frame tolerance', () => {
    expect(
      technicalIssues(
        { ...valid(), duration: 35.04, audioDuration: 35 },
        expected,
      ),
    ).toEqual([]);
    expect(
      technicalIssues({ ...valid(), audioDuration: 34 }, expected).map(
        (i) => i.code,
      ),
    ).toContain('AUDIO_DURATION');
  });
  it('safe names contain project, mode, version and collision-resistant identifier', () => {
    const name = safeExportName(
      '../../GTA Více City\r\n"',
      'MULTI_SOURCE',
      3,
      'a1234567-dead-beef',
    );
    expect(name).toBe('gta-vice-city-multi-v3-a1234567.mp4');
    expect(name).not.toMatch(/[/\\\r\n"]/);
  });
  it('accepts only real manual scores from 1 to 5, allowing unreviewed criteria', () => {
    expect(
      reviewSchema.parse({
        revision: 0,
        ratings: { overall: 4 },
        notes: 'Revisão pessoal',
      }).ratings.visualCoherence,
    ).toBeNull();
    for (const score of [0, 6, 3.5, '5'])
      expect(
        reviewSchema.safeParse({
          revision: 0,
          ratings: { overall: score },
          notes: '',
        }).success,
      ).toBe(false);
  });
  it('normalizes relevant manual hashtags and protects optimistic revision payloads', () => {
    const m = metadataSchema.parse({
      title: 'Título',
      description: 'Descrição',
      hashtags: ['teste', '#teste'],
      language: 'pt-BR',
      status: 'READY',
    });
    expect(m.hashtags).toEqual(['#teste']);
    expect(metadataSchema.safeParse({ ...m, title: '<unsafe>' }).success).toBe(
      false,
    );
    expect(
      metadataSchema.safeParse({ ...m, hashtags: ['#not valid'] }).success,
    ).toBe(false);
    expect(metadataSchema.safeParse({ ...m, description: '' }).success).toBe(
      false,
    );
  });
});
