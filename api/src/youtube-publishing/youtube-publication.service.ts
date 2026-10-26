import {
  Injectable,
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { YoutubePublishingSettings } from './youtube-settings';
import { YoutubePublishingRepository } from './youtube.repository';
import { YoutubeOAuthService } from './youtube-oauth.service';
import { YoutubeUploadService, remoteStatus } from './youtube-upload.service';
import { YoutubeApiError } from './youtube-http';
import {
  createPublication,
  publicPublication,
  publicChannel,
  automationSchema,
  uploadOptions,
  YoutubePublicationRow,
} from './youtube.schema';
import { PublicationService } from '../content-publication/publication.service';
import { PublicationRepository } from '../content-publication/publication.repository';
import { PublicationThumbnailService } from '../content-publication/publication-thumbnail.service';
import { RenderRepository } from '../video-render/render.repository';
import { VideoRenderService } from '../video-render/video-render.service';
import { ContentAssetRepository } from '../content-assets/content-asset.repository';
import { StorageProvider } from '../content-assets/storage.provider';
import { composedDescription } from '../content-publication/publication.schema';
// Reuse the immutable render and its codec validation; preflight reads only a bounded MP4 header.
@Injectable()
export class YoutubePublicationService {
  constructor(
    readonly settings: YoutubePublishingSettings,
    readonly repo: YoutubePublishingRepository,
    readonly oauth: YoutubeOAuthService,
    readonly upload: YoutubeUploadService,
    readonly preparations: PublicationService,
    readonly preparationRepo: PublicationRepository,
    readonly thumbs: PublicationThumbnailService,
    readonly renders: RenderRepository,
    readonly videos: VideoRenderService,
    readonly assets: ContentAssetRepository,
    readonly storage: StorageProvider,
  ) {}
  async configuration() {
    return {
      configured: this.settings.configured,
      uploadsEnabled: this.settings.uploads,
      publicPublicationEnabled: this.settings.publicPublication,
      scopes: ['youtube.upload', 'youtube.readonly'],
      channels: (await this.repo.channels(this.settings.owner)).map(
        publicChannel,
      ),
    };
  }
  private policy(options: { privacy: string; scheduledAt: string | null }) {
    if (
      (options.privacy !== 'private' || options.scheduledAt) &&
      !this.settings.publicPublication
    )
      throw new BadRequestException(
        'Envio não privado e agendamento estão desabilitados no servidor.',
      );
  }
  async validate(input: unknown) {
    const parsed = createPublication.safeParse(input);
    if (!parsed.success)
      throw new BadRequestException(
        'Revise canal, revisão, privacidade, declarações e agendamento.',
      );
    const req = parsed.data;
    this.policy(req.options);
    await this.repo.project(this.settings.owner, req.projectId);
    const channel = await this.repo.channel(
      this.settings.owner,
      req.connectionId,
    );
    if (channel.status !== 'CONNECTED')
      throw new BadRequestException(
        'Conecte o canal antes de preparar o envio.',
      );
    const state = await this.preparationRepo.get(
      req.projectId,
      undefined,
      req.target,
    );
    if (state.revision !== req.preparationRevision)
      throw new ConflictException(
        'Preparação alterada. Reabra e revise antes de enviar.',
      );
    const check = await this.preparations.checklist(
      req.projectId,
      state.data,
      req.target,
    );
    if (state.data.status !== 'READY' || !check.ready)
      throw new BadRequestException({
        message: 'Salve a preparação como pronta antes de enviar.',
        issues: check.errors,
      });
    if (
      state.data.metadataRenderJobId &&
      state.data.metadataRenderJobId !== state.data.renderJobId
    )
      throw new BadRequestException(
        'Revise os metadados para o vídeo selecionado antes de enviar.',
      );
    const render = await this.renders.get(
      req.projectId,
      state.data.renderJobId!,
    );
    if (
      render.status !== 'COMPLETED' ||
      render.snapshot.preview ||
      !render.outputAssetId
    )
      throw new BadRequestException('Selecione um RenderJob final concluído.');
    const media = await this.videos.media(req.projectId, render.id);
    const asset = await this.assets.get(req.projectId, render.outputAssetId);
    if (
      asset.type !== 'VIDEO' ||
      asset.mimeType !== 'video/mp4' ||
      !asset.storageKey ||
      media.size <= 0 ||
      media.size > Math.min(256 * 1024 ** 3, 2 * 1024 ** 3)
    )
      throw new BadRequestException(
        'MP4 indisponível ou acima do limite local de 2 GiB.',
      );
    // Bounded signature validation; the original render passed actual ffprobe during finalization.
    const head = media.open(0, 31);
    const buffers: Buffer[] = [];
    try {
      for await (const part of head as Readable)
        buffers.push(Buffer.from(part as Uint8Array));
    } finally {
      head.destroy();
    }
    if (!Buffer.concat(buffers).subarray(4, 8).equals(Buffer.from('ftyp')))
      throw new BadRequestException(
        'O arquivo selecionado não é um MP4 válido.',
      );
    if (
      render.snapshot.config.codec !== 'libx264' ||
      render.snapshot.config.audioCodec !== 'aac' ||
      asset.metadata.codec !== 'h264' ||
      asset.metadata.audioCodec !== 'aac'
    )
      throw new BadRequestException(
        'O vídeo deve ter sido validado como H.264/AAC pelo renderizador.',
      );
    const { width, height, fps } = render.snapshot.config;
    if (
      !(width * 9 === height * 16 || width * 16 === height * 9) ||
      !Number.isFinite(render.snapshot.totalDurationSeconds) ||
      render.snapshot.totalDurationSeconds <= 0
    )
      throw new BadRequestException('Dimensões ou duração do vídeo inválidas.');
    if (
      req.target === 'YOUTUBE_SHORTS' &&
      (height <= width || render.snapshot.totalDurationSeconds > 180)
    )
      throw new BadRequestException(
        'Shorts exige versão vertical de até 180 segundos; a classificação final depende do YouTube.',
      );
    const thumb = state.data.selectedThumbnailId
      ? await this.repo.db.query<{ storage_key: string }>(
          'SELECT a.storage_key FROM content_publication_thumbnails t JOIN content_assets a ON a.id=t.asset_id AND a.project_id=t.project_id WHERE t.project_id=$1 AND t.id=$2',
          [req.projectId, state.data.selectedThumbnailId],
        )
      : null;
    if (req.target !== 'YOUTUBE_SHORTS' && state.data.selectedThumbnailId)
      await this.thumbs.file(req.projectId, state.data.selectedThumbnailId);
    const snapshot = {
      preparationRevision: state.revision,
      title: state.data.titles.find((t) => t.id === state.data.selectedTitleId)!
        .text,
      description: composedDescription(state.data),
      tags: state.data.tags,
      language: state.data.language,
      thumbnailId: state.data.selectedThumbnailId,
      thumbnailKey: thumb?.rows[0]?.storage_key ?? null,
      videoKey: asset.storageKey,
      bytes: media.size,
      width,
      height,
      fps,
      durationSeconds: render.snapshot.totalDurationSeconds,
      channelId: channel.channel_id,
      channelTitle: channel.title,
      options: {
        ...req.options,
        scheduledAt: req.options.scheduledAt
          ? new Date(req.options.scheduledAt).toISOString()
          : null,
      },
    };
    return {
      req,
      render,
      channel,
      snapshot,
      warnings: [
        ...check.warnings,
        ...(req.target === 'YOUTUBE_SHORTS'
          ? [
              'A capa de Shorts deve ser selecionada no YouTube Studio; não será enviada pela API.',
            ]
          : []),
      ],
    };
  }
  async create(input: unknown) {
    const result = await this.validate(input);
    const { req, render, snapshot } = result;
    const row = await this.repo.insert(
      this.settings.owner,
      req.projectId,
      render.id,
      req.connectionId,
      req.target,
      req.idempotencyKey,
      snapshot,
    );
    await this.repo.event(
      this.settings.owner,
      'PUBLICATION_CREATE',
      'DRAFT',
      row.id,
    );
    return publicPublication(row);
  }
  async queue(id: string) {
    if (!this.settings.configured || !this.settings.uploads)
      throw new ServiceUnavailableException(
        'Configure o OAuth e habilite YOUTUBE_UPLOADS_ENABLED no servidor.',
      );
    return this.repo.locked('publication', id, async () => {
      const row = await this.repo.publication(this.settings.owner, id);
      if (
        row.status === 'QUEUED' ||
        row.status === 'UPLOADING' ||
        row.youtube_video_id
      )
        return publicPublication(row);
      if (row.status !== 'DRAFT')
        throw new ConflictException(
          'Esta operação não pode ser iniciada como um novo upload. Use retomada ou reconciliação.',
        );
      this.policy(row.snapshot.options);
      const connection = await this.repo.channel(
        this.settings.owner,
        row.connection_id,
      );
      if (connection.status !== 'CONNECTED')
        throw new BadRequestException('Reconecte o canal.');
      await this.file(row);
      await this.repo.update(id, {
        status: 'QUEUED',
        next_attempt_at: new Date(),
        error_code: null,
        error_message: null,
      });
      await this.repo.event(
        this.settings.owner,
        'UPLOAD_CONFIRM',
        'QUEUED',
        id,
      );
      return publicPublication(
        await this.repo.publication(this.settings.owner, id),
      );
    });
  }
  async file(row: YoutubePublicationRow) {
    await this.repo.project(this.settings.owner, row.project_id);
    const media = await this.videos.media(row.project_id, row.render_job_id);
    const render = await this.renders.get(row.project_id, row.render_job_id);
    if (
      render.snapshot.preview ||
      render.status !== 'COMPLETED' ||
      media.size !== row.snapshot.bytes
    )
      throw new BadRequestException(
        'Arquivo original indisponível ou alterado.',
      );
    if (
      !this.storage.stat ||
      !this.storage.openRead ||
      (await this.storage.stat(row.snapshot.videoKey)).size !==
        row.snapshot.bytes
    )
      throw new BadRequestException('Arquivo original indisponível.');
    return media;
  }
  async retry(id: string) {
    return this.repo.locked('publication', id, async () => {
      const row = await this.repo.publication(this.settings.owner, id);
      if (row.cancel_requested)
        throw new BadRequestException(
          'Operação cancelada. Faça a conferência remota.',
        );
      if (row.youtube_video_id) {
        await this.reconcileUnlocked(row);
        return publicPublication(
          await this.repo.publication(this.settings.owner, id),
        );
      }
      if (!this.settings.uploads)
        throw new BadRequestException('Uploads desabilitados.');
      if (
        !['FAILED', 'NEEDS_ATTENTION'].includes(row.status) ||
        (!row.session_cipher && row.session_started)
      )
        throw new BadRequestException(
          'Não há uma sessão retomável segura. Confira o YouTube Studio e reconcilie o resultado remoto.',
        );
      if (row.error_code === 'SESSION_EXPIRED')
        throw new BadRequestException(
          'Sessão expirada. Não será criado outro upload automaticamente.',
        );
      this.policy(row.snapshot.options);
      await this.repo.update(id, {
        status: 'QUEUED',
        attempts: 0,
        error_code: null,
        error_message: null,
        next_attempt_at: new Date(),
      });
      await this.repo.event(this.settings.owner, 'UPLOAD_RESUME', 'QUEUED', id);
      return publicPublication(
        await this.repo.publication(this.settings.owner, id),
      );
    });
  }
  async reconcileUnlocked(row: YoutubePublicationRow) {
    if (!row.youtube_video_id)
      throw new BadRequestException(
        'Não há identificador remoto confirmado. Informe o ID após conferir o YouTube Studio.',
      );
    const token = await this.oauth.token(row.connection_id);
    const video = await this.upload.video(token, row.youtube_video_id);
    if (video.snippet?.channelId !== row.snapshot.channelId)
      throw new YoutubeApiError('CHANNEL');
    const status = remoteStatus(video);
    await this.repo.update(row.id, {
      status,
      remote_privacy: video.status?.privacyStatus,
      remote_publish_at: video.status?.publishAt ?? null,
      last_checked_at: new Date(),
      next_attempt_at: new Date(
        Date.now() +
          (status === 'PROCESSING'
            ? 30000
            : status === 'SCHEDULED'
              ? 300000
              : 21600000),
      ),
      error_code: status === 'FAILED' ? 'PROCESSING' : null,
      error_message:
        status === 'FAILED'
          ? 'O YouTube informou falha ou rejeição do processamento.'
          : null,
    });
    await this.repo.event(this.settings.owner, 'REMOTE_STATUS', status, row.id);
  }
  async reconcile(id: string, remoteId?: string) {
    return this.repo.locked('publication', id, async () => {
      let row = await this.repo.publication(this.settings.owner, id);
      if (
        !remoteId &&
        row.last_checked_at &&
        Date.now() - row.last_checked_at.getTime() < 15000
      )
        return publicPublication(row);
      if (remoteId) {
        if (row.youtube_video_id && row.youtube_video_id !== remoteId)
          throw new BadRequestException(
            'O identificador remoto já foi confirmado.',
          );
        const token = await this.oauth.token(row.connection_id);
        const video = await this.upload.video(token, remoteId);
        if (video.snippet?.channelId !== row.snapshot.channelId)
          throw new YoutubeApiError('CHANNEL');
        await this.repo.update(id, { youtube_video_id: video.id });
        row = await this.repo.publication(this.settings.owner, id);
      }
      await this.reconcileUnlocked(row);
      return publicPublication(
        await this.repo.publication(this.settings.owner, id),
      );
    });
  }
  async thumbnail(row: YoutubePublicationRow) {
    if (row.target === 'YOUTUBE_SHORTS')
      throw new BadRequestException(
        'Capa de Shorts: selecione no YouTube Studio.',
      );
    if (!row.youtube_video_id || !row.snapshot.thumbnailId)
      throw new BadRequestException('Vídeo ou thumbnail não disponível.');
    if (!this.settings.uploads)
      throw new BadRequestException('Uploads desabilitados no servidor.');
    try {
      const token = await this.oauth.token(row.connection_id);
      const remote = await this.upload.video(token, row.youtube_video_id);
      if (remote.snippet?.channelId !== row.snapshot.channelId)
        throw new YoutubeApiError('CHANNEL');
      const buffer = await this.thumbs.file(
        row.project_id,
        row.snapshot.thumbnailId,
      );
      await this.upload.thumbnail(token, row.youtube_video_id, buffer);
      await this.repo.update(row.id, { thumbnail_status: 'COMPLETED' });
      await this.repo.event(this.settings.owner, 'THUMBNAIL', 'OK', row.id);
    } catch (e) {
      await this.repo.update(row.id, { thumbnail_status: 'FAILED' });
      await this.repo.event(
        this.settings.owner,
        'THUMBNAIL',
        'FAILED',
        row.id,
        e instanceof YoutubeApiError ? e.code : 'UNKNOWN',
      );
      throw e;
    }
  }
  async retryThumbnail(id: string) {
    return this.repo.locked('publication', id, async () => {
      const row = await this.repo.publication(this.settings.owner, id);
      await this.thumbnail(row);
      return publicPublication(
        await this.repo.publication(this.settings.owner, id),
      );
    });
  }
  async saveAutomation(project: string, input: unknown) {
    const parsed = automationSchema.safeParse(input);
    if (!parsed.success)
      throw new BadRequestException('Revise a regra e confirme sua ativação.');
    await this.repo.project(this.settings.owner, project);
    const channel = await this.repo.channel(
      this.settings.owner,
      parsed.data.connectionId,
    );
    if (parsed.data.enabled && channel.status !== 'CONNECTED')
      throw new BadRequestException(
        'Conecte o canal antes de ativar a automação.',
      );
    if (
      parsed.data.enabled &&
      parsed.data.mode !== 'DRAFT' &&
      !this.settings.uploads
    )
      throw new BadRequestException(
        'Habilite uploads no servidor antes de ativar esta automação.',
      );
    if (
      parsed.data.enabled &&
      parsed.data.mode === 'SCHEDULE' &&
      !this.settings.publicPublication
    )
      throw new BadRequestException('Agendamento desabilitado no servidor.');
    if (
      !uploadOptions.safeParse({
        privacy: 'private',
        madeForKids: parsed.data.madeForKids,
        containsSyntheticMedia: parsed.data.containsSyntheticMedia,
        timeZone: parsed.data.timeZone,
      }).success
    )
      throw new BadRequestException('Fuso horário inválido.');
    await this.repo.saveRule(this.settings.owner, project, parsed.data);
    await this.repo.event(
      this.settings.owner,
      'AUTOMATION_SETTINGS',
      parsed.data.enabled ? 'ENABLED' : 'DISABLED',
    );
    return parsed.data;
  }
  async automate() {
    for (const rule of await this.repo.rules(this.settings.owner)) {
      try {
        await this.repo.locked(
          'publication',
          `automation:${rule.project_id}`,
          async () => {
            const count = await this.repo.db.query<{ count: string }>(
              'SELECT count(*) FROM youtube_publications WHERE owner_id=$1 AND project_id=$2',
              [this.settings.owner, rule.project_id],
            );
            if (Number(count.rows[0].count) >= rule.settings.maxPublications)
              return;
            const prep = await this.preparationRepo.get(
              rule.project_id,
              undefined,
              rule.settings.target,
            );
            if (prep.data.status !== 'READY' || !prep.data.renderJobId) return;
            const existing = await this.repo.db.query(
              'SELECT 1 FROM youtube_publications WHERE owner_id=$1 AND project_id=$2 AND connection_id=$3 AND render_job_id=$4',
              [
                this.settings.owner,
                rule.project_id,
                rule.settings.connectionId,
                prep.data.renderJobId,
              ],
            );
            if (existing.rowCount) return;
            const keyBytes = createHash('sha256')
              .update(
                `${rule.project_id}:${rule.settings.connectionId}:${prep.data.renderJobId}:${rule.settings.target}`,
              )
              .digest('hex');
            const deterministic = `${keyBytes.slice(0, 8)}-${keyBytes.slice(8, 12)}-4${keyBytes.slice(13, 16)}-a${keyBytes.slice(17, 20)}-${keyBytes.slice(20, 32)}`;
            const result = await this.create({
              projectId: rule.project_id,
              target: rule.settings.target,
              preparationRevision: prep.revision,
              connectionId: rule.settings.connectionId,
              idempotencyKey: deterministic,
              confirm: true,
              options: {
                privacy: 'private',
                madeForKids: rule.settings.madeForKids,
                containsSyntheticMedia: rule.settings.containsSyntheticMedia,
                categoryId: rule.settings.categoryId,
                timeZone: rule.settings.timeZone,
                scheduledAt:
                  rule.settings.mode === 'SCHEDULE'
                    ? new Date(
                        Date.now() + rule.settings.delayHours * 3600000,
                      ).toISOString()
                    : null,
              },
            });
            if (rule.settings.mode !== 'DRAFT') await this.queue(result.id);
          },
        );
      } catch (e) {
        await this.repo.event(
          this.settings.owner,
          'AUTOMATION',
          'FAILED',
          undefined,
          e instanceof YoutubeApiError ? e.code : 'VALIDATION',
        );
      }
    }
  }
}
