import {
  BadGatewayException,
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AiAnalysisService } from 'src/ai/ai-analysis.service';
import {
  ContentGenerationRepository,
  CreateContentGenerationRun,
} from './content-generation.repository';
import { ContentGenerationService } from './content-generation.service';
import { LlmProvider } from 'src/ai/llm.provider';
import { TrendsService } from './trends.service';
import { TopicCluster } from './interfaces/topic-cluster/topic-cluster.interface';

jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
jest.mock('src/ai/ai-analysis.service', () => ({
  AiAnalysisService: class {},
}));

const trend = {
  id: 'space-topic',
  topic: 'Space discoveries',
  keywords: ['space', 'discovery'],
  categories: ['Science'],
  sources: ['youtube'],
  items: [
    {
      externalId: 'video-reference',
      title: 'Unusual object observed',
      author: 'Channel',
      tags: ['space'],
    },
  ],
  metrics: { itemCount: 1, totalViews: 500, totalLikes: 20, totalComments: 3 },
  isRecurringTopic: false,
  relevanceScore: 65,
} as unknown as TopicCluster;

const ideasOutput = {
  ideas: [1, 2, 3].map((number) => ({
    title: `Idea ${number}`,
    hook: `Hook ${number} for viewers`,
    angle: `Angle ${number} based on the trend`,
    summary: `An original story proposal based on available trend data ${number}.`,
    targetAudience: null,
  })),
};

const scriptOutput = {
  title: 'The unusual signal',
  hook: 'Something unexpected appeared in the data.',
  introduction: 'Here is what the available information tells us.',
  sections: [
    {
      title: 'The observation',
      narration: 'Researchers observed an unusual signal.',
    },
    {
      title: 'What we know',
      narration: 'The available trend data describes the observation.',
    },
  ],
  conclusion: 'More research is needed before drawing a conclusion.',
  estimatedDurationSeconds: 120,
  researchRequired: true,
  researchNotes: ['Verify the original source and date.'],
};

const usage = { inputTokens: 100, outputTokens: 50, totalTokens: 150 };
const generationId = '6c6f8369-1cb2-4a4a-a748-3e4ca7edb923';
const ideaId = '477b86db-3fee-47c1-b692-f35b1a8d2f6d';
const persistedIdea = {
  ...ideasOutput.ideas[0],
  generationId,
  ideaId,
  trendId: trend.id,
  regionCode: 'BR',
  language: 'pt-BR',
};

interface MockGenerationResult {
  data: unknown;
  provider: string;
  model: string;
  usage: typeof usage;
}

interface MockGenerationRequest {
  schemaName: string;
  model: string;
  userPrompt: string;
}

function setup() {
  const trendsService = {
    getYoutubeTrendContext: jest.fn().mockResolvedValue({ trend }),
  };
  const aiAnalysisService = { getModel: jest.fn(() => 'test-model') };
  const llmProvider = {
    generateEmbeddings: jest.fn(),
    generateStructuredOutput: jest.fn<
      Promise<MockGenerationResult>,
      [MockGenerationRequest]
    >(),
  };
  const repository = {
    createRun: jest.fn<Promise<void>, [CreateContentGenerationRun]>(),
    getContext: jest.fn(),
    saveSelectedIdea: jest.fn(),
    saveScript: jest.fn(),
    saveReviewedScript: jest.fn(),
    saveVideoPlan: jest.fn(),
    saveReviewedPlan: jest.fn(),
    listRuns: jest.fn(),
  };
  const service = new ContentGenerationService(
    trendsService as unknown as TrendsService,
    aiAnalysisService as unknown as AiAnalysisService,
    llmProvider as LlmProvider,
    repository as unknown as ContentGenerationRepository,
  );
  return { service, trendsService, llmProvider, repository };
}

describe('ContentGenerationService', () => {
  it('generates and persists 3-5 ideas with trend context and usage', async () => {
    const { service, llmProvider, repository } = setup();
    llmProvider.generateStructuredOutput.mockResolvedValue({
      data: ideasOutput,
      provider: 'openai',
      model: 'test-model',
      usage,
    });

    const ideas = await service.generateIdeas(trend.id);

    expect(ideas).toHaveLength(3);
    expect(ideas[0]).toMatchObject({
      trendId: trend.id,
      regionCode: 'BR',
      language: 'pt-BR',
    });
    const request = llmProvider.generateStructuredOutput.mock.calls[0][0];
    expect(request.schemaName).toBe('content_ideas');
    expect(request.model).toBe('test-model');
    expect(request.userPrompt).toContain('Space discoveries');
    expect(repository.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        generationId: ideas[0].generationId,
        ideas,
        provider: 'openai',
        usage,
      }),
    );
  });

  it('passes requested duration and additional instructions into the idea context', async () => {
    const { service, llmProvider } = setup();
    llmProvider.generateStructuredOutput.mockResolvedValue({
      data: ideasOutput,
      provider: 'openai',
      model: 'test-model',
      usage,
    });

    const ideas = await service.generateIdeas(trend.id, 'BR', 'pt-BR', {
      durationPreference: '10-15',
      additionalInstructions: 'Use suspense and curiosity.',
    });

    expect(ideas[0]).toMatchObject({
      durationPreference: '10-15',
      additionalInstructions: 'Use suspense and curiosity.',
    });
    expect(
      llmProvider.generateStructuredOutput.mock.calls[0][0].userPrompt,
    ).toContain('Use suspense and curiosity.');
  });

  it('persists and sends the selected reference video with generated ideas', async () => {
    const { service, llmProvider, repository } = setup();
    llmProvider.generateStructuredOutput.mockResolvedValue({
      data: ideasOutput,
      provider: 'openai',
      model: 'test-model',
      usage,
    });

    await service.generateIdeas(trend.id, 'BR', 'pt-BR', {
      referenceVideoId: 'video-reference',
    });

    const savedRun = repository.createRun.mock.calls[0][0];
    expect(savedRun.trendSnapshot.referenceVideo).toMatchObject({
      externalId: 'video-reference',
      title: 'Unusual object observed',
    });
    expect(
      llmProvider.generateStructuredOutput.mock.calls[0][0].userPrompt,
    ).toContain('video-reference');
  });

  it('rejects a reference video that is not a member of the selected trend', async () => {
    const { service, llmProvider, repository } = setup();

    await expect(
      service.generateIdeas(trend.id, 'BR', 'pt-BR', {
        referenceVideoId: 'video-other',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(llmProvider.generateStructuredOutput).not.toHaveBeenCalled();
    expect(repository.createRun).not.toHaveBeenCalled();
  });

  it('lists saved generations with a bounded page size', async () => {
    const { service, repository } = setup();
    const page = { items: [], total: 120 };
    repository.listRuns.mockResolvedValue(page);

    await expect(service.listGenerations('br', 500, -5)).resolves.toEqual(page);
    expect(repository.listRuns).toHaveBeenCalledWith({
      regionCode: 'BR',
      limit: 100,
      offset: 0,
    });
  });

  it('rejects malformed region filters before querying the repository', async () => {
    const { service, repository } = setup();
    await expect(service.listGenerations('BRA')).rejects.toThrow(
      'regionCode deve conter duas letras',
    );
    expect(repository.listRuns).not.toHaveBeenCalled();
  });

  it('does not call the provider when the trend lacks usable signals', async () => {
    const { service, trendsService, llmProvider } = setup();
    trendsService.getYoutubeTrendContext.mockResolvedValue({
      trend: { ...trend, topic: '', keywords: [], items: [] },
    });

    await expect(service.generateIdeas(trend.id)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(llmProvider.generateStructuredOutput).not.toHaveBeenCalled();
  });

  it('does not persist ideas if the provider fails', async () => {
    const { service, llmProvider, repository } = setup();
    llmProvider.generateStructuredOutput.mockRejectedValue(
      new Error('provider failed'),
    );

    await expect(service.generateIdeas(trend.id)).rejects.toThrow(
      'provider failed',
    );
    expect(repository.createRun).not.toHaveBeenCalled();
  });

  it('rejects an invalid structured ideas response', async () => {
    const { service, llmProvider, repository } = setup();
    llmProvider.generateStructuredOutput.mockResolvedValue({
      data: { ideas: [] },
      provider: 'openai',
      model: 'test-model',
      usage,
    });

    await expect(service.generateIdeas(trend.id)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(repository.createRun).not.toHaveBeenCalled();
  });

  it('generates a script from the saved selected idea and persists it', async () => {
    const { service, llmProvider, repository } = setup();
    repository.getContext.mockResolvedValue({
      trendSnapshot: { trend },
      ideas: [persistedIdea],
    });
    llmProvider.generateStructuredOutput.mockResolvedValue({
      data: scriptOutput,
      provider: 'openai',
      model: 'test-model',
      usage,
    });

    const script = await service.generateScript(persistedIdea);

    expect(script).toMatchObject({
      generationId,
      ideaId,
      title: scriptOutput.title,
    });
    expect(repository.saveScript).toHaveBeenCalledWith(
      generationId,
      persistedIdea,
      scriptOutput,
      usage,
    );
    expect(llmProvider.generateStructuredOutput).toHaveBeenCalledWith(
      expect.objectContaining({ schemaName: 'generated_script' }),
    );
  });

  it('rejects an idea that is not part of the persisted generation', async () => {
    const { service, llmProvider, repository } = setup();
    repository.getContext.mockResolvedValue({
      trendSnapshot: { trend },
      ideas: [],
    });

    await expect(service.generateScript(persistedIdea)).rejects.toThrow(
      'A ideia não pertence a esta geração',
    );
    expect(llmProvider.generateStructuredOutput).not.toHaveBeenCalled();
  });

  it('persists the selected idea before script generation', async () => {
    const { service, repository, llmProvider } = setup();
    repository.getContext.mockResolvedValue({
      trendSnapshot: { trend },
      ideas: [persistedIdea],
    });

    await expect(
      service.selectIdea(generationId, persistedIdea),
    ).resolves.toEqual(persistedIdea);
    expect(repository.saveSelectedIdea).toHaveBeenCalledWith(
      generationId,
      persistedIdea,
    );
    expect(llmProvider.generateStructuredOutput).not.toHaveBeenCalled();
  });

  it('rejects selection requests whose URL generation does not match the idea', async () => {
    const { service, repository } = setup();

    await expect(
      service.selectIdea('not-the-generation', persistedIdea),
    ).rejects.toThrow('A ideia pertence a outra geração');
    expect(repository.getContext).not.toHaveBeenCalled();
  });

  it('persists a human-edited script without calling the LLM', async () => {
    const { service, repository, llmProvider } = setup();
    const editedScript = {
      ...scriptOutput,
      title: 'Edited by the user',
      generationId,
      ideaId,
      language: 'pt-BR',
    };
    repository.getContext.mockResolvedValue({
      trendSnapshot: { trend },
      ideas: [persistedIdea],
      selectedIdea: persistedIdea,
      script: scriptOutput,
    });

    await expect(
      service.saveReviewedScript(generationId, editedScript),
    ).resolves.toMatchObject({ title: 'Edited by the user' });
    expect(repository.saveReviewedScript).toHaveBeenCalledWith(
      generationId,
      ideaId,
      expect.objectContaining({ title: 'Edited by the user' }),
    );
    expect(llmProvider.generateStructuredOutput).not.toHaveBeenCalled();
  });

  it('generates scenes and derives plan duration from the scene durations', async () => {
    const { service, llmProvider, repository } = setup();
    const persistedScript = {
      ...scriptOutput,
      title: 'User-edited title',
      hook: 'User-edited hook with a new opening.',
      generationId,
      ideaId,
      language: 'pt-BR',
    };
    const scenes = [
      {
        order: 1,
        narration: 'Researchers observed an unusual signal.',
        visualDescription: 'A research observatory at night.',
        imagePrompt: 'cinematic observatory under a starry sky, realistic',
        estimatedDurationSeconds: 8,
      },
      {
        order: 2,
        narration: 'The available trend data describes the observation.',
        visualDescription: 'A data chart on a monitor.',
        imagePrompt:
          'close-up of a scientific data chart on a monitor, cinematic lighting',
        estimatedDurationSeconds: 7,
      },
    ];
    repository.getContext.mockResolvedValue({
      trendSnapshot: { trend },
      ideas: [persistedIdea],
      selectedIdea: persistedIdea,
      script: scriptOutput,
    });
    llmProvider.generateStructuredOutput.mockResolvedValue({
      data: { scenes },
      provider: 'openai',
      model: 'test-model',
      usage,
    });

    const plan = await service.generateScenes(persistedScript);

    expect(plan).toMatchObject({
      title: 'User-edited title',
      generationId,
      totalEstimatedDurationSeconds: 15,
      scenes,
    });
    expect(
      llmProvider.generateStructuredOutput.mock.calls[0][0].userPrompt,
    ).toContain('User-edited hook with a new opening.');
    expect(repository.saveVideoPlan).toHaveBeenCalledWith(
      generationId,
      plan,
      usage,
      expect.objectContaining({ title: 'User-edited title' }),
    );
  });

  it('persists reviewed scenes after validating the generation and sequence', async () => {
    const { service, repository } = setup();
    const persistedScript = {
      ...scriptOutput,
      generationId,
      ideaId,
      language: 'pt-BR',
    };
    const plan = {
      title: 'Edited title',
      totalEstimatedDurationSeconds: 999,
      scenes: [
        {
          order: 1,
          narration: 'Edited narration.',
          visualDescription: 'A wide night skyline.',
          imagePrompt: 'cinematic night skyline, realistic, wide shot',
          estimatedDurationSeconds: 9,
        },
      ],
    };
    repository.getContext.mockResolvedValue({
      trendSnapshot: { trend },
      ideas: [persistedIdea],
      selectedIdea: persistedIdea,
      script: scriptOutput,
    });

    await expect(
      service.saveReviewedPlan(generationId, persistedScript, plan),
    ).resolves.toEqual({
      title: scriptOutput.title,
      totalEstimatedDurationSeconds: 9,
      scenes: plan.scenes,
    });
    expect(repository.saveReviewedPlan).toHaveBeenCalledWith(
      generationId,
      scriptOutput,
      expect.objectContaining({ totalEstimatedDurationSeconds: 9 }),
      true,
    );
  });

  it('rejects scenes with non-sequential order', async () => {
    const { service, llmProvider, repository } = setup();
    const persistedScript = {
      ...scriptOutput,
      generationId,
      ideaId,
      language: 'pt-BR',
    };
    repository.getContext.mockResolvedValue({
      trendSnapshot: { trend },
      ideas: [persistedIdea],
      selectedIdea: persistedIdea,
      script: scriptOutput,
    });
    llmProvider.generateStructuredOutput.mockResolvedValue({
      data: {
        scenes: [
          {
            order: 2,
            narration: 'Narration.',
            visualDescription: 'A visual scene.',
            imagePrompt: 'cinematic scene, realistic lighting',
            estimatedDurationSeconds: 8,
          },
        ],
      },
      provider: 'openai',
      model: 'test-model',
      usage,
    });

    await expect(
      service.generateScenes(persistedScript),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(repository.saveVideoPlan).not.toHaveBeenCalled();
  });
});
