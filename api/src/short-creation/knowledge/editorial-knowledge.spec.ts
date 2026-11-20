import {
  editorialKnowledgeProfileSchema,
  editorialGuidanceSchema,
  editorialContextSchema,
} from './editorial-knowledge.schema';
import {
  defineKnowledgeRegistry,
  editorialKnowledgeRegistry,
  getEditorialKnowledge,
  listEditorialKnowledgeProfiles,
} from './editorial-knowledge.registry';
import {
  resolveEditorialKnowledge,
  resolveProjectEditorialKnowledge,
} from './editorial-knowledge.resolver';
import { shortClassificationCatalogs } from '../classification/short-classification.catalog';
import { availableShortClassificationSchema } from '../classification/short-classification.schema';
import { guidance as g } from './profiles/guidance';
import {
  soundEffectKnowledge,
  soundEffectKnowledgeSchema,
} from './sound-effect.knowledge';
import type { EditorialKnowledgeProfile } from './editorial-knowledge.types';

const classification = {
  version: 1,
  videoType: 'TOP_X',
  videoTopic: 'HUMOR',
  editingStyle: 'DYNAMIC',
} as const;
function profileWithRules(
  rules: EditorialKnowledgeProfile['guidance'],
): EditorialKnowledgeProfile {
  return { ...editorialKnowledgeRegistry[0], guidance: rules };
}

describe('Deterministic editorial knowledge, isolated from production', () => {
  test.each([
    ['videoType', 'TOP_X'],
    ['videoTopic', 'HUMOR'],
    ['editingStyle', 'DYNAMIC'],
  ] as const)(
    'retrieves an independently authored %s/%s profile',
    (axis, id) => {
      const profile = getEditorialKnowledge(axis, id)!;
      expect(profile.axis).toBe(axis);
      expect(profile.classificationId).toBe(id);
      expect(profile.guidance.length).toBeGreaterThan(10);
      expect(editorialKnowledgeProfileSchema.safeParse(profile).success).toBe(
        true,
      );
      expect(Object.isFrozen(profile.guidance)).toBe(true);
      expect(Object.isFrozen(profile.guidance[0].conditions)).toBe(true);
    },
  );

  test('composes the three profiles without dropping or overwriting directives', () => {
    const result = resolveEditorialKnowledge(classification);
    expect(result.knowledgeStatus).toBe('COMPLETE');
    expect(result.usage).toBe('EDITORIAL_CONTEXT_ONLY');
    expect(result.profiles.map((p) => p.classificationId)).toEqual([
      'TOP_X',
      'HUMOR',
      'DYNAMIC',
    ]);
    expect(result.missingProfiles).toEqual([]);
    expect(result.guidance).toHaveLength(
      editorialKnowledgeRegistry.reduce((n, p) => n + p.guidance.length, 0),
    );
    for (const profile of editorialKnowledgeRegistry) {
      expect(
        result.guidance
          .filter((rule) => rule.origin.profileId === profile.profileId)
          .map(({ origin, ...rule }) => rule),
      ).toEqual(profile.guidance);
    }
    expect(editorialContextSchema.safeParse(result).success).toBe(true);
  });

  test('preserves structural requirements, conditional recommendations and optional narration', () => {
    const rules = resolveEditorialKnowledge(classification).guidance;
    expect(rules.find((r) => r.id === 'RANKING_CRITERION')).toMatchObject({
      kind: 'STRUCTURAL',
      level: 'REQUIRED',
    });
    expect(rules.find((r) => r.id === 'RANKING_ITEMS')).toMatchObject({
      kind: 'STRUCTURAL',
      level: 'REQUIRED',
    });
    expect(
      rules.filter((r) => r.target === 'audio.narration').map((r) => r.level),
    ).toEqual(['OPTIONAL', 'OPTIONAL', 'OPTIONAL']);
    expect(rules.find((r) => r.id === 'DYNAMIC_ZOOM')?.level).toBe('OPTIONAL');
    expect(rules.find((r) => r.id === 'DYNAMIC_FAST_CUTS')).toMatchObject({
      kind: 'EDITORIAL',
      level: 'RECOMMENDED',
    });
    expect(rules.find((r) => r.id === 'COMEDIC_FABRICATION')).toMatchObject({
      kind: 'SAFETY',
      level: 'FORBIDDEN',
    });
  });

  test('identifies contextual comedic-timing/cut-frequency tension without discarding either rule', () => {
    const result = resolveEditorialKnowledge(classification);
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        target: 'pacing.fastCuts',
        status: 'CONTEXTUAL',
        preferredGuidance: null,
      }),
    ]);
    expect(result.conflicts[0].guidance.map((r) => r.id)).toEqual([
      'COMEDIC_FAST_CUTS',
      'DYNAMIC_FAST_CUTS',
    ]);
    expect(
      result.conflicts[0].guidance.map((r) => r.origin.classificationId),
    ).toEqual(['HUMOR', 'DYNAMIC']);
    expect(
      result.guidance.filter((r) => r.target === 'pacing.fastCuts'),
    ).toHaveLength(2);
  });

  test.each(['STRUCTURAL', 'TECHNICAL', 'SAFETY'] as const)(
    'preserves %s restrictions over editorial preferences',
    (kind) => {
      const registry = [
        profileWithRules([
          g(
            'RESTRICTION',
            'EDITORIAL_QUALITY',
            'test.target',
            'FORBIDDEN',
            'Restrição explícita.',
            { kind },
          ),
          g(
            'PREFERENCE',
            'PACING',
            'test.target',
            'RECOMMENDED',
            'Preferência.',
          ),
        ]),
      ];
      const result = resolveEditorialKnowledge(classification, registry);
      expect(result.conflicts[0]).toMatchObject({
        status: 'PRIORITIZED',
        preferredGuidance: { id: 'RESTRICTION' },
      });
      expect(result.guidance).toHaveLength(2);
    },
  );

  test('does not silently resolve equally strong incompatible structural rules', () => {
    const result = resolveEditorialKnowledge(classification, [
      profileWithRules([
        g(
          'NEEDED',
          'CONTENT_STRUCTURE',
          'test.target',
          'REQUIRED',
          'Necessário.',
          { kind: 'STRUCTURAL' },
        ),
        g(
          'BANNED',
          'CONTENT_STRUCTURE',
          'test.target',
          'FORBIDDEN',
          'Proibido.',
          { kind: 'STRUCTURAL' },
        ),
      ]),
    ]);
    expect(result.conflicts[0]).toMatchObject({
      status: 'UNRESOLVED',
      preferredGuidance: null,
    });
    expect(result.guidance).toHaveLength(2);
    // COMPLETE/PARTIAL concerns authored profiles, not conflict resolution or execution.
    expect(result.knowledgeStatus).toBe('PARTIAL');
  });

  test('different conditions do not silently resolve opposing hard constraints', () => {
    const result = resolveEditorialKnowledge(classification, [
      profileWithRules([
        g(
          'NEEDED',
          'CONTENT_STRUCTURE',
          'test.target',
          'REQUIRED',
          'Necessário.',
          { kind: 'STRUCTURAL', conditions: ['Condição A.'] },
        ),
        g(
          'BANNED',
          'CONTENT_STRUCTURE',
          'test.target',
          'FORBIDDEN',
          'Proibido.',
          { kind: 'STRUCTURAL', conditions: ['Condição B.'] },
        ),
      ]),
    ]);
    expect(result.conflicts[0].status).toBe('UNRESOLVED');
  });

  test('forbidden resource use also conflicts with an optional suggestion', () => {
    const result = resolveEditorialKnowledge(classification, [
      profileWithRules([
        g('BAN', 'AUDIO', 'test.audio', 'FORBIDDEN', 'Proibição técnica.', {
          kind: 'TECHNICAL',
        }),
        g(
          'MAY_USE',
          'AUDIO',
          'test.audio',
          'OPTIONAL',
          'Possibilidade editorial.',
        ),
      ]),
    ]);
    expect(result.conflicts[0].preferredGuidance?.id).toBe('BAN');
  });

  test('registry rejects unknown, cross-axis, duplicate and malformed profiles', () => {
    const original = editorialKnowledgeRegistry[0];
    expect(() => defineKnowledgeRegistry([original, original])).toThrow();
    for (const patch of [
      { classificationId: 'UNKNOWN' },
      { classificationId: 'HUMOR' },
      { knowledgeVersion: 2 },
      { profileVersion: 0 },
      { guidance: [] },
      { available: true },
    ]) {
      expect(
        editorialKnowledgeProfileSchema.safeParse({ ...original, ...patch })
          .success,
      ).toBe(false);
    }
    expect(() =>
      defineKnowledgeRegistry([
        { ...original, guidance: [original.guidance[0], original.guidance[0]] },
      ]),
    ).toThrow();
  });

  test('validates guidance levels, constraint foundations and semantic references', () => {
    const rule = g(
      'TEST',
      'FUTURE_CATEGORY',
      'test.future',
      'OPTIONAL',
      'Orientação futura.',
      { resourceIntents: ['FUTURE_RESOURCE'] },
    );
    expect(editorialGuidanceSchema.safeParse(rule).success).toBe(true);
    for (const patch of [
      { level: 'MANDATORY' },
      { level: 'REQUIRED' },
      { kind: 'STRUCTURAL' },
      { instruction: ' ' },
      { assetPath: '/tmp/audio.mp3' },
      { available: true },
      { soundEffectIntents: ['UNKNOWN'] },
    ]) {
      expect(
        editorialGuidanceSchema.safeParse({ ...rule, ...patch }).success,
      ).toBe(false);
    }
  });

  test.each([
    undefined,
    null,
    {},
    { ...classification, videoType: 'UNKNOWN' },
    { ...classification, videoTopic: 'TOP_X' },
    { ...classification, version: 2 },
  ])('rejects invalid classifications without fallback: %j', (input) => {
    expect(() => resolveEditorialKnowledge(input)).toThrow();
  });

  test('registered but undefined profiles are explicitly missing, never substituted', () => {
    const empty = resolveEditorialKnowledge({
      version: 1,
      videoType: 'VIBE',
      videoTopic: 'HORROR',
      editingStyle: 'EPIC',
    });
    expect(empty.knowledgeStatus).toBe('MISSING');
    expect(empty.profiles).toEqual([]);
    expect(empty.guidance).toEqual([]);
    expect(empty.soundEffects).toEqual([]);
    expect(empty.missingProfiles.map((p) => p.classificationId)).toEqual([
      'VIBE',
      'HORROR',
      'EPIC',
    ]);
    expect(getEditorialKnowledge('videoType', 'VIBE')).toBeNull();
    expect(() => getEditorialKnowledge('videoType', 'HUMOR')).toThrow();
    const partial = resolveEditorialKnowledge({
      ...classification,
      videoTopic: 'GAMING',
    });
    expect(partial.knowledgeStatus).toBe('PARTIAL');
    expect(
      partial.guidance.some((r) => r.origin.classificationId === 'HUMOR'),
    ).toBe(false);
    expect(partial.missingProfiles).toEqual([
      {
        axis: 'videoTopic',
        classificationId: 'GAMING',
        status: 'REGISTERED_WITHOUT_KNOWLEDGE',
      },
    ]);
  });

  test('composes every catalog combination without mutating inputs or catalogs', () => {
    const before = JSON.stringify(shortClassificationCatalogs);
    for (const type of shortClassificationCatalogs.videoTypes)
      for (const topic of shortClassificationCatalogs.videoTopics)
        for (const style of shortClassificationCatalogs.editingStyles) {
          const input = {
            version: 1,
            videoType: type.id,
            videoTopic: topic.id,
            editingStyle: style.id,
          };
          const snapshot = JSON.stringify(input);
          const result = resolveEditorialKnowledge(input);
          expect(result.profiles).toHaveLength(
            [
              type.id === 'TOP_X',
              topic.id === 'HUMOR',
              style.id === 'DYNAMIC',
            ].filter(Boolean).length,
          );
          expect(JSON.stringify(input)).toBe(snapshot);
        }
    expect(JSON.stringify(shortClassificationCatalogs)).toBe(before);
  });

  test('versions structure, profiles and classification independently and traces every rule', () => {
    const profiles = editorialKnowledgeRegistry.map((p) => ({
      ...p,
      profileVersion: 7,
    }));
    const result = resolveEditorialKnowledge(classification, profiles);
    expect(result.knowledgeVersion).toBe(1);
    expect(result.classification.version).toBe(1);
    expect(result.profiles.every((p) => p.profileVersion === 7)).toBe(true);
    expect(
      result.guidance.every(
        (r) =>
          r.origin.profileVersion === 7 &&
          result.profiles.some((p) => p.profileId === r.origin.profileId),
      ),
    ).toBe(true);
    expect(
      resolveEditorialKnowledge(classification).profiles.every(
        (p) => p.profileVersion === 1,
      ),
    ).toBe(true);
  });

  test('is deterministic, JSON serializable, detached and contains no concrete edit plan', () => {
    const a = resolveEditorialKnowledge(classification),
      b = resolveEditorialKnowledge(classification);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    a.guidance[0].instruction = 'Mutação local';
    a.guidance[0].origin.profileVersion = 999;
    expect(resolveEditorialKnowledge(classification)).toEqual(b);
    expect(editorialContextSchema.safeParse({ ...b, clips: [] }).success).toBe(
      false,
    );
    expect(JSON.stringify(b)).not.toMatch(
      /"(timestamp|fileId|start|end|assetPath|executor|available)":/,
    );
  });

  test('knowledge availability does not enable classification or resources', () => {
    const result = resolveEditorialKnowledge(classification);
    expect(result.knowledgeStatus).toBe('COMPLETE');
    expect(
      availableShortClassificationSchema.safeParse(classification).success,
    ).toBe(false);
    const profiles = listEditorialKnowledgeProfiles();
    expect(profiles).toHaveLength(18);
    expect(
      profiles.filter((p) => p.knowledgeStatus === 'DEFINED'),
    ).toHaveLength(3);
    expect(profiles.every((p) => p.available === false)).toBe(true);
  });

  test('sound-effect knowledge has ten conceptual categories and no asset or licensing claims', () => {
    expect(soundEffectKnowledge.map((e) => e.id)).toEqual([
      'IMPACT',
      'WHOOSH',
      'POP',
      'COMEDY',
      'SURPRISE',
      'RISER',
      'DRAMATIC_HIT',
      'FAIL',
      'AMBIENCE',
      'CELEBRATION',
    ]);
    for (const effect of soundEffectKnowledge) {
      expect(soundEffectKnowledgeSchema.safeParse(effect).success).toBe(true);
      expect(Object.isFrozen(effect)).toBe(true);
      expect(
        soundEffectKnowledgeSchema.safeParse({ ...effect, available: true })
          .success,
      ).toBe(false);
    }
    const context = resolveEditorialKnowledge(classification);
    const referenced = new Set(
      context.guidance.flatMap((r) => r.soundEffectIntents),
    );
    expect(new Set(context.soundEffects.map((e) => e.id))).toEqual(referenced);
  });

  test('legacy project lookup neither classifies nor modifies existing project data', () => {
    const data = {
      script: 'Legado',
      plan: { clips: [] },
      render: { id: 'preserved' },
    };
    const snapshot = JSON.stringify(data);
    expect(
      resolveProjectEditorialKnowledge(data as { classification?: unknown }),
    ).toBeNull();
    expect(JSON.stringify(data)).toBe(snapshot);
    const classified = { ...data, classification };
    expect(resolveProjectEditorialKnowledge(classified)?.knowledgeStatus).toBe(
      'COMPLETE',
    );
    expect(classified).toEqual({ ...data, classification });
    expect(() =>
      resolveProjectEditorialKnowledge({ classification: null }),
    ).toThrow();
  });
});
