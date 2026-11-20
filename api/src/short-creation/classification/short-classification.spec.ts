jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
import { defineClassificationCatalog } from './catalog-entry';
import { shortClassificationCatalogs } from './short-classification.catalog';
import {
  shortClassificationSchema,
  availableShortClassificationSchema,
  videoTypeSchema,
  videoTopicSchema,
  editingStyleSchema,
} from './short-classification.schema';
import {
  createShortSchema,
  patchShortSchema,
  type ShortProject,
} from '../short.schema';
import { ShortService } from '../short.service';
import { ShortWorker } from '../short.worker';
const classification = {
  version: 1 as const,
  videoType: 'TOP_X' as const,
  videoTopic: 'HUMOR' as const,
  editingStyle: 'DYNAMIC' as const,
};
const options = {
  enabled: true,
  maxBytes: 123,
  musicMaxBytes: 456,
  musicMaxSeconds: 3600,
  maxFiles: 5,
  maxDuration: 1200,
  scanSeconds: 600,
  referenceFiles: 3,
  referenceSeconds: 90,
  referenceFrames: 12,
};
describe('Short classification metadata', () => {
  test('publishes all stable identifiers in three independent versioned catalogs', () => {
    expect(shortClassificationCatalogs.version).toBe(1);
    expect(shortClassificationCatalogs.usage).toBe('EDITORIAL_INTENT_ONLY');
    expect(shortClassificationCatalogs.videoTypes.map((e) => e.id)).toEqual([
      'TOP_X',
      'X_THINGS_ABOUT',
      'CURIOSITY',
      'GAMEPLAY',
      'VIBE',
    ]);
    expect(shortClassificationCatalogs.videoTopics.map((e) => e.id)).toEqual([
      'HUMOR',
      'GAMING',
      'ANIMALS',
      'HORROR',
      'GENERAL_CURIOSITIES',
    ]);
    expect(shortClassificationCatalogs.editingStyles.map((e) => e.id)).toEqual([
      'DYNAMIC',
      'MINIMALIST',
      'DOCUMENTARY',
      'CINEMATIC',
      'ANALOG_HORROR',
      'RELAXING',
      'NOSTALGIC',
      'EPIC',
    ]);
    for (const entries of [
      shortClassificationCatalogs.videoTypes,
      shortClassificationCatalogs.videoTopics,
      shortClassificationCatalogs.editingStyles,
    ]) {
      expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
      expect(Object.isFrozen(entries)).toBe(true);
      for (const entry of entries) {
        expect(entry.name.length).toBeGreaterThan(0);
        expect(entry.description.length).toBeGreaterThan(0);
        expect(entry.available).toBe(false);
        expect(Object.isFrozen(entry)).toBe(true);
      }
    }
  });
  test('catalog definition rejects duplicate IDs and malformed metadata', () => {
    const item = {
      id: 'EXAMPLE',
      name: 'Exemplo',
      description: 'Descrição',
      available: false,
    };
    expect(() => defineClassificationCatalog([item, { ...item }])).toThrow();
    expect(() =>
      defineClassificationCatalog([{ ...item, id: 'invalid-id' }]),
    ).toThrow();
    expect(() => defineClassificationCatalog([])).toThrow();
  });
  test('accepts every registered video type, topic and style without constraining combinations', () => {
    for (const type of shortClassificationCatalogs.videoTypes)
      for (const topic of shortClassificationCatalogs.videoTopics)
        for (const style of shortClassificationCatalogs.editingStyles) {
          expect(
            shortClassificationSchema.parse({
              version: 1,
              videoType: type.id,
              videoTopic: topic.id,
              editingStyle: style.id,
            }),
          ).toMatchObject({
            videoType: type.id,
            videoTopic: topic.id,
            editingStyle: style.id,
          });
        }
  });
  test('rejects unregistered, wrong-axis, incomplete, unversioned, future and forged classifications', () => {
    for (const value of [
      { ...classification, videoType: 'UNKNOWN' },
      { ...classification, videoTopic: 'DYNAMIC' },
      { ...classification, editingStyle: 'GAMING' },
      { ...classification, version: 2 },
      { ...classification, version: undefined },
      { ...classification, editingStyle: undefined },
      { ...classification, available: true },
      { ...classification, videoType: ['TOP_X'] },
    ])
      expect(shortClassificationSchema.safeParse(value).success).toBe(false);
    expect(videoTypeSchema.safeParse('top_x').success).toBe(false);
    expect(videoTopicSchema.safeParse('humor').success).toBe(false);
    expect(editingStyleSchema.safeParse('dynamic').success).toBe(false);
  });
  test('persists registered intentions but never advertises them as executable support', () => {
    expect(shortClassificationSchema.safeParse(classification).success).toBe(
      true,
    );
    const usable = availableShortClassificationSchema.safeParse(classification);
    expect(usable.success).toBe(false);
    if (!usable.success)
      expect(usable.error.issues.map((e) => e.path[0])).toEqual([
        'videoType',
        'videoTopic',
        'editingStyle',
      ]);
  });
  test('classification is optional in old contracts and absent values are not synthesized', () => {
    const old = createShortSchema.parse({
      description: 'Descrição anterior',
      targetSeconds: 30,
    });
    expect(old).not.toHaveProperty('classification');
    expect(patchShortSchema.parse({ revision: 1 })).not.toHaveProperty(
      'classification',
    );
    expect(
      createShortSchema.parse({ ...old, classification }).classification,
    ).toEqual(classification);
    expect(
      patchShortSchema.safeParse({ revision: 1, classification: null }).success,
    ).toBe(false);
  });
  test('options preserve existing fields and expose the catalogs without database or external calls', () => {
    const db = { query: jest.fn() },
      service = new ShortService(
        db as never,
        options as never,
        {} as never,
        {} as never,
      );
    const result = service.options();
    expect(result).toMatchObject({
      aiEnabled: true,
      maxBytes: 123,
      musicMaxBytes: 456,
      maxFiles: 5,
      maxDuration: 1200,
      scanSeconds: 600,
      referenceMaxFiles: 3,
      referenceMaxSeconds: 90,
      referenceMaxFrames: 12,
      classifications: shortClassificationCatalogs,
    });
    expect(result.voices).toContain('cedar');
    expect(result.editingFeatures).toContain('captions');
    expect(db.query).not.toHaveBeenCalled();
  });
  test.each(['DRAFT', 'FAILED', 'COMPLETED'])(
    'classification-only patch preserves all artifacts, approvals, stage and %s status',
    async (status) => {
      const data = {
        scriptApproved: true,
        textApproved: true,
        planApproved: true,
        script: { introduction: 'I', development: 'D', conclusion: 'C' },
        narrationText: 'N',
        audio: { key: 'voice.mp3' },
        plan: { clips: [{ fileId: 'source', start: 0, end: 4 }] },
        editing: { profiles: [{ fileId: 'ref' }] },
        music: { key: 'music.wav' },
        output: { key: 'final.mp4' },
      };
      const p = {
        id: 'p',
        revision: 3,
        step: 9,
        status,
        error_message: 'Existing diagnostic',
        data,
      };
      const query = jest.fn().mockResolvedValue({ rows: [] }),
        db = { query: jest.fn() },
        storage = { delete: jest.fn() },
        service = new ShortService(
          db as never,
          {} as never,
          storage as never,
          {} as never,
        );
      jest
        .spyOn(service, 'locked')
        .mockImplementation(async (_id, fn) =>
          fn(p as unknown as ShortProject, { query } as never),
        );
      jest.spyOn(service, 'get').mockResolvedValue({} as never);
      jest.spyOn(service, 'files');
      await service.patch('p', { revision: 3, classification });
      expect(query).toHaveBeenCalledTimes(1);
      const [sql, values] = query.mock.calls[0];
      expect(sql).toBe(
        'UPDATE short_projects SET data=$2,revision=revision+1,updated_at=NOW() WHERE id=$1',
      );
      expect(values[1]).toEqual({ ...data, classification });
      expect(data).not.toHaveProperty('classification');
      expect(service.files).not.toHaveBeenCalled();
      expect(db.query).not.toHaveBeenCalled();
      expect(storage.delete).not.toHaveBeenCalled();
    },
  );
  test('rejects stale classification revisions before writing', async () => {
    const query = jest.fn(),
      service = new ShortService(
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );
    jest
      .spyOn(service, 'locked')
      .mockImplementation(async (_id, fn) =>
        fn({ revision: 5 } as ShortProject, { query } as never),
      );
    await expect(
      service.patch('p', { revision: 4, classification }),
    ).rejects.toThrow('O projeto mudou');
    expect(query).not.toHaveBeenCalled();
  });
  test.each(['SCRIPT', 'TEXT'])(
    'preserves metadata when %s reconstructs project data without adding classifications to prompts',
    async (kind) => {
      const p = {
        id: 'p',
        revision: 1,
        step: 1,
        target_seconds: 30,
        description: 'Descrição do projeto',
        data: {
          classification,
          script: { introduction: 'I', development: 'D', conclusion: 'C' },
          scriptApproved: true,
        },
      };
      const query = jest.fn().mockResolvedValue({ rows: [] }),
        service = {
          settings: { model: 'mock' },
          db: { query, withClient: async (fn: any) => fn({ query }) },
          project: async () => p,
          cleanupData: jest.fn(),
          storage: { delete: jest.fn() },
        };
      const llm = {
        generateStructuredOutput: jest
          .fn()
          .mockResolvedValue({
            data:
              kind === 'SCRIPT'
                ? { introduction: 'I', development: 'D', conclusion: 'C' }
                : { text: 'Narração' },
            usage: { totalTokens: 0 },
          }),
      };
      const worker = new ShortWorker(
        service as never,
        {} as never,
        llm as never,
        {} as never,
        {} as never,
        {} as never,
      );
      await worker.execute({
        id: 'job',
        kind,
        input: { project: p, files: [], semantic: false },
      } as never);
      const update = query.mock.calls.find(([sql]) =>
        sql.startsWith('UPDATE short_projects SET data='),
      );
      expect(update?.[1][1].classification).toEqual(classification);
      expect(llm.generateStructuredOutput).toHaveBeenCalledTimes(1);
      const prompt = llm.generateStructuredOutput.mock.calls[0][0] as any;
      expect(prompt.userPrompt).not.toContain('classification');
      expect(prompt.userPrompt).not.toContain('TOP_X');
    },
  );
});
