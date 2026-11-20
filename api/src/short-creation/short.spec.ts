jest.mock('@nestjs/config', () => ({
  ConfigService: class {
    constructor(private values: Record<string, unknown> = {}) {}
    get(key: string) {
      return this.values[key];
    }
  },
}));
import { ConfigService } from '@nestjs/config';
import {
  buildShortPlan,
  createShortSchema,
  patchShortSchema,
  shortStepAllowed,
  type ShortProject,
  type ShortFile,
} from './short.schema';
import { ShortSettings } from './short.settings';
import { ShortService } from './short.service';
const file = { id: 'f', duration: 20 } as ShortFile;
const project = (data: ShortProject['data'] = {}) =>
  ({ id: 'p', revision: 2, step: 1, data, status: 'DRAFT' }) as ShortProject;
describe('Criar Short', () => {
  test('limits short creation to the requested durations and bounded description', () => {
    expect(
      createShortSchema.parse({
        description: 'Um mistério no oceano',
        targetSeconds: 45,
      }).targetSeconds,
    ).toBe(45);
    expect(
      createShortSchema.safeParse({ description: 'abc', targetSeconds: 120 })
        .success,
    ).toBe(false);
  });
  test('script and narration edits cannot forge approval data or timeline paths', () => {
    expect(
      patchShortSchema.safeParse({
        revision: 0,
        output: { key: 'private.mp4' },
      }).success,
    ).toBe(false);
    expect(
      patchShortSchema.safeParse({ revision: 0, scriptApproved: true }).success,
    ).toBe(false);
    expect(
      patchShortSchema.safeParse({
        revision: 0,
        narrationText: 'a'.repeat(4097),
      }).success,
    ).toBe(false);
  });
  test('enforces approval and upload gates in the nine steps', () => {
    expect(shortStepAllowed(project(), [], 2)).toBeFalsy();
    expect(
      shortStepAllowed(project({ scriptApproved: true }), [], 2),
    ).toBeTruthy();
    expect(
      shortStepAllowed(project({ scriptApproved: true }), [], 3),
    ).toBeFalsy();
    expect(
      shortStepAllowed(project({ scriptApproved: true }), [file], 3),
    ).toBeTruthy();
    expect(
      shortStepAllowed(project({ textApproved: false }), [file], 5),
    ).toBeFalsy();
    expect(
      shortStepAllowed(project({ textApproved: true }), [file], 5),
    ).toBeTruthy();
    expect(shortStepAllowed(project(), [file], 6)).toBeFalsy();
    expect(shortStepAllowed(project(), [file], 7)).toBeFalsy();
  });
  test('plans one uploaded video to exact real audio duration with bounded cuts', () => {
    const clips = buildShortPlan(
      [{ fileId: 'a', start: 0, end: 30, description: 'Cena', score: 0 }],
      12.34,
    );
    expect(clips).toHaveLength(1);
    expect(clips[0].start).toBeGreaterThanOrEqual(0);
    expect(clips[0].end).toBeLessThanOrEqual(30);
    expect(clips[0].end - clips[0].start).toBeCloseTo(12.34);
  });
  test('uses distinct uploaded sources without inventing timestamps or repeating intervals', () => {
    const candidates = [
      { fileId: 'a', start: 0, end: 12, description: 'A', score: 0 },
      { fileId: 'b', start: 4, end: 17, description: 'B', score: 0 },
    ];
    const clips = buildShortPlan(candidates, 18);
    expect(clips.map((c) => c.fileId)).toEqual(['a', 'b']);
    expect(clips.reduce((sum, c) => sum + c.end - c.start, 0)).toBeCloseTo(18);
    clips.forEach((c, i) => {
      expect(c.start).toBeGreaterThanOrEqual(candidates[i].start);
      expect(c.end).toBeLessThanOrEqual(candidates[i].end);
    });
  });
  test('refuses insufficient footage, invalid timestamps and oversized audio', () => {
    expect(() =>
      buildShortPlan(
        [{ fileId: 'a', start: 0, end: 2, description: 'A', score: 0 }],
        20,
      ),
    ).toThrow('Material insuficiente');
    expect(() =>
      buildShortPlan(
        [{ fileId: 'a', start: -1, end: 10, description: 'A', score: 0 }],
        5,
      ),
    ).toThrow('inválido');
    expect(() => buildShortPlan([], 91)).toThrow('90 segundos');
  });
  test('configuration reuses existing models and validates upload bounds', () => {
    const c = new ConfigService({ VIDEO_REMIX_SCRIPT_MODEL: 'existing' });
    expect(new ShortSettings(c).model).toBe('existing');
    expect(
      () =>
        new ShortSettings(new ConfigService({ SHORT_CREATION_MAX_FILES: 100 }))
          .maxFiles,
    ).toThrow();
  });
  test('hides projects owned by another user', async () => {
    const service = new ShortService(
      { query: jest.fn().mockResolvedValue({ rows: [] }) } as never,
      { owner: 'alice' } as never,
      {} as never,
      {} as never,
    );
    await expect(service.project('id')).rejects.toThrow('não encontrado');
  });
  test('skipping optional references preserves an existing baseline narration and output', async () => {
    const p = project({
      scriptApproved: true,
      textApproved: true,
      narrationText: 'Original',
      audio: { key: 'audio.wav', duration: 3 } as never,
      output: { key: 'video.mp4' } as never,
    });
    p.step = 3;
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const service = new ShortService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    jest
      .spyOn(service, 'locked')
      .mockImplementation(async (_id, fn) => fn(p, { query } as never));
    jest.spyOn(service, 'files').mockResolvedValue([file]);
    jest.spyOn(service, 'get').mockResolvedValue({} as never);
    await service.patch('p', { revision: 2, skipReferences: true });
    const update = query.mock.calls.find(([sql]) =>
      sql.startsWith('UPDATE short_projects'),
    );
    expect(update?.[1][1].narrationText).toBe('Original');
    expect(update?.[1][1].audio.key).toBe('audio.wav');
    expect(update?.[1][1].output.key).toBe('video.mp4');
    expect(update?.[1][2]).toBe(4);
    expect(
      query.mock.calls.some(([sql]) => sql.includes('short_storage_cleanup')),
    ).toBe(false);
  });
  test('editing narration invalidates approvals, audio, plan and final video atomically', async () => {
    const p = project({
      scriptApproved: true,
      textApproved: true,
      narrationText: 'Old',
      audio: { key: 'audio.mp3' } as never,
      plan: { clips: [], semantic: false, notice: '' },
      planApproved: true,
      output: { key: 'final.mp4' } as never,
    });
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const service = new ShortService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    jest
      .spyOn(service, 'locked')
      .mockImplementation(async (_id, fn) => fn(p, { query } as never));
    jest.spyOn(service, 'files').mockResolvedValue([file]);
    jest.spyOn(service, 'get').mockResolvedValue({} as never);
    await service.patch('p', { revision: 2, narrationText: 'New' });
    const update = query.mock.calls.find(([sql]) =>
      sql.startsWith('UPDATE short_projects'),
    );
    expect(update?.[1][1]).toMatchObject({
      textApproved: false,
      narrationText: 'New',
      planApproved: false,
    });
    expect(update?.[1][1].audio).toBeUndefined();
    expect(update?.[1][1].plan).toBeUndefined();
    expect(update?.[1][1].output).toBeUndefined();
    expect(update?.[1][2]).toBe(4);
    expect(
      query.mock.calls.filter(([sql]) => sql.includes('short_storage_cleanup')),
    ).toHaveLength(2);
  });
});
