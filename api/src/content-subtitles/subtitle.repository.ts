import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { PostgresDatabaseService } from '../database/postgres-database.service';
import {
  defaultSubtitles,
  SubtitleProjectState,
  SubtitleVersion,
} from './subtitle.schema';
interface Row {
  id: string;
  project_id: string;
  scene_id: string;
  audio_asset_id: string;
  status: SubtitleVersion['status'];
  data: SubtitleVersion['data'];
  error: string | null;
  created_at: Date;
}
function map(r: Row): SubtitleVersion {
  return {
    id: r.id,
    projectId: r.project_id,
    sceneId: r.scene_id,
    audioAssetId: r.audio_asset_id,
    status: r.status,
    data: r.data,
    error: r.error,
    createdAt: r.created_at.toISOString(),
  };
}
@Injectable()
export class SubtitleRepository {
  private worker?: PoolClient;
  constructor(private readonly db: PostgresDatabaseService) {}
  async state(id: string, client?: PoolClient): Promise<SubtitleProjectState> {
    const sql =
      'SELECT settings,selections FROM content_project_subtitles WHERE project_id=$1';
    const r = client
      ? await client.query<SubtitleProjectState>(sql, [id])
      : await this.db.query<SubtitleProjectState>(sql, [id]);
    return r.rows[0] ?? { settings: defaultSubtitles(), selections: {} };
  }
  async saveState(id: string, state: SubtitleProjectState, client: PoolClient) {
    await client.query(
      'INSERT INTO content_project_subtitles(project_id,settings,selections) VALUES($1,$2::jsonb,$3::jsonb) ON CONFLICT(project_id) DO UPDATE SET settings=EXCLUDED.settings,selections=EXCLUDED.selections,updated_at=NOW()',
      [id, JSON.stringify(state.settings), JSON.stringify(state.selections)],
    );
  }
  async list(id: string, client?: PoolClient) {
    const sql =
      'SELECT * FROM content_subtitles WHERE project_id=$1 ORDER BY created_at DESC,id';
    const r = client
      ? await client.query<Row>(sql, [id])
      : await this.db.query<Row>(sql, [id]);
    return r.rows.map(map);
  }
  async insert(v: SubtitleVersion, client: PoolClient) {
    await client.query(
      'INSERT INTO content_subtitles(id,project_id,scene_id,audio_asset_id,status,data) VALUES($1,$2,$3,$4,$5,$6::jsonb)',
      [
        v.id,
        v.projectId,
        v.sceneId,
        v.audioAssetId,
        v.status,
        JSON.stringify(v.data),
      ],
    );
  }
  async update(v: SubtitleVersion, client?: PoolClient) {
    const sql =
      'UPDATE content_subtitles SET status=$2,data=$3::jsonb,error=$4,updated_at=NOW() WHERE id=$1 AND project_id=$5';
    const args = [v.id, v.status, JSON.stringify(v.data), v.error, v.projectId];
    if (client) await client.query(sql, args);
    else await this.db.query(sql, args);
  }
  async count(client: PoolClient) {
    const r = await client.query<{ count: string }>(
      "SELECT count(*) FROM content_subtitles WHERE status IN ('QUEUED','PROCESSING')",
    );
    return Number(r.rows[0].count);
  }
  async claim() {
    const r = await this.db.query<Row>(
      "UPDATE content_subtitles SET status='PROCESSING',updated_at=NOW() WHERE id=(SELECT id FROM content_subtitles WHERE status='QUEUED' ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *",
    );
    return r.rows[0] ? map(r.rows[0]) : null;
  }
  async startWorker() {
    const client = await this.db.acquireClient();
    try {
      const r = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended('content-subtitles:worker',0)) acquired",
      );
      if (!r.rows[0].acquired)
        throw new ServiceUnavailableException(
          'Outra API já executa a fila de legendas neste banco.',
        );
      await this.db.query(
        "UPDATE content_subtitles SET status='FAILED',error='Transcrição interrompida pelo reinício da API. Revise antes de tentar novamente.' WHERE status='PROCESSING'",
      );
      this.worker = client;
    } catch (e) {
      client.release();
      throw e;
    }
  }
  async stopWorker() {
    const c = this.worker;
    this.worker = undefined;
    if (c) {
      try {
        await c.query(
          "SELECT pg_advisory_unlock(hashtextextended('content-subtitles:worker',0))",
        );
      } finally {
        c.release();
      }
    }
  }
}
