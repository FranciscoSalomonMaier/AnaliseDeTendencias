import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { z } from 'zod';
import {
  GeneratedScriptSchema,
  GeneratedSceneSchema,
} from '../ai/content-generation/content-generation.schema';
import { ContentProjectRepository } from './content-project.repository';
import { ContentProjectGenerationService } from './content-project-generation.service';
import {
  ContentProject,
  ProjectConfigSchema,
  MutationSchema,
  estimateScript,
} from './content-project.schema';

@Injectable()
export class ContentProjectService {
  constructor(
    private readonly repo: ContentProjectRepository,
    private readonly generator: ContentProjectGenerationService,
  ) {}
  private parse<T>(schema: z.ZodType<T>, input: unknown): T {
    const result = schema.safeParse(input);
    if (!result.success)
      throw new BadRequestException(
        result.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      );
    return result.data;
  }
  create(input: unknown) {
    return this.repo.create(this.parse(ProjectConfigSchema, input));
  }
  get(id: string) {
    return this.repo.get(id);
  }
  list(limit: number, offset: number) {
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isInteger(offset) ||
      offset < 0
    )
      throw new BadRequestException('Paginação inválida');
    return this.repo.list(limit, offset);
  }
  private mutate(
    id: string,
    input: unknown,
    change: (p: ContentProject, confirm: boolean) => void | Promise<void>,
  ) {
    const request = this.parse(MutationSchema, input);
    return this.repo.locked(id, async (p, client) => {
      if (p.revision !== request.revision)
        throw new ConflictException(
          'Projeto alterado em outra janela. Reabra para continuar.',
        );
      await change(p, request.confirm);
      return this.repo.save(p, client);
    });
  }
  private confirm(required: boolean, confirmed: boolean) {
    if (required && !confirmed)
      throw new ConflictException(
        'Confirme a substituição ou invalidação do conteúdo existente',
      );
  }
  update(id: string, input: unknown) {
    const body = this.parse(
      MutationSchema.extend({ config: ProjectConfigSchema }),
      input,
    );
    return this.mutate(id, body, (p, confirmed) => {
      if (
        JSON.stringify(ProjectConfigSchema.parse(p.config)) ===
        JSON.stringify(body.config)
      )
        return;
      this.confirm(
        Boolean(p.ideas.length || p.script || p.scenes.length),
        confirmed,
      );
      p.config = body.config;
      p.status = 'DRAFT';
      p.selectedIdea = null;
      p.scriptStale = Boolean(p.script);
      p.scenesStale = Boolean(p.scenes.length);
    });
  }
  select(id: string, ideaId: string, input: unknown) {
    return this.mutate(id, input, (p, confirmed) => {
      if (p.status === 'DRAFT')
        throw new ConflictException('Gere ideias para a configuração atual');
      const idea = p.ideas.find((i) => i.ideaId === ideaId);
      if (!idea) throw new BadRequestException('Ideia não pertence ao projeto');
      if (p.selectedIdea?.ideaId === ideaId) return;
      this.confirm(Boolean(p.script || p.scenes.length), confirmed);
      p.selectedIdea = idea;
      p.status = 'IDEA_SELECTED';
      p.scriptStale = Boolean(p.script);
      p.scenesStale = Boolean(p.scenes.length);
    });
  }
  generate(id: string, stage: 'ideas' | 'script' | 'scenes', input: unknown) {
    return this.mutate(id, input, async (p, confirmed) => {
      if (stage === 'script' && (!p.selectedIdea || p.status === 'DRAFT'))
        throw new ConflictException(
          'Selecione uma ideia antes de gerar roteiro',
        );
      if (
        stage === 'scenes' &&
        (!p.script ||
          p.scriptStale ||
          !['SCRIPT_APPROVED', 'SCENES_GENERATED', 'SCENES_APPROVED'].includes(
            p.status,
          ))
      )
        throw new ConflictException('Aprove o roteiro antes de gerar cenas');
      this.confirm(
        stage === 'ideas'
          ? Boolean(p.ideas.length)
          : stage === 'script'
            ? Boolean(p.script)
            : Boolean(p.scenes.length),
        confirmed,
      );
      const result = await this.generator.generate(stage, p);
      // Commit only after a valid response. Failures leave the previous work intact.
      if (result.ideas) {
        p.ideas = result.ideas;
        p.selectedIdea = null;
        p.status = 'IDEAS_GENERATED';
        p.scriptStale = Boolean(p.script);
        p.scenesStale = Boolean(p.scenes.length);
      }
      if (result.script) {
        p.script = result.script;
        p.status = 'SCRIPT_GENERATED';
        p.scriptStale = false;
        p.scenesStale = Boolean(p.scenes.length);
      }
      if (result.scenes) {
        p.scenes = result.scenes;
        p.status = 'SCENES_GENERATED';
        p.scenesStale = false;
      }
      p.usage.push(result.usage);
    });
  }
  saveScript(id: string, input: unknown) {
    const body = this.parse(
      MutationSchema.extend({ script: GeneratedScriptSchema }),
      input,
    );
    return this.mutate(id, body, (p, confirmed) => {
      if (!p.script || p.scriptStale || !p.selectedIdea)
        throw new ConflictException('Gere um roteiro para a ideia atual');
      const script = estimateScript(body.script);
      if (
        JSON.stringify(GeneratedScriptSchema.parse(p.script)) ===
        JSON.stringify(script)
      )
        return;
      this.confirm(Boolean(p.scenes.length), confirmed);
      p.script = script;
      p.status = 'SCRIPT_GENERATED';
      p.scenesStale = Boolean(p.scenes.length);
    });
  }
  approveScript(id: string, input: unknown) {
    return this.mutate(id, input, (p) => {
      if (
        !p.script ||
        p.scriptStale ||
        !['SCRIPT_GENERATED', 'SCRIPT_APPROVED'].includes(p.status)
      )
        throw new ConflictException('Roteiro indisponível para aprovação');
      p.status = 'SCRIPT_APPROVED';
    });
  }
  saveScene(id: string, sceneId: string, input: unknown) {
    const body = this.parse(
      MutationSchema.extend({ scene: GeneratedSceneSchema }),
      input,
    );
    return this.mutate(id, body, (p) => {
      if (
        p.scenesStale ||
        !['SCENES_GENERATED', 'SCENES_APPROVED'].includes(p.status)
      )
        throw new ConflictException(
          'Cenas desatualizadas; gere novamente após aprovar o roteiro',
        );
      const index = p.scenes.findIndex((s) => s.id === sceneId);
      if (index < 0)
        throw new BadRequestException('Cena não pertence ao projeto');
      if (body.scene.order !== p.scenes[index].order)
        throw new BadRequestException('A ordem da cena deve ser preservada');
      p.scenes[index] = { ...body.scene, id: sceneId };
      p.status = 'SCENES_GENERATED';
    });
  }
  approveScenes(id: string, input: unknown) {
    return this.mutate(id, input, (p) => {
      if (
        !p.scenes.length ||
        p.scenesStale ||
        !['SCENES_GENERATED', 'SCENES_APPROVED'].includes(p.status)
      )
        throw new ConflictException('Cenas indisponíveis para aprovação');
      p.status = 'SCENES_APPROVED';
    });
  }
}
