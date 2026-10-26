import {
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
  ConflictException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { YoutubePublishingSettings } from './youtube-settings';
import { YoutubePublishingRepository } from './youtube.repository';
import { YoutubePublicationService } from './youtube-publication.service';
import { YoutubeOAuthService } from './youtube-oauth.service';
import { YoutubeUploadService } from './youtube-upload.service';
import { YoutubeSecretBox } from './youtube-crypto';
import { YoutubeApiError } from './youtube-http';
import type { YoutubePublicationRow } from './youtube.schema';
@Injectable()
export class YoutubePublicationWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private running?: Promise<void>;
  private leader?: PoolClient;
  private lastAutomation = 0;
  private controller?: AbortController;
  constructor(
    readonly settings: YoutubePublishingSettings,
    readonly repo: YoutubePublishingRepository,
    readonly service: YoutubePublicationService,
    readonly oauth: YoutubeOAuthService,
    readonly uploads: YoutubeUploadService,
    readonly box: YoutubeSecretBox,
  ) {}
  async onApplicationBootstrap() {
    if (!this.settings.configured) return;
    const client = await this.repo.db.acquireClient();
    const result = await client.query<{ ok: boolean }>(
      "SELECT pg_try_advisory_lock(hashtextextended('youtube-publishing:worker',0)) ok",
    );
    if (!result.rows[0].ok) {
      client.release();
      return;
    }
    this.leader = client;
    client.on('error', () => {
      this.stopped = true;
      this.controller?.abort();
      if (this.timer) clearTimeout(this.timer);
    });
    const tick = () => {
      if (this.stopped) return;
      this.running = this.tick()
        .catch(() => undefined)
        .finally(() => {
          if (!this.stopped) this.timer = setTimeout(tick, 5000);
        });
    };
    tick();
  }
  async onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.controller?.abort();
    await this.running;
    const client = this.leader;
    this.leader = undefined;
    if (client) {
      try {
        await client.query(
          "SELECT pg_advisory_unlock(hashtextextended('youtube-publishing:worker',0))",
        );
      } finally {
        client.release();
      }
    }
  }
  async tick() {
    if (Date.now() - this.lastAutomation >= 60000) {
      this.lastAutomation = Date.now();
      await this.service.automate();
    }
    if (!this.settings.uploads) return;
    const job = await this.repo.due(this.settings.owner);
    if (!job) return;
    try {
      await this.repo.locked('publication', job.id, async () => {
        const current = await this.repo.publication(
          this.settings.owner,
          job.id,
        );
        await this.process(current);
      });
    } catch (e) {
      if (!(e instanceof ConflictException)) throw e;
    }
  }
  private async accepted(row: YoutubePublicationRow, videoId: string) {
    await this.repo.update(row.id, {
      youtube_video_id: videoId,
      confirmed_bytes: row.snapshot.bytes,
      status: 'PROCESSING',
      completed_at: new Date(),
      error_code: null,
      error_message: null,
      next_attempt_at: new Date(Date.now() + 30000),
    });
    await this.repo.event(
      this.settings.owner,
      'UPLOAD_COMPLETE',
      'RECEIVED',
      row.id,
    );
  }
  async process(row: YoutubePublicationRow) {
    if (!this.settings.uploads) return;
    this.controller = new AbortController();
    try {
      if (row.youtube_video_id) {
        await this.service.reconcileUnlocked(row);
        if (row.thumbnail_status === 'PENDING' && !row.cancel_requested) {
          try {
            await this.service.thumbnail(row);
          } catch {
            /* Partial failure is persisted; never upload the MP4 again. */
          }
        }
        return;
      }
      if (row.cancel_requested) {
        await this.repo.update(row.id, {
          status: row.session_started ? 'NEEDS_ATTENTION' : 'CANCELLED',
          error_code: row.session_started ? 'UNCERTAIN' : null,
          error_message: row.session_started
            ? 'Envio local interrompido. Confira se o vídeo chegou ao YouTube antes de continuar.'
            : null,
        });
        return;
      }
      if (
        (row.snapshot.options.privacy !== 'private' ||
          row.snapshot.options.scheduledAt) &&
        !this.settings.publicPublication
      )
        throw new YoutubeApiError('DISABLED');
      if (
        row.snapshot.options.scheduledAt &&
        Date.parse(row.snapshot.options.scheduledAt) <= Date.now() + 60000
      )
        throw new YoutubeApiError('SCHEDULE_PAST');
      const connection = await this.repo.channel(
        this.settings.owner,
        row.connection_id,
      );
      if (
        connection.status !== 'CONNECTED' ||
        connection.channel_id !== row.snapshot.channelId
      )
        throw new YoutubeApiError('AUTH');
      await this.service.file(row);
      let token = await this.oauth.token(row.connection_id);
      const identity = await this.oauth.identity(token);
      if (identity.id !== row.snapshot.channelId)
        throw new YoutubeApiError('CHANNEL');
      await this.repo.update(row.id, {
        status: 'UPLOADING',
        started_at: row.started_at ?? new Date(),
      });
      const context = `upload:${row.owner_id}:${row.id}`;
      let session = row.session_cipher
        ? this.box.open(row.session_cipher, context)
        : null;
      if (!session) {
        if (row.session_started) throw new YoutubeApiError('UNCERTAIN');
        // This marker commits BEFORE videos.insert. A crash or lost response cannot create another session.
        const marked = await this.repo.db.query(
          'UPDATE youtube_publications SET session_started=TRUE,updated_at=NOW() WHERE id=$1 AND NOT session_started AND NOT cancel_requested RETURNING id',
          [row.id],
        );
        if (!marked.rowCount) {
          const current = await this.repo.publication(
            this.settings.owner,
            row.id,
          );
          if (current.cancel_requested) {
            await this.repo.update(row.id, {
              status: current.session_started ? 'NEEDS_ATTENTION' : 'CANCELLED',
            });
            return;
          }
          throw new YoutubeApiError('UNCERTAIN');
        }
        row.session_started = true;
        try {
          session = await this.uploads.initiate(token, row.snapshot);
        } catch (e) {
          // An explicit 4xx rejection of the metadata POST cannot have accepted the file.
          // Network errors and 5xx remain ambiguous and never clear the persisted marker.
          if (
            e instanceof YoutubeApiError &&
            [400, 401, 403, 429].includes(e.httpStatus)
          ) {
            await this.repo.update(row.id, { session_started: false });
            row.session_started = false;
          }
          throw e;
        }
        const encrypted = this.box.seal(session, context);
        await this.repo.update(row.id, { session_cipher: encrypted });
        row.session_cipher = encrypted;
        await this.repo.event(
          this.settings.owner,
          'UPLOAD_START',
          'SESSION_SAVED',
          row.id,
        );
      }
      let result: Awaited<ReturnType<YoutubeUploadService['inspect']>>;
      try {
        result = await this.uploads.inspect(
          token,
          session,
          row.snapshot.bytes,
          this.controller.signal,
        );
      } catch (e) {
        if (e instanceof YoutubeApiError && e.code === 'AUTH') {
          token = await this.oauth.token(row.connection_id, true);
          result = await this.uploads.inspect(
            token,
            session,
            row.snapshot.bytes,
            this.controller.signal,
          );
        } else throw e;
      }
      if (result.videoId) {
        await this.accepted(row, result.videoId);
        return;
      }
      let offset = result.offset;
      await this.repo.update(row.id, { confirmed_bytes: offset });
      if (result.retryAfter) {
        await this.repo.update(row.id, {
          next_attempt_at: new Date(Date.now() + result.retryAfter * 1000),
        });
        return;
      }
      while (offset < row.snapshot.bytes) {
        const latest = await this.repo.publication(this.settings.owner, row.id);
        if (this.stopped || this.controller.signal.aborted) return; // Existing session survives process shutdown.
        if (latest.cancel_requested) {
          await this.repo.update(row.id, {
            status: 'NEEDS_ATTENTION',
            error_code: 'UNCERTAIN',
            error_message:
              'Envio local interrompido. Confira o resultado remoto.',
          });
          return;
        }
        const activeConnection = await this.repo.channel(
          this.settings.owner,
          row.connection_id,
        );
        if (activeConnection.status !== 'CONNECTED')
          throw new YoutubeApiError('AUTH');
        const end = Math.min(
          row.snapshot.bytes - 1,
          offset + this.settings.chunkBytes - 1,
        );
        token = await this.oauth.token(row.connection_id);
        result = await this.uploads.chunk(
          token,
          session,
          row.snapshot.bytes,
          offset,
          end,
          this.service.storage.openRead!(row.snapshot.videoKey, offset, end),
          this.controller.signal,
        );
        if (result.videoId) {
          await this.accepted(row, result.videoId);
          return;
        }
        if (result.offset <= offset || result.offset > end + 1)
          throw new YoutubeApiError('NETWORK', true);
        offset = result.offset;
        await this.repo.update(row.id, { confirmed_bytes: offset });
        await this.repo.event(
          this.settings.owner,
          'UPLOAD_CHUNK',
          'CONFIRMED',
          row.id,
        );
        if (result.retryAfter) {
          await this.repo.update(row.id, {
            next_attempt_at: new Date(Date.now() + result.retryAfter * 1000),
          });
          return;
        }
      }
      throw new YoutubeApiError('UNCERTAIN');
    } catch (error) {
      if (this.stopped) return;
      const e =
        error instanceof YoutubeApiError
          ? error
          : error instanceof ConflictException
            ? new YoutubeApiError('NETWORK', true)
            : new YoutubeApiError('LOCAL_FILE');
      const current = await this.repo.publication(this.settings.owner, row.id);
      if (e.code === 'AUTH')
        await this.repo.db.query(
          "UPDATE youtube_channel_connections SET status=CASE WHEN status='REVOKED' THEN status ELSE 'EXPIRED' END,updated_at=NOW() WHERE owner_id=$1 AND id=$2",
          [this.settings.owner, row.connection_id],
        );
      const retryable =
        e.transient &&
        Boolean(
          current.session_cipher ||
          current.youtube_video_id ||
          !current.session_started,
        ) &&
        current.attempts + 1 < this.settings.maxAttempts &&
        !current.cancel_requested;
      const delay = Math.max(
        e.retryAfterSeconds * 1000,
        Math.min(3600000, 5000 * 2 ** current.attempts),
      );
      const uncertain =
        [
          'SESSION_EXPIRED',
          'UNCERTAIN',
          'AUTH',
          'REMOTE_MISSING',
          'CHANNEL',
          'SCHEDULE_PAST',
          'DISABLED',
        ].includes(e.code) ||
        (current.session_started &&
          !current.session_cipher &&
          !current.youtube_video_id);
      await this.repo.update(row.id, {
        status: retryable
          ? current.youtube_video_id
            ? 'PROCESSING'
            : 'UPLOADING'
          : uncertain
            ? 'NEEDS_ATTENTION'
            : 'FAILED',
        attempts: current.attempts + 1,
        error_code: e.code,
        error_message: e.message,
        next_attempt_at: new Date(Date.now() + delay),
      });
      await this.repo.event(
        this.settings.owner,
        'PUBLICATION_JOB',
        'FAILED',
        row.id,
        e.code,
      );
    } finally {
      this.controller = undefined;
    }
  }
}
