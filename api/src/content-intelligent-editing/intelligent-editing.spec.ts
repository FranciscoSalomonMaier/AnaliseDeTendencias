jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
import { randomUUID } from 'node:crypto';
import {
  defaultEditing,
  editingSchema,
} from '../video-render/editing-settings';
import {
  effectiveSuggestion,
  hashData,
  validatePlan,
  validateVisual,
  type Suggestion,
} from './editing-plan.schema';
import { IntelligentEditingService } from './intelligent-editing.service';
import { imageMotionFilter } from '../video-render/ffmpeg.renderer';
const sceneId = randomUUID();
const suggestion: Suggestion = {
  sceneId,
  narrativeRole: 'SUSPENSE',
  tensionLevel: 0.7,
  emotionalTone: 'Tenso',
  pacing: 'SLOW',
  movement: 'SLOW_ZOOM_IN',
  intensity: 'MODERATE',
  interpolation: 'EASE_IN_OUT',
  fit: 'COVER',
  focalPoint: { x: 0.6, y: 0.4 },
  zoom: 1,
  transition: { type: 'CROSSFADE', durationSeconds: 0.5 },
  explanation: 'Destacar a janela.',
  continuity: 'Preserva a direção anterior.',
  recommendation: 'Revisar área de legendas.',
};
const visual = {
  subject: 'Janela',
  focalPoint: { x: 0.6, y: 0.4 },
  region: { x: 0.58, y: 0.38, width: 0.04, height: 0.04 },
  subtitleArea: 'BOTTOM' as const,
  composition: 'Assunto central',
  horizontal: 'Amplo',
  vertical: 'Proteger janela',
  usable: true,
};
const output = {
  summary: 'Suspense crescente',
  rhythm: 'Movimentos lentos',
  recommendations: [],
  scenes: [suggestion],
};
describe('Intelligent editing validation and safe mapping', () => {
  test('preserves narrative classification and project order', () => {
    const second = {
      ...suggestion,
      sceneId: randomUUID(),
      narrativeRole: 'RESOLUTION',
    };
    expect(
      validatePlan({ ...output, scenes: [second, suggestion] }, [
        sceneId,
        second.sceneId,
      ]).scenes.map((s) => s.sceneId),
    ).toEqual([sceneId, second.sceneId]);
  });
  test.each([
    ['unknown scene', { sceneId: randomUUID() }],
    ['invalid UUID', { sceneId: 'bad' }],
    ['unsupported movement', { movement: 'shell' }],
    ['invalid role', { narrativeRole: 'FACT' }],
    ['high tension', { tensionLevel: 1.1 }],
    ['negative tension', { tensionLevel: -1 }],
    ['invalid focal', { focalPoint: { x: 2, y: 0 } }],
    ['NaN focal', { focalPoint: { x: NaN, y: 0 } }],
    ['intensity', { intensity: 'EXTREME' }],
    ['interpolation', { interpolation: 'exec' }],
    ['transition', { transition: { type: 'WIPE', durationSeconds: 0.2 } }],
    [
      'negative duration',
      { transition: { type: 'FADE', durationSeconds: -1 } },
    ],
    ['long duration', { transition: { type: 'FADE', durationSeconds: 3 } }],
    ['crop', { fit: 'CUSTOM' }],
    ['infinite zoom', { zoom: Infinity }],
    ['executable field', { command: 'ffmpeg' }],
  ])('rejects %s', (_label, patch) =>
    expect(() =>
      validatePlan({ ...output, scenes: [{ ...suggestion, ...patch }] }, [
        sceneId,
      ]),
    ).toThrow(),
  );
  test('rejects duplicate and missing scenes', () => {
    expect(() =>
      validatePlan({ ...output, scenes: [suggestion, suggestion] }, [sceneId]),
    ).toThrow();
    expect(() => validatePlan({ ...output, scenes: [] }, [sceneId])).toThrow();
  });
  test.each([
    { x: 0.9, y: 0, width: 0.2, height: 0.1 },
    { x: 0, y: 0.95, width: 0.1, height: 0.1 },
    { x: -0.1, y: 0, width: 0.1, height: 0.1 },
    { x: 0, y: 0, width: 0, height: 0.1 },
  ])('rejects invalid region %j', (region) =>
    expect(() => validateVisual({ ...visual, region })).toThrow(),
  );
  test('does not accept invented numeric confidence', () =>
    expect(() => validateVisual({ ...visual, confidence: 0.99 })).toThrow());
  test.each(['SUBTLE', 'MODERATE', 'STRONG'] as const)(
    'caps intensity %s',
    (intensity) =>
      expect(
        effectiveSuggestion(
          { ...suggestion, intensity: 'STRONG' },
          intensity,
          visual,
        ).effective.amplitude,
      ).toBe({ SUBTLE: 0.02, MODERATE: 0.045, STRONG: 0.08 }[intensity]),
  );
  test('falls back safely without vision', () =>
    expect(
      effectiveSuggestion(suggestion, 'STRONG', null).effective,
    ).toMatchObject({
      motion: 'STATIC',
      fit: 'CONTAIN',
      focalX: 0.5,
      focalY: 0.5,
      zoom: 1,
      amplitude: 0,
    }));
  test('falls back for unusable visual analysis', () =>
    expect(
      effectiveSuggestion(suggestion, 'MODERATE', { ...visual, usable: false })
        .effective.motion,
    ).toBe('STATIC'));
  test.each(['CONTAIN', 'BLURRED_BACKGROUND'] as const)(
    'preserves %s foreground',
    (fit) =>
      expect(
        effectiveSuggestion({ ...suggestion, fit }, 'MODERATE', visual)
          .effective.motion,
      ).toBe('STATIC'),
  );
  test('limits zoom and zeroes cut duration', () => {
    const result = effectiveSuggestion(
      {
        ...suggestion,
        zoom: 2,
        transition: { type: 'CUT', durationSeconds: 2 },
      },
      'STRONG',
      visual,
    );
    expect(result.effective.zoom).toBe(1.15);
    expect(result.effective.transitionSeconds).toBe(0);
  });
  test('reassesses crop for each orientation', () => {
    const offcenter = {
      ...visual,
      region: { x: 0.75, y: 0.3, width: 0.15, height: 0.2 },
    };
    const scene = { ...suggestion, focalPoint: { x: 0.5, y: 0.5 } };
    expect(
      effectiveSuggestion(scene, 'MODERATE', offcenter, {
        width: 1600,
        height: 900,
        format: '16:9',
      }).effective.fit,
    ).toBe('COVER');
    expect(
      effectiveSuggestion(scene, 'MODERATE', offcenter, {
        width: 1600,
        height: 900,
        format: '9:16',
      }).effective.fit,
    ).toBe('CONTAIN');
  });
  test('keeps legacy editing valid', () => {
    expect(defaultEditing()).toEqual({
      revision: 0,
      transition: 'CUT',
      transitionSeconds: 0.5,
      scenes: {},
    });
    expect(
      editingSchema.parse({ scenes: { [sceneId]: { motion: 'STATIC' } } })
        .scenes[sceneId].locked,
    ).toBeUndefined();
  });
  test('rejects arbitrary expressions', () =>
    expect(() =>
      editingSchema.parse({
        scenes: { [sceneId]: { expression: 'system()' } },
      }),
    ).toThrow());
  test('snapshots provenance independently', () => {
    const settings = editingSchema.parse({
      scenes: {
        [sceneId]: {
          ...effectiveSuggestion(suggestion, 'MODERATE', visual).effective,
          planId: randomUUID(),
        },
      },
    });
    const snapshot = structuredClone(settings);
    settings.scenes[sceneId].focalX = 0.1;
    expect(snapshot.scenes[sceneId].focalX).toBe(0.6);
    expect(snapshot.scenes[sceneId].origin).toBe('AI');
  });
  test('changes cache identity for relevant inputs', () => {
    const source = {
      script: 'Roteiro',
      model: 'a',
      style: 'CINEMATIC',
      format: '16:9',
    };
    for (const patch of [
      { script: 'Outro' },
      { model: 'b' },
      { style: 'SUSPENSE' },
      { format: '9:16' },
    ])
      expect(hashData({ ...source, ...patch })).not.toBe(hashData(source));
  });
  test.each(['LINEAR', 'EASE_IN', 'EASE_OUT', 'EASE_IN_OUT'] as const)(
    'maps %s safely',
    (interpolation) => {
      const filter = imageMotionFilter(
        {
          motion: 'SLOW_ZOOM_IN',
          frames: 60,
          amplitude: 0.04,
          easing: true,
          interpolation,
        } as never,
        { width: 320, height: 180, fps: 30, pixelFormat: 'yuv420p' } as never,
      );
      expect(filter).toContain('zoompan');
      expect(filter).not.toContain('undefined');
    },
  );
  test.each([
    { revision: 0, approveAll: true, sceneId },
    { revision: 0, approveAll: true, decision: 'ACCEPTED' },
    { revision: 0, approveAll: true, suggestion },
  ])('rejects incomplete review even when approving all: %j', async (body) => {
    await expect(
      IntelligentEditingService.prototype.review.call(
        {},
        randomUUID(),
        randomUUID(),
        body,
      ),
    ).rejects.toThrow('Revisão inválida.');
  });
});
