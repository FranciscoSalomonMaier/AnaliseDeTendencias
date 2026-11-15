import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { unlink, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { StorageProvider } from '../content-assets/storage.provider';
import { VideoRemixRepository } from './video-remix.repository';
import { RemixImportSettings } from './remix-import.settings';
export interface RemixFile {
  id: string;
  projectId: string;
  originalName: string;
  byteSize: number;
  extension: string;
  mimeType: string;
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  status: 'READY';
  available?: boolean;
  createdAt: string;
  url: string;
}
export interface FileRow {
  id: string;
  project_id: string;
  original_name: string;
  byte_size: string;
  extension: string;
  mime_type: string;
  duration_seconds: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  status: 'READY';
  created_at: Date;
  storage_key: string;
}
@Injectable()
export class RemixFilesService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(RemixFilesService.name);
  private timer?: NodeJS.Timeout;
  private work?: Promise<void>;
  constructor(
    private readonly repo: VideoRemixRepository,
    readonly storage: StorageProvider,
    private readonly settings: RemixImportSettings,
  ) {}
  dto(r: FileRow): RemixFile {
    return {
      id: r.id,
      projectId: r.project_id,
      originalName: r.original_name,
      byteSize: Number(r.byte_size),
      extension: r.extension,
      mimeType: r.mime_type,
      durationSeconds: r.duration_seconds,
      width: r.width,
      height: r.height,
      fps: r.fps,
      codec: r.codec,
      status: r.status,
      createdAt: r.created_at.toISOString(),
      url: `/video-remix/projects/${r.project_id}/files/${r.id}/file`,
    };
  }
  async info(project: string, id: string) {
    const r = await this.get(project, id);
    return this.availableDto(r);
  }
  private async availableDto(r: FileRow) {
    let available = false;
    try {
      available =
        (await this.storage.stat?.(r.storage_key))?.size ===
        Number(r.byte_size);
    } catch {
      /* missing physical file */
    }
    return { ...this.dto(r), available };
  }
  async list(project: string) {
    const rows = await this.repo.db.query<FileRow>(
      'SELECT * FROM video_remix_files WHERE project_id=$1 ORDER BY created_at,id',
      [project],
    );
    return Promise.all(rows.rows.map((r) => this.availableDto(r)));
  }
  async get(project: string, id: string, client?: PoolClient) {
    const sql = 'SELECT * FROM video_remix_files WHERE project_id=$1 AND id=$2';
    const r = await (client
      ? client.query<FileRow>(sql, [project, id])
      : this.repo.db.query<FileRow>(sql, [project, id]));
    if (!r.rows[0])
      throw new NotFoundException(
        'Arquivo não pertence ao projeto ou não existe.',
      );
    return r.rows[0];
  }
  async media(project: string, id: string) {
    const f = await this.get(project, id);
    try {
      const info = await this.storage.stat?.(f.storage_key);
      if (!info || info.size !== Number(f.byte_size) || !this.storage.openRead)
        throw new Error('missing');
      return {
        size: info.size,
        mime: f.mime_type,
        extension: f.extension,
        open: (start?: number, end?: number) =>
          this.storage.openRead!(f.storage_key, start, end),
      };
    } catch {
      throw new NotFoundException('Arquivo indisponível no storage.');
    }
  }
  async cleanupProject(project: string, c: PoolClient) {
    await c.query(
      'INSERT INTO video_remix_storage_cleanup(storage_key) SELECT storage_key FROM video_remix_files WHERE project_id=$1 ON CONFLICT DO NOTHING',
      [project],
    );
  }
  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.clean(), 60000);
    this.timer.unref();
    void this.clean();
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.work;
  }
  async clean() {
    if (this.work) return this.work;
    this.work = this.repo.db
      .withClient(async (c) => {
        const l = await c.query<{ ok: boolean }>(
          "SELECT pg_try_advisory_lock(hashtextextended('remix-storage-cleanup',0)) ok",
        );
        if (!l.rows[0].ok) return;
        try {
          const tables = (
            await c.query<{ frames: string | null; audio: string | null }>(
              "SELECT to_regclass('video_remix_scene_frames')::text frames,to_regclass('video_remix_narrations')::text audio",
            )
          ).rows[0];
          for (const r of (
            await c.query<{ storage_key: string }>(
              'SELECT storage_key FROM video_remix_storage_cleanup WHERE not_before<=NOW() ORDER BY created_at LIMIT 100',
            )
          ).rows) {
            try {
              const reference = await c.query(
                `SELECT 1 FROM video_remix_files WHERE storage_key=$1 ${tables.frames ? 'UNION ALL SELECT 1 FROM video_remix_scene_frames WHERE storage_key=$1' : ''} ${tables.audio ? 'UNION ALL SELECT 1 FROM video_remix_narrations WHERE storage_key=$1' : ''}`,
                [r.storage_key],
              );
              if (reference.rowCount) {
                await c.query(
                  'DELETE FROM video_remix_storage_cleanup WHERE storage_key=$1',
                  [r.storage_key],
                );
                continue;
              }
              await this.storage.delete(r.storage_key);
              await c.query(
                'DELETE FROM video_remix_storage_cleanup WHERE storage_key=$1',
                [r.storage_key],
              );
            } catch {
              await c.query(
                'UPDATE video_remix_storage_cleanup SET attempts=attempts+1 WHERE storage_key=$1',
                [r.storage_key],
              );
            }
          }
          await c.query(
            "UPDATE video_remix_sources SET platform_metadata='{}',title='Referência YouTube '||external_id,duration_seconds=CASE WHEN imported_file_id IS NOT NULL THEN duration_seconds ELSE NULL END,platform_metadata_expires_at=NULL WHERE platform='YOUTUBE' AND platform_metadata_expires_at<NOW()",
          );
          await c.query(
            'DELETE FROM video_remix_discovery_cache WHERE expires_at<NOW()',
          );
          await c.query(
            'DELETE FROM video_remix_discovery_rate WHERE window_at<$1',
            [Math.floor(Date.now() / 60000) - 120],
          );
        } finally {
          await c.query(
            "SELECT pg_advisory_unlock(hashtextextended('remix-storage-cleanup',0))",
          );
        }
        for (const name of await readdir(this.settings.tempDir).catch(
          () => [],
        )) {
          if (!/^remix-[\da-f-]{36}$/.test(name)) continue;
          const path = join(this.settings.tempDir, name);
          const info = await stat(path).catch(() => null);
          if (info && Date.now() - info.mtimeMs > 2 * 60 * 60 * 1000)
            await unlink(path).catch(() => {});
        }
      })
      .catch(() =>
        this.logger.warn(
          'Limpeza de arquivos Remix pendente. Verifique a migration 016 e o storage.',
        ),
      )
      .finally(() => {
        this.work = undefined;
      });
    return this.work;
  }
  async requireAvailable(project: string, fileId: string, c: PoolClient) {
    const f = await this.get(project, fileId, c);
    try {
      if (
        (await this.storage.stat?.(f.storage_key))?.size !== Number(f.byte_size)
      )
        throw new Error('missing');
    } catch {
      throw new BadRequestException('Arquivo indisponível para associação.');
    }
    return f;
  }
}
