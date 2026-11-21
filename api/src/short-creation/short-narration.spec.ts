jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
import {
  narrationSchema,
  resolveNarrationMode,
  narrationJobBlock,
} from './short-narration.schema';
import {
  createShortSchema,
  patchShortSchema,
  shortStepAllowed,
  type ShortData,
  type ShortProject,
  type ShortFile,
} from './short.schema';
import { ShortService } from './short.service';
const config = (mode: 'WITH_NARRATION' | 'WITHOUT_NARRATION') => ({
  version: 1 as const,
  mode,
});
const original = (): ShortData => ({
  scriptApproved: true,
  narrationText: 'Texto preservado',
  textApproved: true,
  audio: {
    key: 'voice.wav',
    duration: 5,
    bytes: 100,
    mime: 'audio/wav',
    usage: null,
  },
  plan: {
    clips: [{ fileId: 'f', start: 0, end: 5, description: 'Trecho' }],
    semantic: false,
    notice: '',
  },
  planApproved: true,
  output: {
    key: 'out.mp4',
    bytes: 100,
    duration: 5,
    width: 1080,
    height: 1920,
    fps: 30,
    createdAt: 'now',
  },
  classification: {
    version: 1,
    videoType: 'TOP_X',
    videoTopic: 'HUMOR',
    editingStyle: 'DYNAMIC',
  },
  musicEnabled: false,
});
function harness(data: ShortData = original(), step = 9) {
  const p = {
    id: 'p',
    revision: 3,
    data,
    step,
    status: 'COMPLETED',
  } as ShortProject;
  const query = jest.fn().mockResolvedValue({ rows: [{ n: 0 }] });
  const service = new ShortService(
    {} as never,
    { enabled: true } as never,
    {} as never,
    {} as never,
  );
  jest
    .spyOn(service, 'locked')
    .mockImplementation(async (_id, fn) => fn(p, { query } as never));
  jest.spyOn(service, 'get').mockResolvedValue({} as never);
  jest.spyOn(service, 'files').mockResolvedValue([{ id: 'f' }] as never);
  const stored = () =>
    query.mock.calls.find(([sql]) =>
      sql.startsWith('UPDATE short_projects'),
    )?.[1];
  return { p, query, service, stored };
}
describe('Optional narration compatibility boundary', () => {
  test('legacy default resolves without mutating or filling legacy data', () => {
    const data = Object.freeze(original());
    expect(resolveNarrationMode(data)).toBe('WITH_NARRATION');
    expect(data).not.toHaveProperty('narration');
    expect(
      shortStepAllowed({ data } as ShortProject, [{} as ShortFile], 9),
    ).toBeTruthy();
  });
  test.each(['WITH_NARRATION', 'WITHOUT_NARRATION'] as const)(
    'accepts explicit creation and patch %s',
    (mode) => {
      expect(
        createShortSchema.parse({
          description: 'Um vídeo de teste',
          targetSeconds: 30,
          narration: config(mode),
        }).narration,
      ).toEqual(config(mode));
      expect(
        patchShortSchema.parse({ revision: 3, narration: config(mode) })
          .narration,
      ).toEqual(config(mode));
    },
  );
  test.each([
    {},
    null,
    { version: 2, mode: 'WITH_NARRATION' },
    { version: 1, mode: 'AUTO' },
    { version: 1, mode: 'WITHOUT_NARRATION', approved: true },
  ])('rejects invalid configuration %j', (value) =>
    expect(narrationSchema.safeParse(value).success).toBe(false),
  );
  test('round trip and mode reversal preserve historical narration and approvals', async () => {
    const old = original(),
      h = harness(old);
    await h.service.patch('p', {
      revision: 3,
      narration: config('WITHOUT_NARRATION'),
    });
    const stored = JSON.parse(JSON.stringify(h.stored()[1])) as ShortData;
    expect(resolveNarrationMode(stored)).toBe('WITHOUT_NARRATION');
    expect(stored.narrationText).toBe(old.narrationText);
    expect(stored.audio).toEqual(old.audio);
    expect(stored.textApproved).toBe(true);
    expect(stored.classification).toEqual(old.classification);
    expect(stored).not.toHaveProperty('plan');
    expect(stored).not.toHaveProperty('output');
    expect(h.stored()[2]).toBe(4);
    expect(old).toHaveProperty('output');
    expect(
      h.query.mock.calls
        .filter(([sql]) => sql.includes('short_storage_cleanup'))
        .map(([, params]) => params[0]),
    ).toEqual(['out.mp4']);
    const back = harness(stored, 5);
    await back.service.patch('p', {
      revision: 3,
      narration: config('WITH_NARRATION'),
    });
    expect(back.stored()[1]).toMatchObject({
      narration: config('WITH_NARRATION'),
      audio: old.audio,
      narrationText: old.narrationText,
      textApproved: true,
    });
  });
  test('saving unchanged effective mode preserves completed output', async () => {
    const h = harness();
    await h.service.patch('p', {
      revision: 3,
      narration: config('WITH_NARRATION'),
    });
    expect(h.stored()[1].output).toEqual(h.p.data.output);
    expect(h.stored()[2]).toBe(9);
    expect(h.stored()[3]).toBe('COMPLETED');
  });
  test('does not invent approvals or audio when returning to narrated mode', async () => {
    const h = harness({ narration: config('WITHOUT_NARRATION') }, 4);
    await h.service.patch('p', {
      revision: 3,
      narration: config('WITH_NARRATION'),
    });
    expect(h.stored()[1]).not.toHaveProperty('textApproved');
    expect(h.stored()[1]).not.toHaveProperty('audio');
  });
  test.each(['TEXT', 'AUDIO', 'PLAN', 'RENDER'])(
    'blocks %s before enqueue and paid calls even with historical audio',
    async (kind) => {
      const h = harness(
        { ...original(), narration: config('WITHOUT_NARRATION') },
        5,
      );
      await expect(
        h.service.enqueue('p', { revision: 3, kind, confirm: true }),
      ).rejects.toThrow(/dispensada|sem narração/);
      expect(h.query).not.toHaveBeenCalled();
      expect(narrationJobBlock(h.p.data, kind)).toBeTruthy();
      expect(narrationJobBlock({}, kind)).toBeNull();
    },
  );
  test('script and reference jobs retain their own existing preconditions', () => {
    const data = { narration: config('WITHOUT_NARRATION') };
    expect(narrationJobBlock(data, 'SCRIPT')).toBeNull();
    expect(narrationJobBlock(data, 'REFERENCES')).toBeNull();
  });
  test('dispenses text gate but cannot bypass script, files or legacy render boundary', () => {
    const data = {
      narration: config('WITHOUT_NARRATION'),
      scriptApproved: true,
    };
    const p = { data } as ShortProject,
      files = [{} as ShortFile];
    expect(shortStepAllowed(p, files, 5)).toBeTruthy();
    expect(shortStepAllowed(p, [], 5)).toBeFalsy();
    expect(
      shortStepAllowed(
        { data: { narration: data.narration } } as ShortProject,
        files,
        5,
      ),
    ).toBeFalsy();
    for (const step of [6, 7, 8])
      expect(
        shortStepAllowed(
          { ...p, data: { ...original(), ...data } },
          files,
          step,
        ),
      ).toBe(false);
    expect(
      shortStepAllowed(
        { data: { scriptApproved: true } } as ShortProject,
        files,
        5,
      ),
    ).toBeFalsy();
  });
  test('step 5 persists without text or forged approval', async () => {
    const h = harness(
      { scriptApproved: true, narration: config('WITHOUT_NARRATION') },
      4,
    );
    await h.service.patch('p', { revision: 3, step: 5 });
    expect(h.stored()[2]).toBe(5);
    expect(h.stored()[1]).not.toHaveProperty('textApproved');
    expect(h.stored()[1].narration).toEqual(config('WITHOUT_NARRATION'));
  });
  test.each([
    { approve: 'TEXT' },
    { narrationText: 'Texto' },
    { voice: 'cedar' },
  ])('rejects narration changes while dispensed %j', async (change) => {
    const h = harness({ narration: config('WITHOUT_NARRATION') }, 4);
    await expect(
      h.service.patch('p', { revision: 3, ...change }),
    ).rejects.toThrow('dispensada');
    expect(h.query).not.toHaveBeenCalled();
  });
  test('mode cannot be mixed with content edits or stale revision', async () => {
    const h = harness();
    await expect(
      h.service.patch('p', {
        revision: 3,
        narration: config('WITHOUT_NARRATION'),
        step: 8,
      }),
    ).rejects.toThrow('separadamente');
    await expect(
      h.service.patch('p', {
        revision: 2,
        narration: config('WITHOUT_NARRATION'),
      }),
    ).rejects.toThrow('mudou');
    expect(h.query).not.toHaveBeenCalled();
  });
  test.each(['QUEUED', 'RUNNING'])(
    'real transaction lock blocks %s mode transition',
    async (status) => {
      const p = {
        id: 'p',
        revision: 3,
        status,
        data: original(),
      } as ShortProject;
      const query = jest.fn().mockResolvedValue({ rows: [p] });
      const db = {
        withClient: async (fn: (c: unknown) => unknown) => fn({ query }),
      };
      const service = new ShortService(
        db as never,
        { owner: 'owner' } as never,
        {} as never,
        {} as never,
      );
      await expect(
        service.patch('p', {
          revision: 3,
          narration: config('WITHOUT_NARRATION'),
        }),
      ).rejects.toThrow('Aguarde');
      expect(query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
      expect(query.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(
        false,
      );
    },
  );
  test('owner filter denies unauthorized project before mutation', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const db = {
      withClient: async (fn: (c: unknown) => unknown) => fn({ query }),
    };
    const service = new ShortService(
      db as never,
      { owner: 'owner' } as never,
      {} as never,
      {} as never,
    );
    await expect(
      service.patch('p', {
        revision: 3,
        narration: config('WITHOUT_NARRATION'),
      }),
    ).rejects.toThrow();
    expect(query.mock.calls.find(([sql]) => sql.startsWith('SELECT'))).toEqual([
      expect.stringContaining('owner_id=$2'),
      ['p', 'owner'],
    ]);
    expect(query.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(
      false,
    );
  });
});
