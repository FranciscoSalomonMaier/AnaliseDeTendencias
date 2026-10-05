import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AiAnalysisService } from 'src/ai/ai-analysis.service';
import {
  ContentIdeasResponseSchema,
  ContentIdea,
  ContentGenerationSettingsSchema,
  GeneratedScenesResponseSchema,
  GeneratedScriptSchema,
  GeneratedVideoPlanSchema,
  GeneratedVideoPlan,
  PersistedContentIdea,
  PersistedContentIdeaSchema,
  PersistedGeneratedScript,
  PersistedGeneratedScriptSchema,
} from 'src/ai/content-generation/content-generation.schema';
import { contentIdeaPrompt } from 'src/ai/content-generation/prompts/content-idea.prompt';
import { sceneGenerationPrompt } from 'src/ai/content-generation/prompts/scene-generation.prompt';
import { scriptGenerationPrompt } from 'src/ai/content-generation/prompts/script-generation.prompt';
import { LlmProvider } from 'src/ai/llm.provider';
import { TrendsService } from './trends.service';
import { ContentGenerationRepository } from './content-generation.repository';

@Injectable()
export class ContentGenerationService {
  constructor(
    private readonly trendsService: TrendsService,
    private readonly aiAnalysisService: AiAnalysisService,
    private readonly llmProvider: LlmProvider,
    private readonly repository: ContentGenerationRepository,
  ) {}

  async generateIdeas(
    trendId: string,
    regionCode = 'BR',
    language = 'pt-BR',
    settingsInput: unknown = {},
  ): Promise<PersistedContentIdea[]> {
    const region = regionCode.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(region)) {
      throw new BadRequestException('regionCode deve conter duas letras');
    }
    if (language.trim().length < 2 || language.trim().length > 32) {
      throw new BadRequestException(
        'language deve conter entre 2 e 32 caracteres',
      );
    }
    const settingsResult =
      ContentGenerationSettingsSchema.safeParse(settingsInput);
    if (!settingsResult.success) {
      throw new BadRequestException('Configurações de conteúdo inválidas');
    }
    const settings = settingsResult.data;

    const context = await this.trendsService.getYoutubeTrendContext(
      trendId,
      region,
    );
    const trend = context.trend;
    const referenceVideo = settings.referenceVideoId
      ? trend.items.find(
          (item) => item.externalId === settings.referenceVideoId,
        )
      : undefined;
    if (settings.referenceVideoId && !referenceVideo) {
      throw new BadRequestException(
        'O vídeo de referência não pertence a esta trend',
      );
    }
    const hasUsefulSignals =
      Boolean(trend.topic.trim()) &&
      (trend.keywords.some((keyword) => keyword.trim()) ||
        trend.items.some((item) => item.title.trim() || item.tags.length > 0));
    if (!hasUsefulSignals) {
      throw new UnprocessableEntityException(
        'A trend não possui informações suficientes para gerar ideias',
      );
    }

    const generation = await this.llmProvider.generateStructuredOutput({
      model: this.aiAnalysisService.getModel(),
      schemaName: 'content_ideas',
      schema: ContentIdeasResponseSchema,
      systemPrompt: contentIdeaPrompt(language),
      userPrompt: JSON.stringify({
        language,
        settings,
        trend: this.toPromptTrend(trend),
        referenceVideo: referenceVideo ?? null,
        existingAiAnalysis: context.aiAnalysis ?? null,
      }),
    });
    const output = ContentIdeasResponseSchema.safeParse(generation.data);
    if (!output.success) {
      throw new BadGatewayException('A IA retornou ideias em formato inválido');
    }

    const generationId = randomUUID();
    const ideaSettings = {
      durationPreference: settings.durationPreference,
      additionalInstructions: settings.additionalInstructions,
    };
    const ideas = output.data.ideas.map((idea: ContentIdea) => ({
      ...idea,
      ideaId: randomUUID(),
      generationId,
      trendId,
      regionCode: region,
      language,
      ...ideaSettings,
    }));
    await this.repository.createRun({
      generationId,
      trendId,
      regionCode: region,
      language,
      trendSnapshot: {
        trend,
        aiAnalysis: context.aiAnalysis,
        referenceVideo,
      },
      ideas,
      provider: generation.provider,
      model: generation.model,
      usage: generation.usage,
    });
    return ideas;
  }

  async generateScript(input: unknown): Promise<PersistedGeneratedScript> {
    const idea = this.parseInput(
      PersistedContentIdeaSchema,
      input,
      'Ideia inválida',
    );
    const context = await this.repository.getContext(idea.generationId);
    const selectedIdea = context.ideas.find(
      (saved) => saved.ideaId === idea.ideaId,
    );
    if (!selectedIdea) {
      throw new BadRequestException('A ideia não pertence a esta geração');
    }

    const generation = await this.llmProvider.generateStructuredOutput({
      model: this.aiAnalysisService.getModel(),
      schemaName: 'generated_script',
      schema: GeneratedScriptSchema,
      systemPrompt: scriptGenerationPrompt(
        selectedIdea.language,
        selectedIdea.durationPreference ?? '8-10',
      ),
      userPrompt: JSON.stringify({
        language: selectedIdea.language,
        trendSnapshot: context.trendSnapshot,
        selectedIdea,
      }),
    });
    const output = GeneratedScriptSchema.safeParse(generation.data);
    if (!output.success) {
      throw new BadGatewayException(
        'A IA retornou um roteiro em formato inválido',
      );
    }

    await this.repository.saveScript(
      idea.generationId,
      selectedIdea,
      output.data,
      generation.usage,
    );
    return {
      ...output.data,
      generationId: idea.generationId,
      ideaId: idea.ideaId,
      language: selectedIdea.language,
    };
  }

  async selectIdea(
    generationId: string,
    input: unknown,
  ): Promise<PersistedContentIdea> {
    const idea = this.parseInput(
      PersistedContentIdeaSchema,
      input,
      'Ideia inválida',
    );
    if (idea.generationId !== generationId) {
      throw new BadRequestException('A ideia pertence a outra geração');
    }
    const context = await this.repository.getContext(generationId);
    const savedIdea = context.ideas.find(
      (candidate) => candidate.ideaId === idea.ideaId,
    );
    if (!savedIdea) {
      throw new BadRequestException('A ideia não pertence a esta geração');
    }
    await this.repository.saveSelectedIdea(generationId, savedIdea);
    return savedIdea;
  }

  async saveReviewedScript(
    generationId: string,
    input: unknown,
  ): Promise<PersistedGeneratedScript> {
    const script = this.parseInput(
      PersistedGeneratedScriptSchema,
      input,
      'Roteiro inválido',
    );
    if (script.generationId !== generationId) {
      throw new BadRequestException('O roteiro pertence a outra geração');
    }
    const context = await this.repository.getContext(generationId);
    if (context.selectedIdea?.ideaId !== script.ideaId) {
      throw new BadRequestException(
        'O roteiro não pertence à ideia selecionada',
      );
    }
    const reviewedScript = GeneratedScriptSchema.parse(script);
    await this.repository.saveReviewedScript(
      generationId,
      script.ideaId,
      reviewedScript,
    );
    return script;
  }

  async generateScenes(
    input: unknown,
  ): Promise<GeneratedVideoPlan & { generationId: string }> {
    const requestedScript = this.parseInput(
      PersistedGeneratedScriptSchema,
      input,
      'Roteiro inválido',
    );
    const context = await this.repository.getContext(
      requestedScript.generationId,
    );
    if (
      !context.script ||
      context.selectedIdea?.ideaId !== requestedScript.ideaId
    ) {
      throw new BadRequestException('O roteiro não pertence a uma ideia salva');
    }

    const editedScript = GeneratedScriptSchema.parse(requestedScript);

    const generation = await this.llmProvider.generateStructuredOutput({
      model: this.aiAnalysisService.getModel(),
      schemaName: 'generated_scenes',
      schema: GeneratedScenesResponseSchema,
      systemPrompt: sceneGenerationPrompt(context.selectedIdea.language),
      userPrompt: JSON.stringify({
        language: context.selectedIdea.language,
        script: editedScript,
      }),
    });
    const output = GeneratedScenesResponseSchema.safeParse(generation.data);
    if (!output.success) {
      throw new BadGatewayException('A IA retornou cenas em formato inválido');
    }
    if (output.data.scenes.some((scene, index) => scene.order !== index + 1)) {
      throw new BadGatewayException(
        'A IA retornou uma ordem de cenas inválida',
      );
    }

    const plan = {
      title: editedScript.title,
      totalEstimatedDurationSeconds: output.data.scenes.reduce(
        (total, scene) => total + scene.estimatedDurationSeconds,
        0,
      ),
      scenes: output.data.scenes,
      generationId: requestedScript.generationId,
    };
    await this.repository.saveVideoPlan(
      requestedScript.generationId,
      plan,
      generation.usage,
      editedScript,
    );
    return plan;
  }

  async getGeneration(generationId: string) {
    return this.repository.getContext(generationId);
  }

  async listGenerations(regionCode?: string, limit = 50, offset = 0) {
    const region = regionCode?.trim().toUpperCase();
    if (region && !/^[A-Z]{2}$/.test(region)) {
      throw new BadRequestException('regionCode deve conter duas letras');
    }
    const safeLimit = Math.min(Math.max(Math.floor(limit) || 50, 1), 100);
    const safeOffset = Math.max(Math.floor(offset) || 0, 0);
    return this.repository.listRuns({
      regionCode: region,
      limit: safeLimit,
      offset: safeOffset,
    });
  }

  async saveReviewedPlan(
    generationId: string,
    scriptInput: unknown,
    planInput: unknown,
    approved = true,
  ): Promise<GeneratedVideoPlan> {
    const script = this.parseInput(
      PersistedGeneratedScriptSchema,
      scriptInput,
      'Roteiro inválido',
    );
    const editedScript = GeneratedScriptSchema.parse(script);
    const plan = this.parseInput(
      GeneratedVideoPlanSchema,
      planInput,
      'Plano de cenas inválido',
    );
    if (script.generationId !== generationId) {
      throw new BadRequestException('O roteiro pertence a outra geração');
    }
    const context = await this.repository.getContext(generationId);
    if (!context.script || context.selectedIdea?.ideaId !== script.ideaId) {
      throw new BadRequestException('O roteiro não pertence a uma ideia salva');
    }
    if (plan.scenes.some((scene, index) => scene.order !== index + 1)) {
      throw new BadRequestException('A ordem das cenas é inválida');
    }
    const reviewedPlan = {
      title: editedScript.title,
      totalEstimatedDurationSeconds: plan.scenes.reduce(
        (total, scene) => total + scene.estimatedDurationSeconds,
        0,
      ),
      scenes: plan.scenes,
    };
    await this.repository.saveReviewedPlan(
      generationId,
      editedScript,
      reviewedPlan,
      approved,
    );
    return reviewedPlan;
  }

  async generateContentPlan(
    trendId: string,
    selectedIdea?: unknown,
    regionCode = 'BR',
    language = 'pt-BR',
  ): Promise<
    | { ideas: PersistedContentIdea[] }
    | {
        idea: PersistedContentIdea;
        script: PersistedGeneratedScript;
        videoPlan: GeneratedVideoPlan & { generationId: string };
      }
  > {
    if (selectedIdea === undefined || selectedIdea === null) {
      return { ideas: await this.generateIdeas(trendId, regionCode, language) };
    }
    const idea = this.parseInput(
      PersistedContentIdeaSchema,
      selectedIdea,
      'Ideia inválida',
    );
    if (idea.trendId !== trendId) {
      throw new BadRequestException(
        'A ideia selecionada pertence a outra trend',
      );
    }
    const script = await this.generateScript(idea);
    const videoPlan = await this.generateScenes(script);
    return { idea, script, videoPlan };
  }

  private parseInput<T>(
    schema: { safeParse: (value: unknown) => { success: boolean; data?: T } },
    value: unknown,
    message: string,
  ): T {
    const parsed = schema.safeParse(value);
    if (!parsed.success || parsed.data === undefined) {
      throw new BadRequestException(message);
    }
    return parsed.data;
  }

  private toPromptTrend(
    trend: Awaited<
      ReturnType<TrendsService['getYoutubeTrendContext']>
    >['trend'],
  ) {
    return {
      id: trend.id,
      topic: trend.topic,
      keywords: trend.keywords,
      categories: trend.categories,
      sources: trend.sources,
      metrics: trend.metrics,
      relevanceScore: trend.relevanceScore,
      isRecurringTopic: trend.isRecurringTopic,
      relatedVideos: trend.items.slice(0, 10).map((item) => ({
        title: item.title,
        author: item.author,
        publishedAt: item.publishedAt,
        tags: item.tags,
        category: item.category,
        metrics: item.metrics,
        calculatedMetrics: item.calculatedMetrics,
      })),
    };
  }
}
