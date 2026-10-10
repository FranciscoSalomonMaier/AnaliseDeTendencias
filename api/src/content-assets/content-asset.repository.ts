import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PoolClient, QueryResultRow } from 'pg';
import { PostgresDatabaseService } from '../database/postgres-database.service';
import { ContentAsset, VisualSelection } from './content-asset';
import { StorageProvider } from './storage.provider';

interface AssetRow {
  id: string;
  project_id: string;
  scene_id: string | null;
  type: ContentAsset['type'];
  source: ContentAsset['source'];
  status: ContentAsset['status'];
  usage: ContentAsset['usage'];
  storage_key: string | null;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  duration_seconds?: number | null;
  voice?: string | null;
  provider: string | null;
  model: string | null;
  original_prompt: string | null;
  final_generation_prompt: string | null;
  scene_fingerprint: string | null;
  metadata: ContentAsset['metadata'];
  token_usage: ContentAsset['tokenUsage'];
  error: string | null;
  created_at: Date;
  updated_at: Date;
}
@Injectable()
export class ContentAssetRepository {
  private workerClient?: PoolClient;
  constructor(
    private readonly db: PostgresDatabaseService,
    private readonly storage: StorageProvider,
  ) {}
  private query<T extends QueryResultRow>(
    sql: string,
    values: unknown[],
    client?: PoolClient,
  ) {
    return client
      ? client.query<T>(sql, values)
      : this.db.query<T>(sql, values);
  }
  private map(r: AssetRow): ContentAsset {
    return {
      id: r.id,
      projectId: r.project_id,
      sceneId: r.scene_id,
      type: r.type,
      source: r.source,
      status: r.status,
      usage: r.usage,
      storageKey: r.storage_key,
      url:
        r.status === 'READY'
          ? r.type === 'VIDEO' && typeof r.metadata.renderJobId === 'string'
            ? `/content-projects/${r.project_id}/renders/${r.metadata.renderJobId}/video`
            : r.type === 'AUDIO' &&
                (r.metadata.audioRole === 'BACKGROUND_MUSIC' ||
                  r.metadata.audioRole === 'SOUND_EFFECT')
              ? `/content-projects/${r.project_id}/audio-library/${r.id}/file`
              : this.storage.getUrl(r.project_id, r.id)
          : null,
      mimeType: r.mime_type,
      width: r.width,
      height: r.height,
      durationSeconds: r.duration_seconds ?? null,
      voice: r.voice ?? null,
      provider: r.provider,
      model: r.model,
      originalPrompt: r.original_prompt,
      finalGenerationPrompt: r.final_generation_prompt,
      sceneFingerprint: r.scene_fingerprint,
      metadata: r.metadata,
      tokenUsage: r.token_usage,
      error: r.error,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    };
  }
  async list(projectId: string, client?: PoolClient) {
    const result = await this.query<AssetRow>(
      'SELECT * FROM content_assets WHERE project_id=$1 ORDER BY created_at,id',
      [projectId],
      client,
    );
    return result.rows.map((r) => this.map(r));
  }
  async get(projectId: string, id: string, client?: PoolClient) {
    const result = await this.query<AssetRow>(
      'SELECT * FROM content_assets WHERE project_id=$1 AND id=$2',
      [projectId, id],
      client,
    );
    if (!result.rows[0])
      throw new NotFoundException(
        'Asset não pertence ao projeto ou não existe',
      );
    return this.map(result.rows[0]);
  }
  async selections(
    projectId: string,
    client?: PoolClient,
  ): Promise<VisualSelection[]> {
    const result = await this.query<{
      scene_id: string;
      asset_id: string;
      fingerprint: string;
    }>(
      'SELECT scene_id,asset_id,fingerprint FROM content_scene_visuals WHERE project_id=$1',
      [projectId],
      client,
    );
    return result.rows.map((r) => ({
      sceneId: r.scene_id,
      assetId: r.asset_id,
      fingerprint: r.fingerprint,
    }));
  }
  async insert(asset: ContentAsset, client: PoolClient) {
    await client.query(
      `INSERT INTO content_assets(id,project_id,scene_id,source,status,usage,provider,model,original_prompt,final_generation_prompt,scene_fingerprint,metadata)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
      [
        asset.id,
        asset.projectId,
        asset.sceneId,
        asset.source,
        asset.status,
        asset.usage,
        asset.provider,
        asset.model,
        asset.originalPrompt,
        asset.finalGenerationPrompt,
        asset.sceneFingerprint,
        JSON.stringify(asset.metadata),
      ],
    );
  }
  async generating(id: string) {
    await this.db.query(
      "UPDATE content_assets SET status='GENERATING',updated_at=NOW() WHERE id=$1 AND status='PENDING'",
      [id],
    );
  }
  async ready(asset: ContentAsset, client?: PoolClient) {
    await this.query(
      `UPDATE content_assets SET status='READY',storage_key=$2,mime_type=$3,width=$4,height=$5,provider=$6,model=$7,metadata=$8::jsonb,token_usage=$9::jsonb,error=NULL,updated_at=NOW() WHERE id=$1`,
      [
        asset.id,
        asset.storageKey,
        asset.mimeType,
        asset.width,
        asset.height,
        asset.provider,
        asset.model,
        JSON.stringify(asset.metadata),
        JSON.stringify(asset.tokenUsage),
      ],
      client,
    );
  }
  async failed(id: string, message: string, asset?: ContentAsset) {
    await this.db.query(
      "UPDATE content_assets SET status='FAILED',error=$2,metadata=metadata||$3::jsonb,token_usage=COALESCE($4::jsonb,token_usage),provider=COALESCE($5,provider),model=COALESCE($6,model),updated_at=NOW() WHERE id=$1 AND status IN ('PENDING','GENERATING')",
      [
        id,
        message,
        JSON.stringify(asset?.metadata ?? {}),
        asset?.tokenUsage ? JSON.stringify(asset.tokenUsage) : null,
        asset?.provider ?? null,
        asset?.model ?? null,
      ],
    );
  }
  async select(
    projectId: string,
    sceneId: string,
    assetId: string,
    fingerprint: string,
    client: PoolClient,
  ) {
    await client.query(
      `INSERT INTO content_scene_visuals(project_id,scene_id,asset_id,fingerprint) VALUES($1,$2,$3,$4)
      ON CONFLICT(project_id,scene_id) DO UPDATE SET asset_id=EXCLUDED.asset_id,fingerprint=EXCLUDED.fingerprint,updated_at=NOW()`,
      [projectId, sceneId, assetId, fingerprint],
    );
  }
  async recoverInterrupted() {
    if (!this.workerClient) {
      const client = await this.db.acquireClient();
      try {
        const result = await client.query<{ acquired: boolean }>(
          "SELECT pg_try_advisory_lock(hashtextextended('content-images:worker',0)) acquired",
        );
        if (!result.rows[0].acquired)
          throw new ServiceUnavailableException(
            'Já existe uma API executando a fila local de imagens neste banco.',
          );
        this.workerClient = client;
      } catch (error) {
        client.release();
        throw error;
      }
    }
    // Local single-process queue: never repeat a potentially billed call after restart.
    await this.db.query(
      "UPDATE content_assets SET status='FAILED',error='Geração interrompida pelo reinício da API. Tente novamente.',updated_at=NOW() WHERE type='IMAGE' AND status IN ('PENDING','GENERATING')",
    );
  }
  async releaseWorker() {
    if (!this.workerClient) return;
    const client = this.workerClient;
    this.workerClient = undefined;
    try {
      await client.query(
        "SELECT pg_advisory_unlock(hashtextextended('content-images:worker',0))",
      );
    } finally {
      client.release();
    }
  }
}
