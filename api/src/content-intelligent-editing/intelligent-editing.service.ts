import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import { ContentProjectRepository } from '../content-projects/content-project.repository';
import { ContentAssetRepository } from '../content-assets/content-asset.repository';
import { NarrationRepository } from '../content-narration/narration.repository';
import { ProjectAudioRepository } from '../content-audio/project-audio.repository';
import { SubtitleRepository } from '../content-subtitles/subtitle.repository';
import { StorageProvider } from '../content-assets/storage.provider';
import { EditingRepository } from '../video-render/editing.repository';
import { VideoRenderService } from '../video-render/video-render.service';
import { editingSchema } from '../video-render/editing-settings';
import { EditingPlanRepository } from './editing-plan.repository';
import {
  PLAN_PROMPT_VERSION,
  formatSchema,
  styleSchema,
  intensitySchema,
  hashData,
  suggestionSchema,
  effectiveSuggestion,
  type EditingPlan,
  type PlanInput,
} from './editing-plan.schema';
const mutation = z
  .object({
    revision: z.number().int().nonnegative(),
    confirm: z.literal(true),
  })
  .strict();
@Injectable()
export class IntelligentEditingService {
  constructor(
    private readonly config: ConfigService,
    private readonly projects: ContentProjectRepository,
    private readonly assets: ContentAssetRepository,
    private readonly narration: NarrationRepository,
    private readonly audio: ProjectAudioRepository,
    private readonly subtitles: SubtitleRepository,
    private readonly storage: StorageProvider,
    private readonly editing: EditingRepository,
    readonly repository: EditingPlanRepository,
    private readonly renders: VideoRenderService,
  ) {}
  get owner() {
    return this.config.get<string>('CONTENT_OWNER_ID') ?? 'local-owner';
  }
  configuration() {
    return {
      enabled: Boolean(
        this.config.get('CONTENT_ACCESS_KEY') &&
        this.config.get('OPENAI_API_KEY'),
      ),
      model:
        this.config.get<string>('INTELLIGENT_EDITING_MODEL') ||
        this.config.get<string>('OPENAI_MODEL') ||
        'gpt-5.6-luna',
      visualModel:
        this.config.get<string>('INTELLIGENT_EDITING_VISUAL_MODEL') || null,
      maxScenes: Math.min(
        80,
        Math.max(
          1,
          Number(this.config.get('INTELLIGENT_EDITING_MAX_SCENES')) || 40,
        ),
      ),
      concurrency: 1,
      thumbnailMaxEdge: 1024,
      automaticPaidAnalysis: false,
    };
  }
  async authorize(id: string, client?: PoolClient) {
    if (!this.config.get('CONTENT_ACCESS_KEY'))
      throw new ServiceUnavailableException(
        'Configure CONTENT_ACCESS_KEY para usar a edição inteligente.',
      );
    const sql =
      'SELECT owner_id FROM content_generation_runs WHERE generation_id=$1';
    const r = await (client
      ? client.query<{ owner_id: string | null }>(sql, [id])
      : this.repository.db.query<{ owner_id: string | null }>(sql, [id]));
    if (r.rows[0]?.owner_id && r.rows[0].owner_id !== this.owner)
      throw new ForbiddenException('Projeto pertence a outro proprietário.');
    return this.projects.get(id, client);
  }
  async source(id: string, format: '16:9' | '9:16', client?: PoolClient) {
    const project = await this.authorize(id, client);
    const assets = await this.assets.list(id, client),
      visuals = await this.assets.selections(id, client),
      audio = await this.narration.selections(id, client);
    const editing = await this.editing.get(id, client);
    const images: PlanInput['images'] = [];
    for (const scene of project.scenes) {
      const selected = visuals.find((v) => v.sceneId === scene.id);
      const image = assets.find(
        (a) =>
          a.id === selected?.assetId &&
          a.projectId === id &&
          a.type === 'IMAGE' &&
          a.status === 'READY',
      );
      if (!image?.storageKey) continue;
      const stat = await this.storage.stat?.(image.storageKey);
      if (stat && stat.size > 25 * 1024 * 1024)
        throw new BadRequestException(
          'Imagem excede o limite de análise de 25 MiB.',
        );
      const content = await this.storage.read(image.storageKey);
      if (content.length > 25 * 1024 * 1024)
        throw new BadRequestException('Imagem excede o limite de análise.');
      images.push({
        sceneId: scene.id,
        assetId: image.id,
        key: image.storageKey,
        width: Number(image.width),
        height: Number(image.height),
        hash: createHash('sha256').update(content).digest('hex'),
      });
    }
    const context = {
      projectRevision: project.revision,
      script: project.script,
      scenes: [...project.scenes]
        .sort((a, b) => a.order - b.order)
        .map((s) => ({
          ...s,
          audio: audio
            .filter((a) => a.sceneId === s.id)
            .map((a) => {
              const asset = assets.find((v) => v.id === a.assetId);
              return {
                assetId: a.assetId,
                acceptedFingerprint: a.acceptedFingerprint,
                durationSeconds: asset?.durationSeconds ?? null,
                updatedAt: asset?.updatedAt ?? null,
              };
            }),
        })),
      format,
      projectFormat: project.config.aspectRatio ?? '16:9',
      activeFormat: editing.aspectRatio ?? project.config.aspectRatio ?? '16:9',
      visuals,
      images: images.map((i) => ({
        sceneId: i.sceneId,
        assetId: i.assetId,
        hash: i.hash,
        width: i.width,
        height: i.height,
      })),
      audioMix: await this.audio.get(id, client),
      subtitles: await this.subtitles.state(id, client),
    };
    return { project, editing, images, context, inputHash: hashData(context) };
  }
  async analyze(id: string, body: unknown) {
    const input = z
      .object({
        revision: z.number().int().nonnegative(),
        format: formatSchema,
        style: styleSchema,
        intensity: intensitySchema,
        confirm: z.literal(true),
      })
      .strict()
      .safeParse(body);
    if (!input.success)
      throw new BadRequestException(
        'Informe formato, estilo, intensidade e confirme o custo da análise.',
      );
    const cfg = this.configuration();
    if (!cfg.enabled)
      throw new ServiceUnavailableException(
        'Análise de IA indisponível. A edição manual e a renderização continuam disponíveis.',
      );
    return this.projects.locked(id, async (p, client) => {
      if (p.revision !== input.data.revision)
        throw new ConflictException('Projeto alterado. Atualize a página.');
      if (!p.script || !p.scenes.length || p.scenes.length > cfg.maxScenes)
        throw new BadRequestException(
          `É necessário roteiro e de 1 a ${cfg.maxScenes} cenas.`,
        );
      if (
        (await this.repository.list(id, this.owner)).some((p) =>
          ['PENDING', 'PROCESSING'].includes(p.status),
        )
      )
        throw new ConflictException('Já existe uma análise neste projeto.');
      const source = await this.source(id, input.data.format, client);
      if (Buffer.byteLength(JSON.stringify(source.context)) > 250000)
        throw new BadRequestException(
          'Roteiro excede o limite de análise de 250 KB.',
        );
      const plan = await this.repository.create(
        id,
        this.owner,
        {
          format: input.data.format,
          style: input.data.style,
          intensity: input.data.intensity,
          model: cfg.model,
          visualModel: cfg.visualModel,
          promptVersion: PLAN_PROMPT_VERSION,
          editing: source.editing,
          context: source.context,
          images: source.images,
        },
        source.inputHash,
        client,
      );
      await this.repository.event(plan, 'REQUESTED', {}, client);
      return this.dto(plan, false);
    });
  }
  async current(plan: EditingPlan, client?: PoolClient) {
    const source = await this.source(plan.projectId, plan.input.format, client);
    return {
      ...source,
      stale:
        (plan.status === 'APPLIED'
          ? hashData({
              ...source.context,
              activeFormat: plan.input.context.activeFormat,
            }) !== plan.inputHash ||
            (source.editing.aspectRatio ??
              source.project.config.aspectRatio ??
              '16:9') !== plan.input.format
          : source.inputHash !== plan.inputHash) ||
        source.editing.revision !==
          (plan.status === 'APPLIED'
            ? plan.appliedEditingRevision
            : plan.input.editing.revision),
    };
  }
  dto(p: EditingPlan, stale: boolean) {
    return {
      id: p.id,
      projectId: p.projectId,
      version: p.version,
      revision: p.revision,
      status: p.status,
      progress: p.progress,
      cancelRequested: p.cancelRequested,
      error: p.error,
      result: p.result,
      usage: p.usage,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      stale,
      format: p.input.format,
      style: p.input.style,
      intensity: p.input.intensity,
      model: p.input.model,
      visualModel: p.input.visualModel,
      sourceHash: p.inputHash,
      sources: p.input.images.map((i) => ({
        sceneId: i.sceneId,
        assetId: i.assetId,
        hash: i.hash,
        width: i.width,
        height: i.height,
      })),
      before: p.input.editing,
      appliedEditingRevision: p.appliedEditingRevision,
    };
  }
  async list(id: string) {
    await this.authorize(id);
    return {
      configuration: this.configuration(),
      plans: (await this.repository.list(id, this.owner)).map((p) =>
        this.dto(p, false),
      ),
    };
  }
  async get(id: string, planId: string) {
    await this.authorize(id);
    const p = await this.repository.get(id, planId, this.owner);
    const state = await this.current(p);
    return {
      ...this.dto(p, state.stale),
      events: await this.repository.events(p),
    };
  }
  async cancel(id: string, planId: string) {
    await this.authorize(id);
    const p = await this.repository.get(id, planId, this.owner);
    await this.repository.cancel(p);
    await this.repository.event(p, 'CANCEL_REQUESTED');
    return this.dto({ ...p, cancelRequested: true }, false);
  }
  async review(id: string, planId: string, body: unknown) {
    const parsed = z
      .object({
        revision: z.number().int().nonnegative(),
        sceneId: z.string().uuid().optional(),
        decision: z.enum(['ACCEPTED', 'REJECTED']).optional(),
        suggestion: suggestionSchema.optional(),
        approveAll: z.boolean().optional(),
      })
      .strict()
      .safeParse(body);
    if (
      !parsed.success ||
      (parsed.data.sceneId && !parsed.data.decision) ||
      (parsed.data.suggestion && !parsed.data.sceneId) ||
      (parsed.data.decision && !parsed.data.sceneId) ||
      (!parsed.data.approveAll &&
        (!parsed.data.sceneId || !parsed.data.decision))
    )
      throw new BadRequestException('Revisão inválida.');
    return this.projects.locked(id, async (_p, client) => {
      await this.authorize(id, client);
      const p = await this.repository.get(id, planId, this.owner, client);
      if (
        p.revision !== parsed.data.revision ||
        !['COMPLETED', 'APPROVED'].includes(p.status) ||
        !p.result
      )
        throw new ConflictException('Plano alterado ou não editável.');
      if (parsed.data.approveAll) {
        for (const scene of p.result.scenes) {
          if (scene.decision !== 'REJECTED') scene.decision = 'ACCEPTED';
        }
      }
      if (parsed.data.sceneId) {
        const scene = p.result.scenes.find(
          (s) => s.sceneId === parsed.data.sceneId,
        );
        if (!scene)
          throw new BadRequestException('Cena não pertence ao plano.');
        if (parsed.data.suggestion) {
          if (parsed.data.suggestion.sceneId !== scene.sceneId)
            throw new BadRequestException(
              'Identificador da sugestão inválido.',
            );
          const effective = effectiveSuggestion(
            parsed.data.suggestion,
            p.input.intensity,
            scene.visual,
            {
              width:
                p.input.images.find((i) => i.sceneId === scene.sceneId)
                  ?.width ?? 0,
              height:
                p.input.images.find((i) => i.sceneId === scene.sceneId)
                  ?.height ?? 0,
              format: p.input.format,
            },
          );
          Object.assign(scene, parsed.data.suggestion, effective);
        }
        scene.decision = parsed.data.decision!;
      }
      p.status =
        p.result.scenes.every((s) => s.decision !== 'PENDING') &&
        p.result.scenes.some((s) => s.decision === 'ACCEPTED')
          ? 'APPROVED'
          : 'COMPLETED';
      p.revision++;
      await this.repository.save(p, client);
      await this.repository.event(
        p,
        'REVIEWED',
        {
          sceneId: parsed.data.sceneId ?? null,
          approveAll: parsed.data.approveAll ?? false,
        },
        client,
      );
      return this.dto(p, (await this.current(p, client)).stale);
    });
  }
  async apply(id: string, planId: string, body: unknown, restore = false) {
    const parsed = mutation.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(
        'Confirme a aplicação e a revisão do plano.',
      );
    return this.projects.locked(id, async (_project, client) => {
      await this.authorize(id, client);
      const p = await this.repository.get(id, planId, this.owner, client);
      if (p.revision !== parsed.data.revision)
        throw new ConflictException('Plano alterado. Reabra antes de aplicar.');
      const current = await this.current(p, client);
      if (restore) {
        if (
          p.status !== 'APPLIED' ||
          !p.previousEditing ||
          current.editing.revision !== p.appliedEditingRevision
        )
          throw new ConflictException(
            'Há edições posteriores. Restauração bloqueada para preservá-las.',
          );
        await client.query('BEGIN');
        try {
          await this.editing.save(
            id,
            { ...p.previousEditing, revision: current.editing.revision + 1 },
            client,
          );
          p.status = 'RESTORED';
          p.revision++;
          await this.repository.save(p, client);
          await this.repository.event(p, 'RESTORED', {}, client);
          await client.query('COMMIT');
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        }
      } else {
        if (current.stale)
          throw new ConflictException(
            'Plano desatualizado. O roteiro, os assets, o formato ou a edição foram alterados. Reanalise.',
          );
        if (p.status !== 'APPROVED' || !p.result)
          throw new ConflictException(
            'Revise todas as sugestões e aprove o plano antes de aplicar.',
          );
        const settings = structuredClone(current.editing);
        const format = p.input.format;
        const map = structuredClone(
          settings.variants?.[format] ??
            ((settings.aspectRatio ??
              current.project.config.aspectRatio ??
              '16:9') === format
              ? settings.scenes
              : {}),
        );
        const skipped: string[] = [];
        const applied: string[] = [];
        for (const scene of p.result.scenes) {
          if (scene.decision !== 'ACCEPTED') continue;
          // Existing explicit manual settings are protected even on legacy projects.
          const previous = map[scene.sceneId];
          if (
            previous?.locked ||
            (previous &&
              previous.locked !== false &&
              previous.origin !== 'AI' &&
              previous.motion !== 'AUTO')
          ) {
            skipped.push(scene.sceneId);
            continue;
          }
          map[scene.sceneId] = { ...scene.effective, planId: p.id };
          applied.push(scene.sceneId);
        }
        if (!applied.length)
          throw new ConflictException(
            'Nenhuma cena aplicável. As sugestões foram rejeitadas ou as configurações manuais estão protegidas.',
          );
        settings.variants = {
          ...settings.variants,
          [settings.aspectRatio ??
          current.project.config.aspectRatio ??
          '16:9']: structuredClone(settings.scenes),
          [format]: map,
        };
        settings.scenes = map;
        settings.aspectRatio = format;
        settings.revision++;
        settings.appliedPlan = {
          id: p.id,
          version: p.version,
          revision: p.revision,
          inputHash: p.inputHash,
          style: p.input.style,
          intensity: p.input.intensity,
        };
        p.previousEditing = current.editing;
        p.appliedEditingRevision = settings.revision;
        p.status = 'APPLIED';
        p.revision++;
        await client.query('BEGIN');
        try {
          await this.editing.save(id, editingSchema.parse(settings), client);
          await this.repository.save(p, client);
          await this.repository.event(
            p,
            'APPLIED',
            { applied, skipped },
            client,
          );
          await client.query('COMMIT');
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        }
      }
      return this.dto(p, false);
    });
  }
  async preview(id: string, planId: string) {
    await this.authorize(id);
    const p = await this.repository.get(id, planId, this.owner);
    const state = await this.current(p);
    if (
      p.status !== 'APPLIED' ||
      state.stale ||
      state.editing.appliedPlan?.id !== p.id
    )
      throw new ConflictException(
        'Aplique o plano atual antes de gerar a prévia.',
      );
    return this.renders.create(
      id,
      {
        revision: state.project.revision,
        editingRevision: state.editing.revision,
      },
      true,
    );
  }
}
