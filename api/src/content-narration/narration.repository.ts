import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { PostgresDatabaseService } from '../database/postgres-database.service';
import { ContentAssetRepository } from '../content-assets/content-asset.repository';
import type { ContentAsset } from '../content-assets/content-asset';
export interface AudioSelection {
  sceneId: string;
  assetId: string;
  acceptedFingerprint: string | null;
}
@Injectable()
export class NarrationRepository {
  private worker?: PoolClient;
  constructor(
    private readonly db: PostgresDatabaseService,
    private readonly assets: ContentAssetRepository,
  ) {}
  async selections(
    projectId: string,
    client?: PoolClient,
  ): Promise<AudioSelection[]> {
    const query =
      'SELECT scene_id,asset_id,accepted_fingerprint FROM content_scene_audio WHERE project_id=$1';
    const r = client
      ? await client.query<{
          scene_id: string;
          asset_id: string;
          accepted_fingerprint: string | null;
        }>(query, [projectId])
      : await this.db.query<{
          scene_id: string;
          asset_id: string;
          accepted_fingerprint: string | null;
        }>(query, [projectId]);
    return r.rows.map((x) => ({
      sceneId: x.scene_id,
      assetId: x.asset_id,
      acceptedFingerprint: x.accepted_fingerprint,
    }));
  }
  async select(
    projectId: string,
    sceneId: string,
    assetId: string,
    fingerprint: string | null,
    client: PoolClient,
  ) {
    await client.query(
      `INSERT INTO content_scene_audio(project_id,scene_id,asset_id,accepted_fingerprint) VALUES($1,$2,$3,$4)
      ON CONFLICT(project_id,scene_id) DO UPDATE SET asset_id=EXCLUDED.asset_id,accepted_fingerprint=EXCLUDED.accepted_fingerprint,updated_at=NOW()`,
      [projectId, sceneId, assetId, fingerprint],
    );
  }
  async insert(asset: ContentAsset, client: PoolClient) {
    await client.query(
      `INSERT INTO content_assets(id,project_id,scene_id,type,source,status,usage,provider,model,voice,original_prompt,final_generation_prompt,scene_fingerprint,metadata)
      VALUES($1,$2,$3,'AUDIO',$4,'PENDING','OPTIONAL',$5,$6,$7,$8,$9,$10,$11::jsonb)`,
      [
        asset.id,
        asset.projectId,
        asset.sceneId,
        asset.source,
        asset.provider,
        asset.model,
        asset.voice,
        asset.originalPrompt,
        asset.finalGenerationPrompt,
        asset.sceneFingerprint,
        JSON.stringify(asset.metadata),
      ],
    );
  }
  async ready(asset: ContentAsset, client?: PoolClient) {
    const sql = `UPDATE content_assets SET status='READY',storage_key=$2,mime_type=$3,duration_seconds=$4,provider=$5,model=$6,voice=$7,metadata=$8::jsonb,token_usage=$9::jsonb,error=NULL,updated_at=NOW() WHERE id=$1 AND type='AUDIO'`;
    const values = [
      asset.id,
      asset.storageKey,
      asset.mimeType,
      asset.durationSeconds,
      asset.provider,
      asset.model,
      asset.voice,
      JSON.stringify(asset.metadata),
      JSON.stringify(asset.tokenUsage),
    ];
    if (client) await client.query(sql, values);
    else await this.db.query(sql, values);
  }
  async queuedCount(client: PoolClient) {
    const r = await client.query<{ count: string }>(
      "SELECT count(*) FROM content_assets WHERE type='AUDIO' AND status IN ('PENDING','GENERATING')",
    );
    return Number(r.rows[0].count);
  }
  async claim(): Promise<ContentAsset | null> {
    const r = await this.db.query<{
      id: string;
      project_id: string;
    }>(`UPDATE content_assets SET status='GENERATING',updated_at=NOW()
      WHERE id=(SELECT id FROM content_assets WHERE type='AUDIO' AND status='PENDING' ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING id,project_id`);
    const row = r.rows[0];
    return row ? await this.assets.get(row.project_id, row.id) : null;
  }
  async startWorker() {
    const client = await this.db.acquireClient();
    try {
      const r = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended('content-tts:worker',0)) acquired",
      );
      if (!r.rows[0].acquired)
        throw new ServiceUnavailableException(
          'Já existe uma API executando a fila de narração neste banco.',
        );
      this.worker = client;
      // Persisted PENDING jobs resume. Never repeat an ambiguous billed GENERATING call.
      await this.db.query(
        "UPDATE content_assets SET status='FAILED',error='Narração interrompida pelo reinício da API. Tente novamente.',updated_at=NOW() WHERE type='AUDIO' AND status='GENERATING'",
      );
    } catch (error) {
      this.worker = undefined;
      client.release();
      throw error;
    }
  }
  async stopWorker() {
    const client = this.worker;
    this.worker = undefined;
    if (!client) return;
    try {
      await client.query(
        "SELECT pg_advisory_unlock(hashtextextended('content-tts:worker',0))",
      );
    } finally {
      client.release();
    }
  }
}
