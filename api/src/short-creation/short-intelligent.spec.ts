jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
import { ShortIntelligentService } from './short-intelligent.service';
import { ShortSettings } from './short.settings';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import type { ShortProject, ShortFile } from './short.schema';
import { canonicalHash } from './short-engine.schema';
describe('Intelligent integration authority and costs', () => {
  let dir: string,
    values: Record<string, string>,
    llm: any,
    storage: any,
    engine: ShortIntelligentService;
  beforeEach(async () => {
    dir = await mkdtemp('/tmp/short-intelligent-unit-');
    values = {
      SHORT_CREATION_TEMP_DIR: dir,
      SHORT_INTELLIGENT_ENGINE_ENABLED: 'true',
      SHORT_INTELLIGENT_TEST_COMBINATIONS: 'GAMEPLAY/GAMING/MINIMALIST',
    };
    const settings = new ShortSettings({
      get: (k: string) => values[k],
    } as never);
    llm = { generateStructuredOutput: jest.fn() };
    storage = { copyTo: jest.fn(), stat: jest.fn() };
    engine = new ShortIntelligentService(settings, storage, {} as never, llm);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const p = () =>
    ({
      id: 'project-a',
      data: {
        scriptApproved: true,
        editingEngine: { version: 1, mode: 'INTELLIGENT' },
        classification: {
          version: 1,
          videoType: 'GAMEPLAY',
          videoTopic: 'GAMING',
          editingStyle: 'MINIMALIST',
        },
      },
    }) as ShortProject;
  test('disabled flag prevents activation before touching providers or storage', () => {
    values.SHORT_INTELLIGENT_ENGINE_ENABLED = 'false';
    expect(() => engine.assertEnabled(p())).toThrow('desabilitada');
    expect(llm.generateStructuredOutput).not.toHaveBeenCalled();
  });
  test('an unlisted classification remains unavailable regardless of frontend metadata', () => {
    values.SHORT_INTELLIGENT_TEST_COMBINATIONS = '';
    expect(() => engine.assertEnabled(p())).toThrow('não autorizada');
  });
  test('production additionally requires explicit experimental opt-in', () => {
    values.NODE_ENV = 'production';
    expect(() => engine.assertEnabled(p())).toThrow('não autorizada');
    values.SHORT_INTELLIGENT_ALLOW_EXPERIMENTAL = 'true';
    expect(() => engine.assertEnabled(p())).not.toThrow();
  });
  test('paid planning is never enabled by an API boolean or by engine activation', async () => {
    await expect(
      engine.plan(p(), [], 'job', new AbortController().signal),
    ).rejects.toThrow('pago não autorizado');
    expect(llm.generateStructuredOutput).not.toHaveBeenCalled();
  });
  test('source from another project is rejected before any copy and workspace is disposed', async () => {
    await expect(
      engine.prepare(
        p(),
        [{ project_id: 'other', bytes: '100' } as ShortFile],
        'plan',
        new AbortController().signal,
      ),
    ).rejects.toThrow('não autorizada');
    expect(storage.copyTo).not.toHaveBeenCalled();
    expect(await readdir(dir)).toEqual([]);
  });
  test('empty sources cannot invoke planning', async () => {
    await expect(
      engine.prepare(p(), [], 'plan', new AbortController().signal),
    ).rejects.toThrow('vídeos autorizados');
    expect(llm.generateStructuredOutput).not.toHaveBeenCalled();
  });
  test.each(['READY_FOR_REVIEW', 'REJECTED', 'INVALIDATED', 'SUPERSEDED'])(
    'executor cannot run unapproved state %s',
    async (status) => {
      const prepare = jest.spyOn(engine, 'prepare');
      await expect(
        engine.render(
          p(),
          [],
          { status } as never,
          'job',
          new AbortController().signal,
          async () => {},
        ),
      ).rejects.toThrow('Aprove');
      expect(prepare).not.toHaveBeenCalled();
    },
  );
  test('tampering after approval is rejected before file resolution', async () => {
    const prepare = jest.spyOn(engine, 'prepare');
    await expect(
      engine.render(
        p(),
        [],
        {
          status: 'APPROVED',
          approvalId: 'a',
          plan: { version: 2 },
          approvedPlanHash: canonicalHash({ version: 1 }),
        } as never,
        'job',
        new AbortController().signal,
        async () => {},
      ),
    ).rejects.toThrow('Aprove');
    expect(prepare).not.toHaveBeenCalled();
  });
});
