import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ContentProjectRepository } from '../content-projects/content-project.repository';
import { ContentAssetRepository } from '../content-assets/content-asset.repository';
import { NarrationRepository } from '../content-narration/narration.repository';
import { StorageProvider } from '../content-assets/storage.provider';
import { narrationTextHash } from '../content-narration/tts-settings';
import { TimelineBuilder } from '../video-render/timeline.builder';
import {
  SpeechAlignmentProvider,
  SpeechAlignmentRateLimitError,
} from './speech-alignment.provider';
import { SubtitleRepository } from './subtitle.repository';
import {
  SubtitleSettingsSchema,
  SubtitleSegmentSchema,
  SubtitleVersion,
  SubtitleSegment,
  validateSegments,
} from './subtitle.schema';
import {
  prepareAlignment,
  matchText,
  subtitleSnapshot,
} from './subtitle.builder';
import { exportSrt, wrapSubtitle } from './subtitle.formats';
const revisionSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    replace: z.boolean().optional(),
  })
  .strict();
@Injectable()
export class SubtitleService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private timer?: NodeJS.Timeout;
  private draining = false;
  private stopped = false;
  private work?: Promise<void>;
  private readonly logger = new Logger(SubtitleService.name);
  constructor(
    private readonly projects: ContentProjectRepository,
    private readonly assets: ContentAssetRepository,
    private readonly narration: NarrationRepository,
    private readonly repository: SubtitleRepository,
    private readonly storage: StorageProvider,
    private readonly provider: SpeechAlignmentProvider,
    private readonly timeline: TimelineBuilder,
    @Optional() private readonly config?: ConfigService,
  ) {}
  async onApplicationBootstrap() {
    this.stopped = false;
    if (
      !Number.isInteger(this.requestIntervalMs) ||
      this.requestIntervalMs < 1000 ||
      this.requestIntervalMs > 60000
    )
      throw Error(
        'SUBTITLE_REQUEST_INTERVAL_MS deve estar entre 1000 e 60000.',
      );
    await this.repository.startWorker();
    this.timer = setInterval(() => void this.drain(), 1000);
    this.timer.unref();
    void this.drain();
  }
  async onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.work?.catch(() => undefined);
    await this.repository.stopWorker();
  }
  async list(id: string) {
    const project = await this.projects.get(id),
      versions = await this.repository.list(id),
      state = await this.repository.state(id),
      audio = await this.narration.selections(id);
    const scenes = project.scenes.map((s) => {
      const selectedAudio =
        audio.find((a) => a.sceneId === s.id)?.assetId ?? null;
      const selected = versions.find(
        (v) =>
          v.id === state.selections[s.id] &&
          v.audioAssetId === selectedAudio &&
          v.status === 'READY',
      );
      return {
        sceneId: s.id,
        audioAssetId: selectedAudio,
        selectedId: selected?.id ?? null,
        outdated:
          !!selected &&
          selected.data.referenceHash !== narrationTextHash(s.narration),
        ready:
          !!selected &&
          selected.data.referenceHash === narrationTextHash(s.narration),
      };
    });
    return {
      project,
      ...state,
      versions,
      scenes,
      visualSelections: await this.assets.selections(id),
      readyCount: scenes.filter((s) => s.ready).length,
      busyCount: versions.filter((v) =>
        ['QUEUED', 'PROCESSING'].includes(v.status),
      ).length,
      provider: 'openai',
      model: 'whisper-1',
      costPerMinuteUSD: 0.006,
    };
  }
  async generate(id: string, sceneId: string | null, input: unknown) {
    const parsed = revisionSchema.safeParse(input);
    if (!parsed.success)
      throw new BadRequestException('Informe a revisão atual do projeto.');
    await this.projects.locked(id, async (p, client) => {
      if (p.revision !== parsed.data.revision)
        throw new ConflictException(
          'Projeto alterado. Atualize para continuar.',
        );
      if (p.scenesStale || p.scriptStale || p.status !== 'SCENES_APPROVED')
        throw new BadRequestException(
          'Aprove as cenas atuais antes de gerar legendas.',
        );
      if (sceneId && !p.scenes.some((s) => s.id === sceneId))
        throw new NotFoundException('Cena não encontrada.');
      const selections = await this.narration.selections(id, client),
        assets = await this.assets.list(id, client),
        versions = await this.repository.list(id, client),
        state = await this.repository.state(id, client);
      const jobs: SubtitleVersion[] = [];
      for (const scene of p.scenes.filter(
        (s) => !sceneId || s.id === sceneId,
      )) {
        const asset = assets.find(
          (a) =>
            a.id === selections.find((a) => a.sceneId === scene.id)?.assetId,
        );
        if (!asset) {
          if (sceneId)
            throw new BadRequestException(
              'Selecione uma narração para esta cena.',
            );
          continue;
        }
        if (
          asset.projectId !== id ||
          asset.sceneId !== scene.id ||
          asset.type !== 'AUDIO' ||
          asset.status !== 'READY' ||
          (asset.metadata.audioRole &&
            asset.metadata.audioRole !== 'NARRATION') ||
          !asset.storageKey ||
          !['audio/wav', 'audio/mpeg'].includes(asset.mimeType ?? '') ||
          !asset.durationSeconds ||
          asset.durationSeconds > 600
        )
          throw new BadRequestException('Narração selecionada inválida.');
        const info = await this.storage.stat!(asset.storageKey);
        if (info.size <= 0 || info.size > 20 * 1024 * 1024)
          throw new BadRequestException(
            'Arquivo da narração indisponível ou acima do limite.',
          );
        if (
          versions.some(
            (v) =>
              v.sceneId === scene.id &&
              v.audioAssetId === asset.id &&
              ['QUEUED', 'PROCESSING'].includes(v.status),
          )
        )
          continue;
        const existing = versions.find(
          (v) =>
            v.sceneId === scene.id &&
            v.audioAssetId === asset.id &&
            v.status === 'READY' &&
            v.data.referenceHash === narrationTextHash(scene.narration),
        );
        if (existing && (!parsed.data.replace || !sceneId)) {
          if (sceneId)
            throw new ConflictException(
              'Já existem legendas para este áudio. Confirme a regeneração.',
            );
          continue;
        }
        const language = p.config.language.startsWith('pt')
          ? 'pt'
          : p.config.language.startsWith('en')
            ? 'en'
            : undefined;
        jobs.push({
          id: randomUUID(),
          projectId: id,
          sceneId: scene.id,
          audioAssetId: asset.id,
          status: 'QUEUED',
          createdAt: new Date().toISOString(),
          error: null,
          data: {
            referenceText: scene.narration,
            referenceHash: narrationTextHash(scene.narration),
            language: language ?? '',
            audioDurationSeconds: asset.durationSeconds,
            settings: state.settings,
            segments: [],
            granularity: 'SEGMENT',
            provider: 'openai',
            model: 'whisper-1',
            transcript: '',
            matchScore: null,
            reviewRequired: false,
            edited: false,
            selectedVersionAtRequest: state.selections[scene.id],
          },
        });
      }
      if ((await this.repository.count(client)) + jobs.length > 100)
        throw new BadRequestException(
          'Fila de legendas cheia. Aguarde antes de continuar.',
        );
      await client.query('BEGIN');
      try {
        for (const job of jobs) await this.repository.insert(job, client);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    });
    void this.drain();
    return this.list(id);
  }
  async settings(id: string, input: unknown) {
    const parsed = z
      .object({
        revision: z.number().int().nonnegative(),
        settings: SubtitleSettingsSchema,
      })
      .strict()
      .safeParse(input);
    if (!parsed.success)
      throw new BadRequestException('Configurações de legenda inválidas.');
    await this.projects.locked(id, async (p, c) => {
      if (p.revision !== parsed.data.revision)
        throw new ConflictException(
          'Projeto alterado. Atualize para continuar.',
        );
      const state = await this.repository.state(id, c);
      await c.query('BEGIN');
      try {
        await this.repository.saveState(
          id,
          { ...state, settings: parsed.data.settings },
          c,
        );
        await this.projects.save(p, c);
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    });
    return this.list(id);
  }
  async select(id: string, sceneId: string, versionId: string, input: unknown) {
    const parsed = z
      .object({
        revision: z.number().int().nonnegative(),
        confirmReview: z.boolean().optional(),
      })
      .strict()
      .safeParse(input);
    if (!parsed.success)
      throw new BadRequestException('Informe a revisão do projeto.');
    await this.projects.locked(id, async (p, c) => {
      if (p.revision !== parsed.data.revision)
        throw new ConflictException(
          'Projeto alterado. Atualize para continuar.',
        );
      const scene = p.scenes.find((s) => s.id === sceneId),
        v = (await this.repository.list(id, c)).find(
          (v) =>
            v.id === versionId && v.sceneId === sceneId && v.status === 'READY',
        );
      if (!scene || !v)
        throw new NotFoundException('Versão de legendas não encontrada.');
      if (
        !(await this.narration.selections(id, c)).some(
          (a) => a.sceneId === sceneId && a.assetId === v.audioAssetId,
        )
      )
        throw new BadRequestException(
          'Estas legendas pertencem a outra versão da narração.',
        );
      if (
        (v.data.reviewRequired ||
          v.data.referenceHash !== narrationTextHash(scene.narration)) &&
        !parsed.data.confirmReview
      )
        throw new ConflictException(
          'Revise o texto transcrito e confirme as legendas.',
        );
      const copy = {
        ...v,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        data: {
          ...v.data,
          referenceHash: narrationTextHash(scene.narration),
          referenceText: scene.narration,
          reviewRequired: false,
        },
      };
      const state = await this.repository.state(id, c);
      state.selections[sceneId] = copy.id;
      await c.query('BEGIN');
      try {
        await this.repository.insert(copy, c);
        await this.repository.saveState(id, state, c);
        await this.projects.save(p, c);
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    });
    return this.list(id);
  }
  async edit(id: string, sceneId: string, versionId: string, input: unknown) {
    const parsed = z
      .object({
        revision: z.number().int().nonnegative(),
        segments: z.array(SubtitleSegmentSchema).min(1).max(2000),
      })
      .strict()
      .safeParse(input);
    if (!parsed.success)
      throw new BadRequestException('Segmentos de legenda inválidos.');
    await this.projects.locked(id, async (p, c) => {
      if (p.revision !== parsed.data.revision)
        throw new ConflictException(
          'Projeto alterado. Atualize para continuar.',
        );
      const v = (await this.repository.list(id, c)).find(
          (v) =>
            v.id === versionId && v.sceneId === sceneId && v.status === 'READY',
        ),
        scene = p.scenes.find((s) => s.id === sceneId);
      if (!v || !scene)
        throw new NotFoundException('Legendas não encontradas.');
      if (
        !(await this.narration.selections(id, c)).some(
          (a) => a.sceneId === sceneId && a.assetId === v.audioAssetId,
        )
      )
        throw new BadRequestException(
          'Selecione o áudio correspondente antes de editar.',
        );
      // Edited text/times no longer carry trustworthy word alignment.
      const segments: SubtitleSegment[] = parsed.data.segments.map((s) => ({
        id: s.id,
        order: s.order,
        text: s.text,
        startSeconds: s.startSeconds,
        endSeconds: s.endSeconds,
      }));
      try {
        validateSegments(segments, v.data.audioDurationSeconds);
        const state = await this.repository.state(id, c);
        for (const s of segments) wrapSubtitle(s.text, state.settings);
      } catch (e) {
        throw new BadRequestException(
          e instanceof Error ? e.message : 'Timestamps inválidos.',
        );
      }
      const copy: SubtitleVersion = {
        ...v,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        data: {
          ...v.data,
          segments,
          words: undefined,
          granularity: 'SEGMENT',
          edited: true,
          reviewRequired: false,
          referenceHash: narrationTextHash(scene.narration),
          referenceText: scene.narration,
        },
      };
      const state = await this.repository.state(id, c);
      state.selections[sceneId] = copy.id;
      await c.query('BEGIN');
      try {
        await this.repository.insert(copy, c);
        await this.repository.saveState(id, state, c);
        await this.projects.save(p, c);
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    });
    return this.list(id);
  }
  async srt(id: string) {
    const p = await this.projects.get(id),
      assets = await this.assets.list(id),
      visuals = await this.assets.selections(id),
      audio = await this.narration.selections(id);
    const timeline = this.timeline.build(p, assets, visuals, audio);
    if (timeline.snapshot.scenes.length !== p.scenes.length)
      throw new BadRequestException(
        'Selecione imagem e narração em todas as cenas para exportar a timeline.',
      );
    const state = await this.repository.state(id);
    const built = subtitleSnapshot(
      timeline.snapshot,
      p,
      { ...state, settings: { ...state.settings, enabled: true } },
      await this.repository.list(id),
    );
    if (built.issues.length)
      throw new BadRequestException({
        message: 'Revise as legendas antes de exportar.',
        issues: built.issues,
      });
    return exportSrt(built.snapshot);
  }
  private async drain() {
    if (this.draining || this.stopped) return;
    this.draining = true;
    this.work = this.processQueue();
    try {
      await this.work;
    } catch (e) {
      this.logger.error(
        e instanceof Error ? e.message : 'Falha na fila de legendas.',
      );
    } finally {
      this.draining = false;
    }
  }
  private async processQueue() {
    // A single persisted worker, no automatic paid retries, and a one-second gap.
    while (!this.stopped) {
      const v = await this.repository.claim();
      if (!v) return;
      let pauseMs = this.requestIntervalMs;
      try {
        const asset = await this.assets.get(v.projectId, v.audioAssetId);
        if (
          asset.sceneId !== v.sceneId ||
          asset.type !== 'AUDIO' ||
          asset.status !== 'READY' ||
          !asset.storageKey
        )
          throw new BadRequestException('Narração indisponível.');
        const size = await this.storage.stat!(asset.storageKey);
        if (size.size > 20 * 1024 * 1024)
          throw new BadRequestException('Áudio acima do limite.');
        const result = await this.provider.align({
          audioAssetId: asset.id,
          audio: await this.storage.read(asset.storageKey),
          filename:
            asset.mimeType === 'audio/mpeg' ? 'narration.mp3' : 'narration.wav',
          language: v.data.language || undefined,
          durationSeconds: v.data.audioDurationSeconds,
        });
        const alignment = prepareAlignment(
          result,
          v.data.settings,
          v.data.audioDurationSeconds,
        );
        const score = matchText(
          v.data.referenceText.slice(0, 20000),
          result.text.slice(0, 20000),
        );
        v.status = 'READY';
        v.data = {
          ...v.data,
          ...alignment,
          provider: result.provider,
          model: result.model,
          transcript: result.text,
          matchScore: score,
          reviewRequired:
            score === null || score < 0.85 || !!alignment.alignmentNote,
        };
        await this.projects
          .locked(v.projectId, async (p, c) => {
            const audio = await this.narration.selections(p.id, c),
              scene = p.scenes.find((s) => s.id === v.sceneId);
            const state = await this.repository.state(p.id, c);
            const canSelect =
              scene &&
              state.selections[v.sceneId] === v.data.selectedVersionAtRequest &&
              !v.data.reviewRequired &&
              narrationTextHash(scene.narration) === v.data.referenceHash &&
              audio.some(
                (a) => a.sceneId === v.sceneId && a.assetId === v.audioAssetId,
              );
            await c.query('BEGIN');
            try {
              await this.repository.update(v, c);
              if (canSelect) {
                state.selections[v.sceneId] = v.id;
                await this.repository.saveState(p.id, state, c);
                await this.projects.save(p, c);
              }
              await c.query('COMMIT');
            } catch (e) {
              await c.query('ROLLBACK');
              throw e;
            }
          })
          .catch(async () => {
            await this.repository.update(v);
            this.logger.warn(
              'Legendas prontas; selecione a versão após atualizar o projeto.',
            );
          });
      } catch (e) {
        if (e instanceof SpeechAlignmentRateLimitError)
          pauseMs = Math.max(pauseMs, e.retryAfterMs);
        v.status = 'FAILED';
        v.error =
          e instanceof BadRequestException
            ? e.message
            : 'Não foi possível transcrever a narração. Verifique a API e tente novamente.';
        this.logger.warn(
          e instanceof Error ? e.message : 'Falha de transcrição.',
        );
        await this.repository.update(v);
      }
      // Sleep in short increments so shutdown releases the worker promptly.
      const until = Date.now() + pauseMs;
      while (!this.stopped && Date.now() < until)
        await new Promise<void>((r) =>
          setTimeout(r, Math.min(250, until - Date.now())),
        );
    }
  }
  private get requestIntervalMs() {
    return Number(
      this.config?.get<string>('SUBTITLE_REQUEST_INTERVAL_MS') ?? 1000,
    );
  }
}
