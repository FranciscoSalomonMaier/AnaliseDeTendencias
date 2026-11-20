jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
import {
  editorialPreferencesSchema,
  editorialConfigurationStatus,
  effectiveEditingMode,
  EDITORIAL_INSTRUCTIONS_MAX,
} from './short-editorial.schema';
import { ShortService } from './short.service';
import {
  patchShortSchema,
  createShortSchema,
  shortStepAllowed,
  type ShortProject,
  type ShortData,
} from './short.schema';

const classification = {
  version: 1,
  videoType: 'TOP_X',
  videoTopic: 'HUMOR',
  editingStyle: 'DYNAMIC',
} as const;
const prefs = () =>
  editorialPreferencesSchema.parse({
    version: 1,
    additionalInstructions: '<b>Preferência textual</b>',
    resources: {
      emojis: 'PREFER',
      cameraShake: 'AVOID',
      originalAudio: 'PREFER',
    },
  });
function harness(data: ShortData = {}, step = 3) {
  const p = {
    id: 'p',
    revision: 3,
    data,
    step,
    status: 'COMPLETED',
    error_message: 'Preservar',
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
  return {
    p,
    query,
    service,
    update: () =>
      query.mock.calls.find(([sql]) =>
        sql.startsWith('UPDATE short_projects'),
      )?.[1],
  };
}
describe('Editorial configuration metadata and legacy boundary', () => {
  test('validates versioned optional preferences with safe bounded defaults', () => {
    const defaults = editorialPreferencesSchema.parse({ version: 1 });
    expect(defaults.cutRhythm).toBe('AUTO');
    expect(Object.keys(defaults.resources)).toHaveLength(9);
    expect(Object.values(defaults.resources).every((v) => v === 'AUTO')).toBe(
      true,
    );
    expect(defaults.additionalInstructions).toBe('');
    expect(
      editorialPreferencesSchema.parse({
        version: 1,
        additionalInstructions: 'x'.repeat(EDITORIAL_INSTRUCTIONS_MAX),
      }).additionalInstructions,
    ).toHaveLength(EDITORIAL_INSTRUCTIONS_MAX);
    for (const invalid of [
      { version: 2 },
      {
        version: 1,
        additionalInstructions: 'x'.repeat(EDITORIAL_INSTRUCTIONS_MAX + 1),
      },
      { version: 1, resources: { unknown: 'AUTO' } },
      { version: 1, resources: { titles: 'ENABLED' } },
      { version: 1, cutRhythm: 'FASTEST' },
      { version: 1, enabled: true },
      null,
    ])
      expect(editorialPreferencesSchema.safeParse(invalid).success).toBe(false);
    expect(
      createShortSchema.parse({
        description: 'Compatibilidade anterior',
        targetSeconds: 30,
      }),
    ).not.toHaveProperty('editingMode');
    expect(
      patchShortSchema.safeParse({
        revision: 3,
        editorialReview: { approvedRevision: 1 },
      }).success,
    ).toBe(false);
  });
  test('old unmarked projects remain legacy without classification defaults', () => {
    expect(effectiveEditingMode({})).toBe('LEGACY_REFERENCE');
    expect(editorialConfigurationStatus({})).toMatchObject({
      mode: 'LEGACY_REFERENCE',
      complete: false,
      saved: false,
      approved: false,
      executionAvailable: false,
    });
  });
  test('persists all editorial intent without invalidating any legacy production artifact', async () => {
    const original = {
      scriptApproved: true,
      textApproved: true,
      planApproved: true,
      script: { introduction: 'I', development: 'D', conclusion: 'C' },
      narrationText: 'N',
      audio: { key: 'voice.wav' },
      output: { key: 'out.mp4' },
      editing: {
        enabled: true,
        approved: true,
        config: { preserved: true },
        profiles: [{ fileId: 'reference' }],
      },
      plan: { clips: [] },
      music: { key: 'music.wav' },
    } as unknown as ShortData;
    const { service, query, update, p } = harness(original, 9);
    await service.patch('p', {
      revision: 3,
      classification,
      editorialPreferences: prefs(),
      editingMode: 'EDITORIAL_CLASSIFICATION',
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(update()?.[1]).toEqual({
      ...original,
      classification,
      editorialPreferences: prefs(),
      editingMode: 'EDITORIAL_CLASSIFICATION',
      editorialReview: {
        version: 1,
        configurationRevision: 1,
        approvedRevision: null,
      },
    });
    expect(p.data).toBe(original);
    expect(service.files).not.toHaveBeenCalled();
    expect(query.mock.calls[0][0]).not.toMatch(
      /status=|step=|error_message=|cleanup/,
    );
  });
  test('distinguishes a saved configuration, approval and execution availability', async () => {
    const h = harness({
      editingMode: 'EDITORIAL_CLASSIFICATION',
      classification,
      editorialPreferences: prefs(),
      editorialReview: {
        version: 1,
        configurationRevision: 2,
        approvedRevision: null,
      },
    });
    await h.service.patch('p', { revision: 3, approve: 'EDITORIAL' });
    const stored = h.update()?.[1];
    expect(stored.editorialReview).toEqual({
      version: 1,
      configurationRevision: 2,
      approvedRevision: 2,
    });
    expect(editorialConfigurationStatus(stored)).toMatchObject({
      complete: true,
      saved: true,
      approved: true,
      executionAvailable: false,
      knowledgeStatus: 'COMPLETE',
    });
    expect(h.query).toHaveBeenCalledTimes(1);
  });
  test('changing preferences resets only editorial approval and increments configuration revision', async () => {
    const h = harness({
      classification,
      editingMode: 'EDITORIAL_CLASSIFICATION',
      editorialPreferences: prefs(),
      editorialReview: {
        version: 1,
        configurationRevision: 2,
        approvedRevision: 2,
      },
    });
    await h.service.patch('p', {
      revision: 3,
      editorialPreferences: { ...prefs(), cutRhythm: 'FAST' },
    });
    expect(h.update()?.[1].editorialReview).toEqual({
      version: 1,
      configurationRevision: 3,
      approvedRevision: null,
    });
  });
  test('saving an unchanged approved configuration preserves its approval', async () => {
    const h = harness({
      classification,
      editorialPreferences: prefs(),
      editorialReview: {
        version: 1,
        configurationRevision: 2,
        approvedRevision: 2,
      },
    });
    await h.service.patch('p', {
      revision: 3,
      classification,
      editorialPreferences: prefs(),
    });
    expect(h.update()?.[1].editorialReview.approvedRevision).toBe(2);
  });
  test('JSONB key ordering does not invalidate editorial approval', async () => {
    const reordered = {
      editingStyle: classification.editingStyle,
      videoTopic: classification.videoTopic,
      videoType: classification.videoType,
      version: classification.version,
    };
    const h = harness({
      classification: reordered,
      editorialReview: {
        version: 1,
        configurationRevision: 4,
        approvedRevision: 4,
      },
    });
    await h.service.patch('p', { revision: 3, classification });
    expect(h.update()?.[1].editorialReview).toEqual({
      version: 1,
      configurationRevision: 4,
      approvedRevision: 4,
    });
  });

  test('approval requires three valid selections and the explicit editorial mode', async () => {
    for (const data of [
      { editingMode: 'EDITORIAL_CLASSIFICATION' },
      { classification },
    ]) {
      const h = harness(data as ShortData);
      await expect(
        h.service.patch('p', { revision: 3, approve: 'EDITORIAL' }),
      ).rejects.toThrow('Selecione');
      expect(h.query).not.toHaveBeenCalled();
    }
  });
  test.each(['REFERENCES', 'TEXT', 'AUDIO', 'PLAN', 'RENDER'])(
    'blocks %s jobs before files, providers, queues or billing',
    async (kind) => {
      const h = harness({
        editingMode: 'EDITORIAL_CLASSIFICATION',
        classification,
      });
      await expect(
        h.service.enqueue('p', { revision: 3, kind, confirm: true }),
      ).rejects.toThrow('desenvolvimento');
      expect(h.service.files).not.toHaveBeenCalled();
      expect(h.query).not.toHaveBeenCalled();
    },
  );
  test.each([
    { step: 4 },
    { step: 8 },
    { skipReferences: true },
    { approve: 'TEXT' },
    { approve: 'PLAN' },
    { approve: 'EDITING' },
  ])('blocks forged advancement/legacy mixing: %j', async (input) => {
    const h = harness({
      editingMode: 'EDITORIAL_CLASSIFICATION',
      classification,
    });
    await expect(
      h.service.patch('p', { revision: 3, ...input }),
    ).rejects.toThrow('desenvolvimento');
    expect(h.query).not.toHaveBeenCalled();
  });
  test('rejects metadata plus execution changes as a single ambiguous operation', async () => {
    const h = harness({});
    await expect(
      h.service.patch('p', {
        revision: 3,
        editingMode: 'EDITORIAL_CLASSIFICATION',
        step: 4,
      }),
    ).rejects.toThrow('separadamente');
    expect(h.query).not.toHaveBeenCalled();
  });
  test('supports explicit switching while preserving all stored settings', async () => {
    const data = {
      editingMode: 'EDITORIAL_CLASSIFICATION',
      classification,
      editorialPreferences: prefs(),
      editing: { enabled: true, approved: true, features: [] },
      output: { key: 'video.mp4' },
    } as ShortData;
    const h = harness(data);
    await h.service.patch('p', {
      revision: 3,
      editingMode: 'LEGACY_REFERENCE',
    });
    expect(h.update()?.[1]).toMatchObject({
      ...data,
      editingMode: 'LEGACY_REFERENCE',
    });
    expect(h.service.files).not.toHaveBeenCalled();
  });
  test('enforces backend navigation gates while preserving access to an existing result', () => {
    const h = harness({
      editingMode: 'EDITORIAL_CLASSIFICATION',
      scriptApproved: true,
      textApproved: true,
      audio: { key: 'audio' } as never,
      planApproved: true,
      output: { key: 'video' } as never,
    });
    for (const step of [4, 5, 6, 7, 8])
      expect(shortStepAllowed(h.p, [{ id: 'f' }] as never, step)).toBe(false);
    expect(shortStepAllowed(h.p, [{ id: 'f' }] as never, 3)).toBeTruthy();
    expect(shortStepAllowed(h.p, [], 9)).toBeTruthy();
  });
  test('rejects stale metadata revisions before any write', async () => {
    const h = harness({});
    await expect(
      h.service.patch('p', { revision: 2, editorialPreferences: prefs() }),
    ).rejects.toThrow('mudou');
    expect(h.query).not.toHaveBeenCalled();
  });
});
