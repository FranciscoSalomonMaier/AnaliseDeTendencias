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
import { spokenText } from '../ai/content-generation/spoken-text';
import { scenesPreserveNarration } from '../ai/content-generation/narrative-continuity';

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
      const spokenScript = GeneratedScriptSchema.safeParse({
        ...data.data,
        hook: spokenText(data.data.hook),
        introduction: spokenText(data.data.introduction),
        sections: data.data.sections.map((s) => ({
          ...s,
          narration: spokenText(s.narration),
        })),
        conclusion: spokenText(data.data.conclusion),
      });
      if (!spokenScript.success)
        throw new BadGatewayException(
          'O roteiro deve conter texto falado válido, sem instruções visuais.',
        );
      return {
        script: estimateScript(spokenScript.data),
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
    const spokenScenes = GeneratedScenesResponseSchema.safeParse({
      ...data.data,
      scenes: data.data.scenes.map((s) => ({
        ...s,
        narration: spokenText(s.narration),
      })),
    });
    if (!spokenScenes.success)
      throw new BadGatewayException(
        'As cenas devem conter narração válida, sem instruções visuais.',
      );
    if (
      !project.script ||
      !scenesPreserveNarration(project.script, spokenScenes.data.scenes)
    )
      throw new BadGatewayException(
        'As cenas geradas não preservaram a narração aprovada na ordem correta. O roteiro foi mantido; tente gerar as cenas novamente.',
      );
    return {
      scenes: spokenScenes.data.scenes.map((s) => ({ ...s, id: randomUUID() })),
      usage: {
        stage,
        ...result.usage,
        provider: result.provider,
        model: result.model,
      },
    };
  }
}
