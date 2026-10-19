import type { ContentProject } from '../content-projects/content-project.schema';
import {
  SceneImagePromptBuilder,
  projectVisualContinuity,
  sceneVisualFingerprint,
} from './scene-image-prompt.builder';
import { projectPrompt } from '../ai/content-generation/prompts/content-project.prompt';
import { sceneGenerationPrompt } from '../ai/content-generation/prompts/scene-generation.prompt';
function fixture() {
  return {
    config: {
      type: 'VIDEO',
      topic: 'Uma história de mistério',
      style: 'DARK',
      language: 'pt-BR',
      targetDurationSeconds: 300,
    },
    scenes: [
      {
        id: 'first',
        order: 1,
        narration: 'Elias entrou.',
        visualDescription:
          'Elias, 40 anos, cabelo preto curto, cicatriz na sobrancelha, uniforme azul.',
        imagePrompt:
          'Elias no corredor leste: paredes cinzas, porta de aço vermelha no fundo.',
        estimatedDurationSeconds: 5,
      },
      {
        id: 'second',
        order: 2,
        narration: 'Ele voltou ao corredor.',
        visualDescription: 'Elias no corredor leste, visto por outro ângulo.',
        imagePrompt: 'Close de Elias ao lado da porta.',
        estimatedDurationSeconds: 6,
      },
    ],
  } as unknown as ContentProject;
}
describe('visual continuity across independently generated images', () => {
  test('each scene receives identical shared design references and its own current scene instructions', () => {
    const project = fixture(),
      builder = new SceneImagePromptBuilder(),
      reference = projectVisualContinuity(project);
    for (const scene of project.scenes) {
      const request = builder.build(project, scene);
      expect(request.prompt).toContain(
        `Shared project continuity references:\n${reference}`,
      );
      expect(request.prompt).toContain(
        `CURRENT SCENE TO RENDER:\nNarrative context (not text to display): ${scene.narration}`,
      );
      expect(request.prompt).toContain('cicatriz na sobrancelha');
      expect(request.prompt).toContain('porta de aço vermelha');
      expect(request.prompt).toContain('identical face');
      expect(request.prompt).toContain(
        'Different named locations remain distinct',
      );
      expect(request.aspectRatio).toBe('16:9');
    }
  });
  test('reference order is stable regardless of array order and does not mutate the project', () => {
    const project = fixture(),
      expected = projectVisualContinuity(project);
    project.scenes.reverse();
    const original = [...project.scenes];
    expect(projectVisualContinuity(project)).toBe(expected);
    expect(
      new SceneImagePromptBuilder().build(project, project.scenes[0]).prompt,
    ).toContain('Previous scene context: Elias, 40 anos');
    expect(project.scenes).toEqual(original);
  });
  test('shared reference size is bounded for long projects and retains the earliest design', () => {
    const project = fixture();
    project.scenes = Array.from({ length: 150 }, (_, i) => ({
      ...project.scenes[0],
      id: String(i),
      order: i + 1,
      visualDescription: 'a'.repeat(1000),
      imagePrompt: 'b'.repeat(1500),
    }));
    const reference = projectVisualContinuity(project);
    expect(reference.length).toBeLessThanOrEqual(12000);
    expect(reference.startsWith('Scene 1:')).toBe(true);
  });
  test('prompt improvements preserve source narration and existing selection fingerprints', () => {
    const project = fixture(),
      original = structuredClone(project),
      fingerprint = sceneVisualFingerprint(project, project.scenes[0]);
    new SceneImagePromptBuilder().build(project, project.scenes[0]);
    expect(project).toEqual(original);
    expect(sceneVisualFingerprint(project, project.scenes[0])).toBe(
      fingerprint,
    );
  });
  test('both scene-planning paths require concrete repeated attributes exclusively in visual fields', () => {
    const project = fixture();
    for (const prompt of [
      projectPrompt('scenes', project.config).userPrompt,
      sceneGenerationPrompt('pt-BR'),
    ]) {
      expect(prompt).toContain('each image is generated independently');
      expect(prompt).toContain('facial structure');
      expect(prompt).toContain('returning to a location');
      expect(prompt).toContain('never in spoken narration');
    }
    expect(projectPrompt('script', project.config).userPrompt).not.toContain(
      'each image is generated independently',
    );
  });
});
