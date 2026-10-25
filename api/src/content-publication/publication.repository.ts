import { ConflictException, Injectable, HttpException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { PostgresDatabaseService } from '../database/postgres-database.service';
import { defaultPreparation, Preparation } from './publication.schema';
@Injectable()
export class PublicationRepository {
  constructor(private readonly db: PostgresDatabaseService) {}
  async get(id: string, client?: PoolClient, target = 'YOUTUBE_VIDEO') {
    if (target !== 'YOUTUBE_VIDEO') {
      const query =
        'SELECT revision,data,updated_at FROM content_publication_destinations WHERE project_id=$1 AND target=$2';
      const result = client
        ? await client.query<{
            revision: number;
            data: Preparation;
            updated_at: Date;
          }>(query, [id, target])
        : await this.db.query<{
            revision: number;
            data: Preparation;
            updated_at: Date;
          }>(query, [id, target]);
      const row = result.rows[0];
      const data = { ...defaultPreparation(), ...row?.data };
      if (!row)
        data.thumbnailText = { ...data.thumbnailText, aspectRatio: '9:16' };
      return {
        revision: row?.revision ?? 0,
        data,
        updatedAt: row?.updated_at.toISOString() ?? null,
      };
    }
    const sql =
      'SELECT revision,data,updated_at FROM content_publication WHERE project_id=$1';
    const r = client
      ? await client.query<{
          revision: number;
          data: Preparation;
          updated_at: Date;
        }>(sql, [id])
      : await this.db.query<{
          revision: number;
          data: Preparation;
          updated_at: Date;
        }>(sql, [id]);
    return r.rows[0]
      ? {
          revision: r.rows[0].revision,
          data: { ...defaultPreparation(), ...r.rows[0].data },
          updatedAt: r.rows[0].updated_at.toISOString(),
        }
      : { revision: 0, data: defaultPreparation(), updatedAt: null };
  }
  async ensure(id: string, client: PoolClient) {
    await client.query(
      'INSERT INTO content_publication(project_id,data) VALUES($1,$2::jsonb) ON CONFLICT DO NOTHING',
      [id, JSON.stringify(defaultPreparation())],
    );
  }
  async save(
    id: string,
    revision: number,
    data: Preparation,
    client: PoolClient,
    target = 'YOUTUBE_VIDEO',
  ) {
    await this.ensure(id, client);
    if (target !== 'YOUTUBE_VIDEO') {
      await client.query(
        'INSERT INTO content_publication_destinations(project_id,target,data) VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING',
        [id, target, JSON.stringify(defaultPreparation())],
      );
      const result = await client.query(
        'UPDATE content_publication_destinations SET data=$4::jsonb, revision=revision+1, updated_at=NOW() WHERE project_id=$1 AND target=$2 AND revision=$3',
        [id, target, revision, JSON.stringify(data)],
      );
      if (!result.rowCount)
        throw new ConflictException(
          'Preparação alterada em outra janela. Reabra antes de salvar.',
        );
      return;
    }
    const r = await client.query(
      'UPDATE content_publication SET data=$3::jsonb,revision=revision+1,updated_at=NOW() WHERE project_id=$1 AND revision=$2 RETURNING revision',
      [id, revision, JSON.stringify(data)],
    );
    if (!r.rowCount)
      throw new ConflictException(
        'Preparação alterada em outra janela. Reabra antes de salvar.',
      );
  }
  async thumbnails(id: string) {
    return (
      await this.db.query<{
        id: string;
        asset_id: string;
        overlay: unknown;
        created_at: Date;
      }>(
        'SELECT id,asset_id,overlay,created_at FROM content_publication_thumbnails WHERE project_id=$1 ORDER BY created_at DESC,id',
        [id],
      )
    ).rows;
  }
  async thumbnail(id: string, thumbId: string) {
    return (
      await this.db.query<{
        id: string;
        asset_id: string;
        background_key: string;
        overlay: unknown;
      }>(
        'SELECT * FROM content_publication_thumbnails WHERE project_id=$1 AND id=$2',
        [id, thumbId],
      )
    ).rows[0];
  }
  async generations(id: string, target = 'YOUTUBE_VIDEO') {
    return (
      await this.db.query(
        'SELECT id,kind,status,result,provider,model,usage,error,created_at FROM content_publication_generations WHERE project_id=$1 AND target=$2 ORDER BY created_at DESC LIMIT 30',
        [id, target],
      )
    ).rows;
  }
  async start(
    id: string,
    kind: string,
    client: PoolClient,
    jobId: string,
    target = 'YOUTUBE_VIDEO',
  ) {
    await this.ensure(id, client);
    const recent = await client.query<{ count: string }>(
      "SELECT count(*) FROM content_publication_generations WHERE project_id=$1 AND created_at>NOW()-INTERVAL '1 minute'",
      [id],
    );
    if (Number(recent.rows[0]?.count ?? 0) >= 5)
      throw new HttpException(
        'Limite de cinco gerações por minuto neste projeto.',
        429,
      );
    // Only recover our abandoned operation after a conservative timeout. No paid retry.
    await client.query(
      "UPDATE content_publication_generations SET status='FAILED',error='Operação interrompida; nenhuma nova geração foi iniciada.',updated_at=NOW() WHERE project_id=$1 AND status='RUNNING' AND created_at<NOW()-INTERVAL '30 minutes'",
      [id],
    );
    const pending = await client.query(
      "SELECT 1 FROM content_publication_generations WHERE project_id=$1 AND status='RUNNING'",
      [id],
    );
    if (pending.rowCount)
      throw new ConflictException(
        'Já existe uma geração de publicação em andamento.',
      );
    await client.query(
      "INSERT INTO content_publication_generations(id,project_id,kind,status,target) VALUES($1,$2,$3,'RUNNING',$4)",
      [jobId, id, kind, target],
    );
  }
  async finish(
    jobId: string,
    result: unknown,
    provider?: string,
    model?: string,
    usage?: unknown,
    error?: string,
  ) {
    await this.db.query(
      'UPDATE content_publication_generations SET status=$2,result=$3::jsonb,provider=$4,model=$5,usage=$6::jsonb,error=$7,updated_at=NOW() WHERE id=$1',
      [
        jobId,
        error ? 'FAILED' : 'COMPLETED',
        JSON.stringify(result),
        provider ?? null,
        model ?? null,
        JSON.stringify(usage ?? null),
        error ?? null,
      ],
    );
  }
}
