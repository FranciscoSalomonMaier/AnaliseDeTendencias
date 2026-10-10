import { BadGatewayException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AiAnalysisService } from '../ai/ai-analysis.service';
import { LlmProvider } from '../ai/llm.provider';
import {
  ContentIdeasResponseSchema,
  GeneratedScriptSchema,
  GeneratedScenesResponseSchema,
} from '../ai/content-generation/content-generation.schema';
import { projectPrompt } from '../ai/content-generation/prompts/content-project.prompt';
import { ContentProject, estimateScript } from './content-project.schema';

@Injectable()
export class ContentProjectGenerationService {
  constructor(
    private readonly llm: LlmProvider,
    private readonly analysis: AiAnalysisService,
  ) {}
  async generate(
    stage: 'ideas' | 'script' | 'scenes',
    project: ContentProject,
  ) {
    const prompts = projectPrompt(
      stage,
      project.config,
      project.selectedIdea ?? undefined,
      project.script ?? undefined,
    );
    const request = {
      model: this.analysis.getModel(),
      schemaName: `content_project_${stage}`,
      ...prompts,
    };
    if (stage === 'ideas') {
      const result = await this.llm.generateStructuredOutput({
        ...request,
        schema: ContentIdeasResponseSchema,
      });
      const data = ContentIdeasResponseSchema.safeParse(result.data);
      if (!data.success)
        throw new BadGatewayException('A IA retornou ideias inválidas');
      return {
        ideas: data.data.ideas.map((i) => ({ ...i, ideaId: randomUUID() })),
        usage: {
          stage,
          ...result.usage,
          provider: result.provider,
          model: result.model,
        },
      };
    }
    if (stage === 'script') {
      const result = await this.llm.generateStructuredOutput({
        ...request,
        schema: GeneratedScriptSchema,
      });
      const data = GeneratedScriptSchema.safeParse(result.data);
      if (!data.success)
        throw new BadGatewayException('A IA retornou um roteiro inválido');
      return {
        script: estimateScript(data.data),
        usage: {
          stage,
          ...result.usage,
          provider: result.provider,
          model: result.model,
        },
      };
    }
    const result = await this.llm.generateStructuredOutput({
      ...request,
      schema: GeneratedScenesResponseSchema,
    });
    const data = GeneratedScenesResponseSchema.safeParse(result.data);
    if (!data.success || data.data.scenes.some((s, i) => s.order !== i + 1))
      throw new BadGatewayException(
        'A IA retornou cenas inválidas ou fora de ordem',
      );
    return {
      scenes: data.data.scenes.map((s) => ({ ...s, id: randomUUID() })),
      usage: {
        stage,
        ...result.usage,
        provider: result.provider,
        model: result.model,
      },
    };
  }
}
