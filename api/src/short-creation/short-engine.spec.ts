jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
import {
  editingEngineSchema,
  resolveEditingEngine,
  canonicalHash,
  invalidateIntelligent,
  intelligentDependencies,
} from './short-engine.schema';
import {
  shortStepAllowed,
  createShortSchema,
  patchShortSchema,
  type ShortData,
  type ShortProject,
  type ShortFile,
} from './short.schema';
import { ShortSettings } from './short.settings';
import { ShortService } from './short.service';
const configuration = { version: 1 as const, mode: 'INTELLIGENT' as const };
const project = (data: ShortData) =>
  ({ id: 'p', revision: 2, step: 6, status: 'DRAFT', data }) as ShortProject;
const files = [{} as ShortFile];
describe('Engine integration contract and safety', () => {
  test('old projects remain LEGACY without mutation', () => {
    const d = Object.freeze({});
    expect(resolveEditingEngine(d)).toBe('LEGACY');
    expect(d).toEqual({});
  });
  test.each([
    { version: 2, mode: 'INTELLIGENT' },
    { version: 1, mode: 'AUTO' },
    { version: 1, mode: 'INTELLIGENT', enabled: true },
  ])('rejects untrusted configuration %j', (raw) =>
    expect(editingEngineSchema.safeParse(raw).success).toBe(false),
  );
  test('accepts explicit engine creation and isolated patch contract', () => {
    expect(
      createShortSchema.parse({
        description: 'Um projeto de teste',
        targetSeconds: 30,
        editingEngine: configuration,
      }).editingEngine,
    ).toEqual(configuration);
    expect(
      patchShortSchema.parse({ revision: 2, editingEngine: configuration })
        .editingEngine,
    ).toEqual(configuration);
  });
  test.each([undefined, 'false', true, 'TRUE'])(
    'feature flag fails closed for %s',
    (flag) => {
      const s = new ShortSettings({ get: () => flag } as never);
      expect(s.intelligentEnabled).toBe(false);
    },
  );
  test('server controls flag and exact combination allowlist', () => {
    const c: any = {
      SHORT_INTELLIGENT_ENGINE_ENABLED: 'true',
      SHORT_INTELLIGENT_TEST_COMBINATIONS: ' GAMEPLAY/GAMING/MINIMALIST ',
    };
    const s = new ShortSettings({ get: (k: string) => c[k] } as never);
    expect(s.intelligentEnabled).toBe(true);
    expect(
      s.intelligentCombination({
        videoType: 'GAMEPLAY',
        videoTopic: 'GAMING',
        editingStyle: 'MINIMALIST',
      }),
    ).toBe(true);
    expect(
      s.intelligentCombination({
        videoType: 'TOP_X',
        videoTopic: 'HUMOR',
        editingStyle: 'DYNAMIC',
      }),
    ).toBe(false);
    expect(s.intelligentPaidPlanning).toBe(false);
    expect(s.intelligentPlanningLimit).toBe(10);
  });
  test('fingerprints stable with key ordering but sensitive to source change', () => {
    expect(canonicalHash({ b: 2, a: 1 })).toBe(canonicalHash({ a: 1, b: 2 }));
    expect(canonicalHash({ a: 1 })).not.toBe(canonicalHash({ a: 2 }));
  });
  test('approval and output are not semantic dependencies', () => {
    expect(
      canonicalHash(
        intelligentDependencies({ scriptApproved: true, planApproved: true }),
      ),
    ).toBe(
      canonicalHash(
        intelligentDependencies({ scriptApproved: false, planApproved: false }),
      ),
    );
  });
  test('invalidation preserves approval evidence, old plan and output history', () => {
    const d: any = {
      intelligentPlan: { status: 'APPROVED', approvalId: 'a' },
      output: { key: 'result.mp4' },
    };
    invalidateIntelligent(d);
    expect(d.intelligentPlan.status).toBe('INVALIDATED');
    expect(d.intelligentPlan.approvalId).toBe('a');
    expect(d.output).toBeUndefined();
    expect(d.resultHistory).toEqual([{ key: 'result.mp4' }]);
    invalidateIntelligent(d);
    expect(d.resultHistory).toHaveLength(1);
  });
  test.each([6, 7, 8])(
    'legacy without voice remains blocked at step %s',
    (step) => {
      expect(
        shortStepAllowed(
          project({
            narration: { version: 1, mode: 'WITHOUT_NARRATION' },
            scriptApproved: true,
          }),
          files,
          step,
        ),
      ).toBe(false);
    },
  );
  test('intelligent without narration can plan without fake audio or approval', () => {
    const d: ShortData = {
      editingEngine: configuration,
      editingMode: 'EDITORIAL_CLASSIFICATION',
      scriptApproved: true,
      narration: { version: 1, mode: 'WITHOUT_NARRATION' },
    };
    expect(shortStepAllowed(project(d), files, 6)).toBe(true);
    expect(d.audio).toBeUndefined();
    expect(d.textApproved).toBeUndefined();
    expect(shortStepAllowed(project(d), files, 8)).toBe(false);
  });
  test('intelligent with narration requires real approved text and audio', () => {
    const d: ShortData = { editingEngine: configuration, scriptApproved: true };
    expect(shortStepAllowed(project(d), files, 6)).toBe(false);
  });
  test.each(['READY_FOR_REVIEW', 'REJECTED', 'INVALIDATED', 'SUPERSEDED'])(
    'render gate rejects plan state %s',
    (status) =>
      expect(
        shortStepAllowed(
          project({
            editingEngine: configuration,
            intelligentPlan: { status } as never,
          }),
          files,
          8,
        ),
      ).toBe(false),
  );
  test('owner-scoped lookup rejects missing or other-owner project', async () => {
    const q = jest.fn().mockResolvedValue({ rows: [] });
    const s = new ShortService(
      { query: q } as never,
      { owner: 'owner-a' } as never,
      {} as never,
      {} as never,
    );
    await expect(s.project('p')).rejects.toThrow('não encontrado');
    expect(q.mock.calls[0][1]).toEqual(['p', 'owner-a']);
  });
  test('engine switch checks optimistic revision before writing', async () => {
    const s = new ShortService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const q = jest.fn();
    jest
      .spyOn(s, 'locked')
      .mockImplementation(async (_id, fn) =>
        fn(project({}), { query: q } as never),
      );
    await expect(
      s.patch('p', { revision: 1, editingEngine: configuration }),
    ).rejects.toThrow('mudou');
    expect(q).not.toHaveBeenCalled();
  });
  test('cleanup retains old results and audio without scheduling deletion', async () => {
    const s = new ShortService(
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      ),
      q = jest.fn();
    const old: any = {
        editingEngine: configuration,
        audio: { key: 'voice.wav' },
        output: { key: 'out.mp4' },
      },
      next: any = { editingEngine: configuration };
    await s.cleanupData({ query: q } as never, old, next);
    expect(next.resultHistory[0].key).toBe('out.mp4');
    expect(next.retainedKeys).toContain('voice.wav');
    expect(q).not.toHaveBeenCalled();
  });
});
