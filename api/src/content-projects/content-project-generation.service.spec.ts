jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
jest.mock('../ai/ai-analysis.service', () => ({ AiAnalysisService: class {} }));
import { ContentProjectGenerationService } from './content-project-generation.service';
import type { ContentProject } from './content-project.schema';
import type { LlmProvider } from '../ai/llm.provider';
import type { AiAnalysisService } from '../ai/ai-analysis.service';
import { orderedScriptNarration } from '../ai/content-generation/narrative-continuity';
const script = {
  title: 'O corredor vazio',
  hook: 'Alguém chamou Elias.',
  introduction: 'Elias caminhava sozinho.',
  sections: [
    { title: 'O som', narration: 'Então ouviu uma voz.' },
    { title: 'A porta', narration: 'Por isso abriu a porta.' },
  ],
  conclusion: 'O corredor ficou vazio.',
  estimatedDurationSeconds: 60,
  researchRequired: false,
  researchNotes: [],
};
function fixture() {
  const p = {
    config: {
      type: 'VIDEO',
      topic: 'Mistério',
      style: 'DARK',
      language: 'pt-BR',
      targetDurationSeconds: 60,
    },
    script,
    scenes: [],
    selectedIdea: null,
  } as unknown as ContentProject;
  const generateStructuredOutput = jest.fn().mockResolvedValue({
    data: {
      scenes: [
        {
          order: 1,
          narration: orderedScriptNarration(script),
          visualDescription: 'Um corredor vazio.',
          imagePrompt: 'Uma porta no corredor.',
          estimatedDurationSeconds: 30,
        },
      ],
    },
    usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
    provider: 'mock',
    model: 'mock',
  });
  const generator = new ContentProjectGenerationService(
    { generateStructuredOutput } as unknown as LlmProvider,
    { getModel: () => 'mock' } as AiAnalysisService,
  );
  return { p, generateStructuredOutput, generator };
}
describe('project scene generation preserves approved narrative', () => {
  test('passes canonical narration and accepts a faithful scene split in one provider call', async () => {
    const f = fixture();
    const result = await f.generator.generate('scenes', f.p);
    expect(result.scenes).toHaveLength(1);
    expect(result.scenes![0].narration).toBe(orderedScriptNarration(script));
    expect(f.generateStructuredOutput).toHaveBeenCalledTimes(1);
    expect(f.generateStructuredOutput).toHaveBeenCalledWith(
      expect.objectContaining<Record<string, unknown>>({
        userPrompt: expect.stringContaining(
          JSON.stringify(orderedScriptNarration(script)),
        ),
      }),
    );
  });
  test('rejects numerically ordered scenes with missing approved narration without paid retries or project mutation', async () => {
    const f = fixture(),
      original = structuredClone(f.p);
    f.generateStructuredOutput.mockResolvedValue({
      data: {
        scenes: [
          {
            order: 1,
            narration: script.introduction,
            visualDescription: 'Corredor vazio.',
            imagePrompt: 'Uma porta fechada.',
            estimatedDurationSeconds: 10,
          },
        ],
      },
    });
    await expect(f.generator.generate('scenes', f.p)).rejects.toThrow(
      'não preservaram a narração aprovada',
    );
    expect(f.generateStructuredOutput).toHaveBeenCalledTimes(1);
    expect(f.p).toEqual(original);
  });
});
