import { sourceUrl } from './remix-url';
import { RemixFilesService } from './remix-files.service';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { StorageProvider } from '../content-assets/storage.provider';
import { VideoRemixRepository } from './video-remix.repository';
import {
  remixProjectSchema,
  remixUpdateSchema,
  remixDeleteSchema,
  remixSourceSchema,
} from './video-remix.schema';
interface LocalAsset {
  id: string;
  project_id: string;
  storage_key: string;
  duration_seconds: number | null;
  created_at: Date;
  title: string;
}
@Injectable()
export class VideoRemixService {
  constructor(
    private readonly config: ConfigService,
    private readonly repository: VideoRemixRepository,
    private readonly storage: StorageProvider,
    @Optional() private readonly files?: RemixFilesService,
  ) {}
  owner() {
    if (!this.config.get('CONTENT_ACCESS_KEY'))
      throw new ServiceUnavailableException(
        'Configure CONTENT_ACCESS_KEY para usar o Video Remix.',
      );
    return this.config.get<string>('CONTENT_OWNER_ID') ?? 'local-owner';
  }
  async list(query: unknown) {
    const parsed = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(20),
        offset: z.coerce.number().int().min(0).max(100000).default(0),
      })
      .strict()
      .safeParse(query);
    if (!parsed.success) throw new BadRequestException('Paginação inválida.');
    return this.repository.list(
      this.owner(),
      parsed.data.limit,
      parsed.data.offset,
    );
  }
  async create(body: unknown) {
    const p = remixProjectSchema.safeParse(body);
    if (!p.success)
      throw new BadRequestException(
        'Projeto inválido. Verifique título, tema, modo, idioma, duração (5–600 s) e proporção.',
      );
    return this.repository.create(this.owner(), p.data);
  }
  async get(id: string) {
    const owner = this.owner();
    const project = await this.repository.get(id, owner);
    const files = this.files ? await this.files.list(id) : [];
    const sources = await this.repository.sources(id);
    return {
      ...project,
      files,
      sources: sources.map((source) =>
        source.importedFileId &&
        !files.some(
          (file) => file.id === source.importedFileId && file.available,
        )
          ? { ...source, status: 'UNAVAILABLE' as const }
          : source,
      ),
    };
  }

  async update(id: string, body: unknown) {
    const p = remixUpdateSchema.safeParse(body);
    if (!p.success)
      throw new BadRequestException(
        'Atualização inválida. Informe a revisão e os dados editáveis; o status é controlado pelo sistema.',
      );
    const owner = this.owner();
    return this.repository.locked(
      id,
      owner,
      p.data.revision,
      async (project, c) => {
        if (p.data.data.mode === 'SINGLE_SOURCE' && project.sourceCount > 1)
          throw new ConflictException(
            'Remova as fontes excedentes antes de selecionar Single Source.',
          );
        await this.repository.save({ ...project, ...p.data.data }, c);
        return this.repository.get(id, owner, c);
      },
    );
  }
  async remove(id: string, body: unknown) {
    const p = remixDeleteSchema.safeParse(body);
    if (!p.success)
      throw new BadRequestException('Confirme a exclusão e informe a revisão.');
    return this.repository.locked(
      id,
      this.owner(),
      p.data.revision,
      async (_project, c) => {
        if (this.files) await this.files.cleanupProject(id, c);
        await c.query('DELETE FROM video_remix_projects WHERE id=$1', [id]);
        return { deleted: true };
      },
    );
  }
  async listSources(id: string) {
    await this.repository.get(id, this.owner());
    return { items: await this.repository.sources(id) };
  }
  private async ownedAssets(
    owner: string,
    client?: PoolClient,
    assetId?: string,
  ) {
    const sql = `SELECT a.id,a.project_id,a.storage_key,a.duration_seconds,a.created_at,COALESCE(p.script->>'title',p.project_config->>'topic','Vídeo local') title FROM content_assets a JOIN content_generation_runs p ON p.generation_id=a.project_id WHERE a.type='VIDEO' AND a.status='READY' AND a.storage_key IS NOT NULL AND a.mime_type='video/mp4' AND (p.owner_id=$1 OR p.owner_id IS NULL) ${assetId ? 'AND a.id=$2' : ''} ORDER BY a.created_at DESC,a.id LIMIT 100`;
    return client
      ? client.query<LocalAsset>(sql, assetId ? [owner, assetId] : [owner])
      : this.repository.db.query<LocalAsset>(
          sql,
          assetId ? [owner, assetId] : [owner],
        );
  }
  async localAssets() {
    const rows = await this.ownedAssets(this.owner());
    return {
      items: rows.rows.map((a) => ({
        id: a.id,
        title: a.title,
        durationSeconds: a.duration_seconds,
        createdAt: a.created_at.toISOString(),
      })),
    };
  }
  async addSource(id: string, body: unknown) {
    const p = remixSourceSchema.safeParse(body);
    if (!p.success)
      throw new BadRequestException(
        'Fonte inválida. Use URL HTTPS ou asset local e informe os dados de autorização.',
      );
    const owner = this.owner();
    return this.repository.locked(
      id,
      owner,
      p.data.revision,
      async (project, c) => {
        if (project.mode === 'SINGLE_SOURCE' && project.sourceCount >= 1)
          throw new ConflictException(
            'Single Source permite apenas uma fonte.',
          );
        if (project.sourceCount >= 100)
          throw new ConflictException('Limite de 100 fontes por projeto.');
        const originalUrl = p.data.originalUrl
          ? sourceUrl(p.data.originalUrl)
          : null;
        if (
          originalUrl &&
          (await this.repository.sources(id, c)).some(
            (source) =>
              source.originalUrl &&
              sourceUrl(source.originalUrl) === originalUrl,
          )
        )
          throw new ConflictException(
            'Esta referência já está associada ao projeto.',
          );
        let duration = p.data.durationSeconds ?? null;
        let status = 'METADATA_ONLY';
        if (p.data.originType === 'LOCAL_ASSET') {
          const asset = (await this.ownedAssets(owner, c, p.data.localAssetId))
            .rows[0];
          if (!asset)
            throw new BadRequestException(
              'Vídeo local indisponível ou pertencente a outro proprietário.',
            );
          try {
            const stat = await this.storage.stat?.(asset.storage_key);
            if (!stat?.size) throw new Error('missing');
          } catch {
            throw new BadRequestException(
              'Arquivo do vídeo local indisponível no storage.',
            );
          }
          duration = asset.duration_seconds ?? duration;
          status = 'LOCAL_AVAILABLE';
        }
        const sourceId = randomUUID();
        await c.query(
          'INSERT INTO video_remix_sources(id,project_id,title,origin_type,original_url,local_asset_id,duration_seconds,status,licensing) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)',
          [
            sourceId,
            id,
            p.data.title,
            p.data.originType,
            originalUrl,
            p.data.localAssetId ?? null,
            duration,
            status,
            JSON.stringify(p.data.licensing),
          ],
        );
        await this.repository.save(project, c);
        return {
          project: await this.repository.get(id, owner, c),
          source: (await this.repository.sources(id, c)).find(
            (s) => s.id === sourceId,
          ),
        };
      },
    );
  }
  async removeSource(id: string, sourceId: string, body: unknown) {
    const parsed = remixDeleteSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException('Confirme a remoção e informe a revisão.');
    const owner = this.owner();
    return this.repository.locked(
      id,
      owner,
      parsed.data.revision,
      async (p, c) => {
        const result = await c.query(
          'DELETE FROM video_remix_sources WHERE project_id=$1 AND id=$2',
          [id, sourceId],
        );
        if (!result.rowCount)
          throw new BadRequestException(
            'Fonte não pertence ao projeto ou não existe.',
          );
        await this.repository.save(p, c);
        return {
          deleted: true,
          project: await this.repository.get(id, owner, c),
        };
      },
    );
  }
}
