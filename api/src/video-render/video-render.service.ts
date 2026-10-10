import { ProjectAudioRepository } from '../content-audio/project-audio.repository';
import { AudioTimelineBuilder } from '../content-audio/audio-timeline.builder';
import {
  Injectable,
  Optional,
  BadRequestException,
  ConflictException,
  NotFoundException,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ContentProjectRepository } from '../content-projects/content-project.repository';
import { ContentAssetRepository } from '../content-assets/content-asset.repository';
import { NarrationRepository } from '../content-narration/narration.repository';
import { StorageProvider } from '../content-assets/storage.provider';
import { RenderRepository, ACTIVE_RENDER_STATUSES } from './render.repository';
import { TimelineBuilder } from './timeline.builder';
import { RenderSettings } from './render-settings';
import { FfmpegRenderer } from './ffmpeg.renderer';
import { RenderFailure, RenderCancelled } from './media-process';
import type { RenderJob } from './render-job';
@Injectable()
export class VideoRenderService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(VideoRenderService.name);
  private timer?: NodeJS.Timeout;
  private draining = false;
  private stopped = false;
  private running = new Map<
    string,
    { controller: AbortController; work: Promise<void> }
  >();
  constructor(
    private readonly projects: ContentProjectRepository,
    private readonly assets: ContentAssetRepository,
    private readonly narration: NarrationRepository,
    private readonly repository: RenderRepository,
    private readonly timeline: TimelineBuilder,
    private readonly renderer: FfmpegRenderer,
    private readonly storage: StorageProvider,
    private readonly settings: RenderSettings,
    @Optional() private readonly projectAudio?: ProjectAudioRepository,
  ) {}
  async onApplicationBootstrap() {
    this.stopped = false;
    await this.repository.startWorker();
    await this.renderer.cleanupInterrupted();
    this.timer = setInterval(() => void this.drain(), 1000);
    this.timer.unref();
    void this.drain();
  }
  async onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    for (const r of this.running.values()) r.controller.abort();
    while (this.draining) await new Promise<void>((r) => setTimeout(r, 10));
    await Promise.allSettled([...this.running.values()].map((r) => r.work));
    await this.repository.stopWorker();
  }
  private async build(id: string, client?: import('pg').PoolClient) {
    const project = await this.projects.get(id, client);
    const assets = await this.assets.list(id, client);
    const visuals = await this.assets.selections(id, client);
    const audio = await this.narration.selections(id, client);
    const result = this.timeline.build(project, assets, visuals, audio);
    if (this.projectAudio) {
      const settings = await this.projectAudio.get(id, client);
      const mix = new AudioTimelineBuilder().build(
        result.snapshot,
        settings,
        assets,
        id,
      );
      result.snapshot.audioMix = mix.mix;
      result.issues.push(...mix.issues);
    }
    return { ...result, project };
  }
  async preview(id: string) {
    const { snapshot, issues } = await this.build(id);
    const physical = await this.renderer.physical(snapshot);
    return {
      timeline: snapshot,
      issues: [...issues, ...physical],
      ready: issues.length + physical.length === 0,
    };
  }
  async list(id: string) {
    await this.projects.get(id);
    return {
      jobs: await this.repository.list(id),
      config: this.settings.config,
    };
  }
  async get(id: string, jobId: string) {
    await this.projects.get(id);
    return this.repository.get(id, jobId);
  }
  async create(id: string, input: unknown) {
    const parsed = z
      .object({ revision: z.number().int().nonnegative() })
      .strict()
      .safeParse(input);
    if (!parsed.success)
      throw new BadRequestException('Informe a revisão atual do projeto.');
    const job = await this.projects.locked(id, async (p, client) => {
      if (p.revision !== parsed.data.revision)
        throw new ConflictException(
          'Projeto alterado em outra janela. Reabra para continuar.',
        );
      if (
        (await this.repository.list(id, client)).some((j) =>
          ACTIVE_RENDER_STATUSES.includes(j.status),
        )
      )
        throw new ConflictException(
          'Já existe uma renderização em andamento neste projeto.',
        );
      const { snapshot, issues } = await this.build(id, client);
      issues.push(...(await this.renderer.physical(snapshot)));
      if (issues.length)
        throw new BadRequestException({
          message: 'Não é possível gerar o vídeo. Revise as cenas pendentes.',
          issues,
        });
      try {
        await this.renderer.available();
      } catch (error) {
        if (error instanceof RenderFailure)
          throw new BadRequestException(error.publicMessage);
        throw error;
      }
      await client.query('BEGIN');
      try {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('content-video:capacity',0))",
        );
        if ((await this.repository.count(client)) >= this.settings.maxQueued)
          throw new ConflictException(
            'Fila de renderização cheia. Aguarde e tente novamente.',
          );
        const r = await this.repository.insert(
          randomUUID(),
          id,
          snapshot,
          client,
        );
        await client.query('COMMIT');
        return r;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    });
    void this.drain();
    return job;
  }
  async cancel(id: string, jobId: string) {
    await this.get(id, jobId);
    const job = await this.repository.cancel(id, jobId);
    this.running.get(jobId)?.controller.abort();
    return job;
  }
  async media(id: string, jobId: string) {
    const job = await this.get(id, jobId);
    if (job.status !== 'COMPLETED' || !job.outputAssetId)
      throw new NotFoundException('O vídeo ainda não está disponível.');
    const asset = await this.assets.get(id, job.outputAssetId);
    if (
      asset.type !== 'VIDEO' ||
      asset.status !== 'READY' ||
      !asset.storageKey ||
      !this.storage.stat ||
      !this.storage.openRead
    )
      throw new NotFoundException('Vídeo indisponível.');
    try {
      const info = await this.storage.stat(asset.storageKey);
      return {
        size: info.size,
        mimeType: 'video/mp4',
        assetId: asset.id,
        open: (start?: number, end?: number) =>
          this.storage.openRead!(asset.storageKey!, start, end),
      };
    } catch {
      throw new NotFoundException('Arquivo de vídeo indisponível.');
    }
  }
  async drain() {
    if (this.draining || this.stopped) return;
    this.draining = true;
    try {
      while (!this.stopped && this.running.size < this.settings.concurrency) {
        const job = await this.repository.claim();
        if (!job) break;
        if (this.stopped) {
          await this.repository.finishFailure(
            job.id,
            'FAILED',
            'Renderização interrompida pelo encerramento da API.',
          );
          break;
        }
        const controller = new AbortController();
        const work = this.run(job, controller)
          .catch(() =>
            this.logger.error('Falha ao persistir status de renderização.'),
          )
          .finally(() => {
            this.running.delete(job.id);
            void this.drain();
          });
        this.running.set(job.id, { controller, work });
      }
    } catch {
      this.logger.error('Fila de renderização temporariamente indisponível.');
    } finally {
      this.draining = false;
    }
  }
  private async run(job: RenderJob, controller: AbortController) {
    let key: string | undefined;
    // Cancellation is persisted and checked even when requested through another API instance.
    const cancellation = setInterval(() => {
      void this.repository
        .get(job.projectId, job.id)
        .then((j) => {
          if (j.cancelRequested) controller.abort();
        })
        .catch(() => undefined);
    }, 500);
    cancellation.unref();
    let last = -1,
      persist = Promise.resolve();
    try {
      await this.renderer.render(
        job,
        controller.signal,
        (status, progress) => {
          if (progress <= last) return;
          last = progress;
          persist = persist
            .then(() => this.repository.progress(job.id, status, progress))
            .catch(() =>
              this.logger.warn(
                'Progresso de vídeo temporariamente indisponível.',
              ),
            );
        },
        async (path, info) => {
          if (controller.signal.aborted) throw new RenderCancelled();
          await persist;
          const assetId = randomUUID();
          key = `content-projects/${job.projectId}/renders/${job.id}/${assetId}.mp4`;
          await this.storage.saveFile!(key, path);
          if (!(await this.repository.complete(job, assetId, key, info)))
            throw new RenderCancelled();
        },
      );
    } catch (error) {
      await persist;
      const saved = await this.repository
        .get(job.projectId, job.id)
        .catch(() => undefined);
      if (saved?.status === 'COMPLETED') return;
      if (key) await this.storage.delete(key).catch(() => undefined);
      const cancelled = error instanceof RenderCancelled && !this.stopped;
      if (!cancelled)
        this.logger.error(
          `Render ${job.id}: ${error instanceof Error ? error.message : 'falha desconhecida'}`,
        );
      const message =
        error instanceof RenderFailure
          ? error.publicMessage
          : (error as NodeJS.ErrnoException)?.code === 'ENOSPC'
            ? 'Espaço em disco insuficiente para salvar o vídeo.'
            : 'Falha ao preparar ou armazenar o vídeo. Verifique o storage e tente novamente.';
      await this.repository.finishFailure(
        job.id,
        cancelled ? 'CANCELLED' : 'FAILED',
        cancelled ? null : message,
      );
    } finally {
      clearInterval(cancellation);
    }
  }
}
