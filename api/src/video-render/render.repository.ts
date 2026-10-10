import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { PostgresDatabaseService } from '../database/postgres-database.service';
import type { RenderJob, RenderSnapshot, RenderStatus } from './render-job';
interface Row {
  id: string;
  project_id: string;
  status: RenderStatus;
  progress: number;
  snapshot: RenderSnapshot;
  output_asset_id: string | null;
  error: string | null;
  cancel_requested: boolean;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  render_duration_seconds: number | null;
}
export const ACTIVE_RENDER_STATUSES = [
  'QUEUED',
  'PREPARING',
  'RENDERING',
  'FINALIZING',
];
@Injectable()
export class RenderRepository {
  private worker?: PoolClient;
  constructor(private readonly db: PostgresDatabaseService) {}
  private map(r: Row): RenderJob {
    return {
      id: r.id,
      projectId: r.project_id,
      status: r.status,
      progress: r.progress,
      snapshot: r.snapshot,
      outputAssetId: r.output_asset_id,
      error: r.error,
      cancelRequested: r.cancel_requested,
      createdAt: r.created_at.toISOString(),
      startedAt: r.started_at?.toISOString() ?? null,
      completedAt: r.completed_at?.toISOString() ?? null,
      renderDurationSeconds: r.render_duration_seconds,
      videoUrl:
        r.status === 'COMPLETED'
          ? `/content-projects/${r.project_id}/renders/${r.id}/video`
          : null,
      downloadUrl:
        r.status === 'COMPLETED'
          ? `/content-projects/${r.project_id}/renders/${r.id}/download`
          : null,
    };
  }
  async list(projectId: string, client?: PoolClient) {
    const sql =
      'SELECT * FROM content_video_renders WHERE project_id=$1 ORDER BY created_at DESC,id';
    const r = client
      ? await client.query<Row>(sql, [projectId])
      : await this.db.query<Row>(sql, [projectId]);
    return r.rows.map((r) => this.map(r));
  }
  async get(projectId: string, id: string) {
    const r = await this.db.query<Row>(
      'SELECT * FROM content_video_renders WHERE project_id=$1 AND id=$2',
      [projectId, id],
    );
    if (!r.rows[0])
      throw new NotFoundException(
        'Renderização não pertence ao projeto ou não existe.',
      );
    return this.map(r.rows[0]);
  }
  async insert(
    id: string,
    projectId: string,
    snapshot: RenderSnapshot,
    client: PoolClient,
  ) {
    const r = await client.query<Row>(
      "INSERT INTO content_video_renders(id,project_id,status,snapshot) VALUES($1,$2,'QUEUED',$3::jsonb) RETURNING *",
      [id, projectId, JSON.stringify(snapshot)],
    );
    return this.map(r.rows[0]);
  }
  async count(client: PoolClient) {
    const r = await client.query<{ count: string }>(
      "SELECT count(*) FROM content_video_renders WHERE status IN ('QUEUED','PREPARING','RENDERING','FINALIZING')",
    );
    return Number(r.rows[0].count);
  }
  async claim() {
    const r = await this.db.query<Row>(
      `UPDATE content_video_renders SET status='PREPARING',started_at=NOW() WHERE id=(SELECT id FROM content_video_renders WHERE status='QUEUED' AND NOT cancel_requested ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,
    );
    return r.rows[0] ? this.map(r.rows[0]) : null;
  }
  async progress(id: string, status: RenderStatus, progress: number) {
    await this.db.query(
      "UPDATE content_video_renders SET status=$2,progress=GREATEST(progress,$3) WHERE id=$1 AND status IN ('PREPARING','RENDERING','FINALIZING') AND NOT cancel_requested",
      [id, status, Math.min(99, progress)],
    );
  }
  async cancel(projectId: string, id: string) {
    await this.db.query(
      "UPDATE content_video_renders SET cancel_requested=TRUE,status=CASE WHEN status='QUEUED' THEN 'CANCELLED' ELSE status END,completed_at=CASE WHEN status='QUEUED' THEN NOW() ELSE completed_at END WHERE project_id=$1 AND id=$2 AND status IN ('QUEUED','PREPARING','RENDERING','FINALIZING')",
      [projectId, id],
    );
    return this.get(projectId, id);
  }
  async finishFailure(
    id: string,
    status: 'FAILED' | 'CANCELLED',
    error: string | null,
  ) {
    await this.db.query(
      "UPDATE content_video_renders SET status=CASE WHEN cancel_requested THEN 'CANCELLED' ELSE $2 END,error=CASE WHEN cancel_requested THEN NULL ELSE $3 END,completed_at=NOW(),render_duration_seconds=EXTRACT(EPOCH FROM NOW()-started_at) WHERE id=$1 AND status IN ('QUEUED','PREPARING','RENDERING','FINALIZING')",
      [id, status, error],
    );
  }
  async complete(
    job: RenderJob,
    assetId: string,
    key: string,
    info: {
      durationSeconds: number;
      width: number;
      height: number;
      bytes: number;
    },
  ) {
    return this.db.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const r = await client.query<Row>(
          'SELECT * FROM content_video_renders WHERE id=$1 FOR UPDATE',
          [job.id],
        );
        if (
          !r.rows[0] ||
          r.rows[0].cancel_requested ||
          !ACTIVE_RENDER_STATUSES.includes(r.rows[0].status)
        ) {
          await client.query('ROLLBACK');
          return false;
        }
        await client.query(
          `INSERT INTO content_assets(id,project_id,type,source,status,storage_key,mime_type,width,height,duration_seconds,metadata) VALUES($1,$2,'VIDEO','RENDERED','READY',$3,'video/mp4',$4,$5,$6,$7::jsonb)`,
          [
            assetId,
            job.projectId,
            key,
            info.width,
            info.height,
            info.durationSeconds,
            JSON.stringify({
              renderJobId: job.id,
              fps: job.snapshot.config.fps,
              codec: 'h264',
              audioCodec: 'aac',
              pixelFormat: 'yuv420p',
              faststart: true,
              bytes: info.bytes,
              config: job.snapshot.config,
            }),
          ],
        );
        await client.query(
          "UPDATE content_video_renders SET status='COMPLETED',progress=100,output_asset_id=$2,completed_at=NOW(),render_duration_seconds=EXTRACT(EPOCH FROM NOW()-started_at) WHERE id=$1",
          [job.id, assetId],
        );
        await client.query('COMMIT');
        return true;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    });
  }
  async startWorker() {
    const client = await this.db.acquireClient();
    try {
      const r = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended('content-video:worker',0)) acquired",
      );
      if (!r.rows[0].acquired)
        throw new ServiceUnavailableException(
          'Já existe uma API executando a fila de vídeo neste banco.',
        );
      this.worker = client;
      await this.db.query(
        "UPDATE content_video_renders SET status=CASE WHEN cancel_requested THEN 'CANCELLED' ELSE 'FAILED' END,error=CASE WHEN cancel_requested THEN NULL ELSE 'Renderização interrompida pelo reinício da API. Gere uma nova versão.' END,completed_at=NOW() WHERE status IN ('PREPARING','RENDERING','FINALIZING')",
      );
    } catch (e) {
      this.worker = undefined;
      client.release();
      throw e;
    }
  }
  async stopWorker() {
    const client = this.worker;
    this.worker = undefined;
    if (!client) return;
    try {
      await client.query(
        "SELECT pg_advisory_unlock(hashtextextended('content-video:worker',0))",
      );
    } finally {
      client.release();
    }
  }
}
