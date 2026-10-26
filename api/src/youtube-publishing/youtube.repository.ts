import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { PostgresDatabaseService } from '../database/postgres-database.service';
import type {
  YoutubeChannelRow,
  YoutubePublicationRow,
  YoutubePublicationSnapshot,
  AutomationRule,
  PublicationStatus,
} from './youtube.schema';
@Injectable()
export class YoutubePublishingRepository {
  constructor(readonly db: PostgresDatabaseService) {}
  async project(owner: string, id: string) {
    const r = await this.db.query<{ owner_id: string | null }>(
      'SELECT owner_id FROM content_generation_runs WHERE generation_id=$1 AND project_config IS NOT NULL',
      [id],
    );
    if (
      !r.rows[0] ||
      (r.rows[0].owner_id !== null && r.rows[0].owner_id !== owner)
    )
      throw new NotFoundException(
        'Projeto indisponível para este proprietário.',
      );
  }
  async channels(owner: string) {
    return (
      await this.db.query<YoutubeChannelRow>(
        'SELECT * FROM youtube_channel_connections WHERE owner_id=$1 ORDER BY created_at DESC',
        [owner],
      )
    ).rows;
  }
  async channel(owner: string, id: string, client?: PoolClient) {
    const sql =
      'SELECT * FROM youtube_channel_connections WHERE owner_id=$1 AND id=$2';
    const r = client
      ? await client.query<YoutubeChannelRow>(sql, [owner, id])
      : await this.db.query<YoutubeChannelRow>(sql, [owner, id]);
    if (!r.rows[0]) throw new NotFoundException('Canal indisponível.');
    return r.rows[0];
  }
  async publication(owner: string, id: string, client?: PoolClient) {
    const sql =
      'SELECT * FROM youtube_publications WHERE owner_id=$1 AND id=$2';
    const r = client
      ? await client.query<YoutubePublicationRow>(sql, [owner, id])
      : await this.db.query<YoutubePublicationRow>(sql, [owner, id]);
    if (!r.rows[0]) throw new NotFoundException('Publicação indisponível.');
    return r.rows[0];
  }
  async list(
    owner: string,
    channel?: string,
    status?: string,
    project?: string,
  ) {
    return (
      await this.db.query<YoutubePublicationRow>(
        'SELECT * FROM youtube_publications WHERE owner_id=$1 AND ($2::uuid IS NULL OR connection_id=$2) AND ($3::text IS NULL OR status=$3) AND ($4::uuid IS NULL OR project_id=$4) ORDER BY created_at DESC,id LIMIT 100',
        [owner, channel ?? null, status ?? null, project ?? null],
      )
    ).rows;
  }
  async existing(
    owner: string,
    key: string,
    connection: string,
    render: string,
  ) {
    return (
      await this.db.query<YoutubePublicationRow>(
        "SELECT * FROM youtube_publications WHERE owner_id=$1 AND (idempotency_key=$2 OR (connection_id=$3 AND render_job_id=$4 AND (status <> 'CANCELLED' OR session_started OR youtube_video_id IS NOT NULL))) ORDER BY (idempotency_key=$2) DESC LIMIT 1",
        [owner, key, connection, render],
      )
    ).rows[0];
  }
  async insert(
    owner: string,
    project: string,
    render: string,
    connection: string,
    target: string,
    key: string,
    snapshot: YoutubePublicationSnapshot,
  ) {
    const id = randomUUID();
    const r = await this.db.query<YoutubePublicationRow>(
      'INSERT INTO youtube_publications(id,owner_id,project_id,render_job_id,connection_id,target,idempotency_key,snapshot,thumbnail_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) ON CONFLICT DO NOTHING RETURNING *',
      [
        id,
        owner,
        project,
        render,
        connection,
        target,
        key,
        JSON.stringify(snapshot),
        target === 'YOUTUBE_SHORTS' ? 'UNSUPPORTED' : 'PENDING',
      ],
    );
    return r.rows[0] ?? (await this.existing(owner, key, connection, render));
  }
  async locked<T>(
    kind: 'channel' | 'publication',
    id: string,
    work: (client: PoolClient) => Promise<T>,
  ) {
    return this.db.withClient(async (client) => {
      const name = `youtube-${kind}:${id}`;
      const r = await client.query<{ ok: boolean }>(
        'SELECT pg_try_advisory_lock(hashtextextended($1,0)) ok',
        [name],
      );
      if (!r.rows[0].ok)
        throw new ConflictException('Operação YouTube em andamento. Aguarde.');
      try {
        return await work(client);
      } finally {
        await client.query(
          'SELECT pg_advisory_unlock(hashtextextended($1,0))',
          [name],
        );
      }
    });
  }
  async event(
    owner: string,
    operation: string,
    result: string,
    id?: string,
    code?: string,
  ) {
    await this.db.query(
      'INSERT INTO youtube_publication_events(owner_id,publication_id,operation,result,code) VALUES($1,$2,$3,$4,$5)',
      [owner, id ?? null, operation, result, code ?? null],
    );
  }
  async events(owner: string, id: string) {
    await this.publication(owner, id);
    return (
      await this.db.query(
        'SELECT operation,result,code,created_at FROM youtube_publication_events WHERE owner_id=$1 AND publication_id=$2 ORDER BY id DESC LIMIT 100',
        [owner, id],
      )
    ).rows;
  }
  async update(
    id: string,
    values: Partial<{
      status: PublicationStatus;
      session_cipher: string | null;
      session_started: boolean;
      confirmed_bytes: number;
      youtube_video_id: string;
      remote_privacy: string;
      remote_publish_at: string | null;
      thumbnail_status: string;
      cancel_requested: boolean;
      attempts: number;
      error_code: string | null;
      error_message: string | null;
      next_attempt_at: Date;
      last_checked_at: Date;
      started_at: Date;
      completed_at: Date;
    }>,
    client?: PoolClient,
  ) {
    const allowed = new Set([
      'status',
      'session_cipher',
      'session_started',
      'confirmed_bytes',
      'youtube_video_id',
      'remote_privacy',
      'remote_publish_at',
      'thumbnail_status',
      'cancel_requested',
      'attempts',
      'error_code',
      'error_message',
      'next_attempt_at',
      'last_checked_at',
      'started_at',
      'completed_at',
    ]);
    const entries = Object.entries(values);
    if (!entries.length || entries.some(([key]) => !allowed.has(key)))
      throw Error('Invalid publication update');
    const sql = `UPDATE youtube_publications SET ${entries.map(([key], i) => `${key}=$${i + 2}`).join(',')},updated_at=NOW() WHERE id=$1`;
    if (client) await client.query(sql, [id, ...entries.map(([, v]) => v)]);
    else await this.db.query(sql, [id, ...entries.map(([, v]) => v)]);
  }
  async due(owner: string) {
    return (
      await this.db.query<YoutubePublicationRow>(
        "SELECT * FROM youtube_publications WHERE owner_id=$1 AND status IN ('QUEUED','UPLOADING','PROCESSING','SCHEDULED','PRIVATE','UNLISTED','PUBLISHED') AND next_attempt_at<=NOW() ORDER BY next_attempt_at,id LIMIT 1",
        [owner],
      )
    ).rows[0];
  }
  async cancel(owner: string, id: string) {
    await this.publication(owner, id);
    await this.db.query(
      "UPDATE youtube_publications SET cancel_requested=TRUE,status=CASE WHEN NOT session_started THEN 'CANCELLED' ELSE status END,updated_at=NOW() WHERE owner_id=$1 AND id=$2 AND youtube_video_id IS NULL",
      [owner, id],
    );
  }
  async rule(owner: string, project: string) {
    await this.project(owner, project);
    return (
      (
        await this.db.query<{ settings: AutomationRule }>(
          'SELECT settings FROM youtube_automation_rules WHERE owner_id=$1 AND project_id=$2',
          [owner, project],
        )
      ).rows[0]?.settings ?? null
    );
  }
  async saveRule(owner: string, project: string, settings: AutomationRule) {
    await this.db.query(
      'INSERT INTO youtube_automation_rules(project_id,owner_id,settings) VALUES($1,$2,$3::jsonb) ON CONFLICT(project_id) DO UPDATE SET settings=EXCLUDED.settings,owner_id=EXCLUDED.owner_id,updated_at=NOW()',
      [project, owner, JSON.stringify(settings)],
    );
  }
  async rules(owner: string) {
    return (
      await this.db.query<{ project_id: string; settings: AutomationRule }>(
        "SELECT project_id,settings FROM youtube_automation_rules WHERE owner_id=$1 AND settings->>'enabled'='true'",
        [owner],
      )
    ).rows;
  }
}
