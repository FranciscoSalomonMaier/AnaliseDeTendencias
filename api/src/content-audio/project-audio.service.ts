import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { PoolClient } from 'pg';
import type { ContentProject } from '../content-projects/content-project.schema';
import { ContentProjectRepository } from '../content-projects/content-project.repository';
import { ContentAssetRepository } from '../content-assets/content-asset.repository';
import { StorageProvider } from '../content-assets/storage.provider';
import {
  AudioFileValidator,
  AudioUpload,
} from '../content-narration/audio-file.validator';
import { NarrationRepository } from '../content-narration/narration.repository';
import { TimelineBuilder } from '../video-render/timeline.builder';
import { MediaProcess, RenderFailure } from '../video-render/media-process';
import { RenderSettings } from '../video-render/render-settings';
import { FfmpegRenderer } from '../video-render/ffmpeg.renderer';
import { ProjectAudioRepository } from './project-audio.repository';
import { AudioTimelineBuilder } from './audio-timeline.builder';
import {
  audioRole,
  AudioRole,
  projectAudioSchema,
} from './project-audio.schema';
@Injectable()
export class ProjectAudioService {
  private readonly logger = new Logger(ProjectAudioService.name);
  constructor(
    private readonly projects: ContentProjectRepository,
    private readonly assets: ContentAssetRepository,
    private readonly repository: ProjectAudioRepository,
    private readonly narration: NarrationRepository,
    private readonly timeline: TimelineBuilder,
    private readonly audioTimeline: AudioTimelineBuilder,
    private readonly validator: AudioFileValidator,
    private readonly storage: StorageProvider,
    private readonly process: MediaProcess,
    private readonly renderSettings: RenderSettings,
    private readonly renderer: FfmpegRenderer,
  ) {}
  private revision(p: ContentProject, revision: number) {
    if (p.revision !== revision)
      throw new ConflictException(
        'Projeto alterado em outra janela. Reabra para continuar.',
      );
  }
  private async state(p: ContentProject, client?: PoolClient) {
    const settings = await this.repository.get(p.id, client);
    const all = await this.assets.list(p.id, client);
    return {
      project: p,
      settings,
      assets: all.filter(
        (a) =>
          a.type === 'AUDIO' &&
          ['BACKGROUND_MUSIC', 'SOUND_EFFECT'].includes(String(audioRole(a))),
      ),
      limits: {
        uploadMaxBytes: 20 * 1024 * 1024,
        maxDurationSeconds: 600,
        maxEffects: 32,
        maxEffectsPerScene: 8,
        musicMaxVolume: 0.5,
      },
    };
  }
  async get(id: string) {
    return this.state(await this.projects.get(id));
  }
  async media(id: string, assetId: string) {
    await this.projects.get(id);
    const asset = await this.assets.get(id, assetId);
    if (
      asset.type !== 'AUDIO' ||
      !['BACKGROUND_MUSIC', 'SOUND_EFFECT'].includes(audioRole(asset)) ||
      asset.status !== 'READY' ||
      !asset.storageKey ||
      !this.storage.stat ||
      !this.storage.openRead
    )
      throw new NotFoundException('Áudio de música/efeito indisponível.');
    try {
      const info = await this.storage.stat(asset.storageKey);
      return {
        size: info.size,
        mimeType: asset.mimeType!,
        open: (start?: number, end?: number) =>
          this.storage.openRead!(asset.storageKey!, start, end),
      };
    } catch {
      throw new NotFoundException('Arquivo de música/efeito indisponível.');
    }
  }
  async save(id: string, input: unknown) {
    const parsed = z
      .object({
        revision: z.number().int().nonnegative(),
        settings: projectAudioSchema,
      })
      .strict()
      .safeParse(input);
    if (!parsed.success)
      throw new BadRequestException(
        'Configurações inválidas. Música: 0–50%; efeitos: 0–100%; fades: 0–30 s; até 32 efeitos (8 por cena).',
      );
    return this.projects.locked(id, async (p, client) => {
      this.revision(p, parsed.data.revision);
      const assets = await this.assets.list(id, client),
        visuals = await this.assets.selections(id, client),
        narration = await this.narration.selections(id, client);
      const { snapshot } = this.timeline.build(p, assets, visuals, narration);
      const { issues } = this.audioTimeline.build(
        snapshot,
        parsed.data.settings,
        assets,
        id,
      );
      for (const effect of parsed.data.settings.effects) {
        if (!p.scenes.some((s) => s.id === effect.sceneId))
          issues.push({
            sceneId: effect.sceneId,
            order: null,
            message:
              'Efeito pertence a uma cena que não existe mais. Remova a associação.',
          });
        const a = assets.find((a) => a.id === effect.assetId);
        if (
          !a ||
          a.type !== 'AUDIO' ||
          audioRole(a) !== 'SOUND_EFFECT' ||
          a.status !== 'READY'
        )
          issues.push({
            sceneId: effect.sceneId,
            order: null,
            message: 'Efeito sonoro inválido ou de outro projeto.',
          });
      }
      if (issues.length)
        throw new BadRequestException({
          message: issues.map((i) => i.message).join(' '),
          issues,
        });
      await client.query('BEGIN');
      try {
        await this.repository.save(id, parsed.data.settings, client);
        const saved = await this.projects.save(p, client);
        await client.query('COMMIT');
        return this.state(saved, client);
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    });
  }
  async upload(
    id: string,
    role: AudioRole,
    input: unknown,
    file?: AudioUpload,
  ) {
    const parsed = z
      .object({
        revision: z.coerce.number().int().nonnegative(),
        license: z.string().trim().max(300).default(''),
        origin: z.string().trim().max(300).default('Upload do usuário'),
        notes: z.string().trim().max(1000).default(''),
      })
      .strict()
      .safeParse(input);
    if (!parsed.success || !file)
      throw new BadRequestException(
        'Envie MP3 ou WAV com revisão e metadados válidos.',
      );
    return this.projects.locked(id, async (p, client) => {
      this.revision(p, parsed.data.revision);
      const checked = await this.validator.validate(
        file.buffer,
        file.mimetype,
        file.originalname,
      );
      const assetId = randomUUID(),
        key = `content-projects/${id}/audio-library/${assetId}.${checked.extension}`;
      let stored = false,
        committed = false,
        directory: string | undefined;
      try {
        await this.storage.save(key, checked.audio);
        stored = true;
        directory = await mkdtemp(join(tmpdir(), 'trends-audio-upload-'));
        const path = join(directory, `input.${checked.extension}`);
        if (!this.storage.copyTo)
          throw new RenderFailure('Storage não suporta validação de áudio.');
        await this.storage.copyTo(key, path);
        const probe = await this.renderer.probe(path),
          stream = probe.streams?.find((s) => s.codec_type === 'audio');
        const duration = Number(stream?.duration ?? probe.format?.duration);
        if (
          !stream ||
          !Number.isFinite(duration) ||
          duration <= 0 ||
          duration > 600 ||
          Math.abs(duration - checked.durationSeconds) > 0.15
        )
          throw new BadRequestException(
            'Arquivo de áudio inválido ou duração divergente.',
          );
        await this.process.run(
          this.renderSettings.ffmpegPath,
          [
            '-hide_banner',
            '-loglevel',
            'error',
            '-nostdin',
            '-xerror',
            '-protocol_whitelist',
            'file,pipe',
            '-i',
            path,
            '-map',
            '0:a:0',
            '-f',
            'null',
            '-',
          ],
          30000,
        );
        const metadata = {
          ...checked.metadata,
          audioRole: role,
          originalName: basename(file.originalname.replaceAll('\\', '/')).slice(
            0,
            255,
          ),
          bytes: file.buffer.length,
          license: parsed.data.license,
          origin: parsed.data.origin,
          notes: parsed.data.notes,
        };
        await client.query(
          "INSERT INTO content_assets(id,project_id,type,source,status,usage,storage_key,mime_type,duration_seconds,metadata) VALUES($1,$2,'AUDIO','USER_UPLOAD','READY','OPTIONAL',$3,$4,$5,$6::jsonb)",
          [
            assetId,
            id,
            key,
            checked.mimeType,
            checked.durationSeconds,
            JSON.stringify(metadata),
          ],
        );
        committed = true;
        return this.state(p, client);
      } catch (error) {
        if (stored && !committed)
          await this.storage.delete(key).catch(() => undefined);
        if (error instanceof HttpException) throw error;
        this.logger.error(
          `Audio upload ${id}/${assetId}: ${error instanceof Error ? error.message : 'falha desconhecida'}`,
        );
        if (error instanceof RenderFailure)
          throw new BadRequestException(error.publicMessage);
        throw new BadRequestException(
          'Não foi possível validar ou armazenar o áudio. Tente novamente.',
        );
      } finally {
        if (directory) await rm(directory, { recursive: true, force: true });
      }
    });
  }
}
