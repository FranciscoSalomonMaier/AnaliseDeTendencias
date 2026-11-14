import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import { randomUUID } from 'node:crypto';
import { PostgresDatabaseService } from '../database/postgres-database.service';
import type { RemixProject, RemixSource } from './video-remix.schema';
interface Row extends QueryResultRow {
  id: string;
  title: string;
  topic: string;
  description: string;
  mode: RemixProject['mode'];
  narration_language: string;
  target_duration_seconds: number;
  aspect_ratio: RemixProject['aspectRatio'];
  status: RemixProject['status'];
  revision: number;
  source_count?: string;
  created_at: Date;
  updated_at: Date;
}
interface SourceRow extends QueryResultRow {
  platform?: string;
  external_id?: string;
  platform_metadata?: Record<string, unknown>;
  imported_file_id?: string;
  id: string;
  project_id: string;
  title: string;
  origin_type: RemixSource['originType'];
  original_url: string | null;
  local_asset_id: string | null;
  duration_seconds: number | null;
  status: RemixSource['status'];
  licensing: RemixSource['licensing'];
  created_at: Date;
}
export function mapProject(r: Row): RemixProject {
  return {
    id: r.id,
    title: r.title,
    topic: r.topic,
    description: r.description,
    mode: r.mode,
    narrationLanguage: r.narration_language,
    targetDurationSeconds: r.target_duration_seconds,
    aspectRatio: r.aspect_ratio,
    status: r.status,
    revision: r.revision,
    sourceCount: Number(r.source_count ?? 0),
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}
@Injectable()
export class VideoRemixRepository {
  constructor(readonly db: PostgresDatabaseService) {}
  async get(id: string, owner: string, client?: PoolClient, lock = false) {
    const sql = `SELECT p.*,(SELECT COUNT(*) FROM video_remix_sources s WHERE s.project_id=p.id) source_count FROM video_remix_projects p WHERE p.id=$1 AND p.owner_id=$2${lock ? ' FOR UPDATE OF p' : ''}`;
    const r = await (client
      ? client.query<Row>(sql, [id, owner])
      : this.db.query<Row>(sql, [id, owner]));
    if (!r.rows[0])
      throw new NotFoundException('Projeto Video Remix não encontrado.');
    return mapProject(r.rows[0]);
  }
  async list(owner: string, limit: number, offset: number) {
    const r = await this.db.query<Row>(
      'SELECT p.*,(SELECT COUNT(*) FROM video_remix_sources s WHERE s.project_id=p.id) source_count FROM video_remix_projects p WHERE owner_id=$1 ORDER BY updated_at DESC,id LIMIT $2 OFFSET $3',
      [owner, limit, offset],
    );
    const count = await this.db.query<{ count: string }>(
      'SELECT COUNT(*) FROM video_remix_projects WHERE owner_id=$1',
      [owner],
    );
    return {
      items: r.rows.map(mapProject),
      total: Number(count.rows[0].count),
      limit,
      offset,
    };
  }
  async create(
    owner: string,
    p: Omit<
      RemixProject,
      'id' | 'status' | 'revision' | 'sourceCount' | 'createdAt' | 'updatedAt'
    >,
  ) {
    const r = await this.db.query<Row>(
      `INSERT INTO video_remix_projects(id,owner_id,title,topic,description,mode,narration_language,target_duration_seconds,aspect_ratio) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        randomUUID(),
        owner,
        p.title,
        p.topic,
        p.description,
        p.mode,
        p.narrationLanguage,
        p.targetDurationSeconds,
        p.aspectRatio,
      ],
    );
    return mapProject(r.rows[0]);
  }
  async locked<T>(
    id: string,
    owner: string,
    revision: number,
    work: (p: RemixProject, c: PoolClient) => Promise<T>,
  ) {
    return this.db.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const p = await this.get(id, owner, client, true);
        if (p.revision !== revision)
          throw new ConflictException(
            'Projeto alterado em outra janela. Atualize a página.',
          );
        if (p.status !== 'DRAFT')
          throw new ConflictException(
            'Operação permitida apenas em projetos DRAFT.',
          );
        const result = await work(p, client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }
  async save(p: RemixProject, c: PoolClient) {
    await c.query(
      'UPDATE video_remix_projects SET title=$2,topic=$3,description=$4,mode=$5,narration_language=$6,target_duration_seconds=$7,aspect_ratio=$8,revision=revision+1,updated_at=NOW() WHERE id=$1',
      [
        p.id,
        p.title,
        p.topic,
        p.description,
        p.mode,
        p.narrationLanguage,
        p.targetDurationSeconds,
        p.aspectRatio,
      ],
    );
  }
  async sources(id: string, client?: PoolClient) {
    const sql =
      'SELECT * FROM video_remix_sources WHERE project_id=$1 ORDER BY created_at,id';
    const rows = await (client
      ? client.query<SourceRow>(sql, [id])
      : this.db.query<SourceRow>(sql, [id]));
    return rows.rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      title: r.title,
      originType: r.origin_type,
      originalUrl: r.original_url,
      localAssetId: r.local_asset_id,
      durationSeconds: r.duration_seconds,
      status: r.status,
      licensing: r.licensing,
      platform: r.platform ?? null,
      externalId: r.external_id ?? null,
      platformMetadata: r.platform_metadata ?? {},
      importedFileId: r.imported_file_id ?? null,
      createdAt: r.created_at.toISOString(),
    }));
  }
}
