import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { PostgresDatabaseService } from '../../src/database/postgres-database.service';
import { YouTubeVideo } from '../../src/sources/youtube/interfaces/youtube-video.interface';
import type { TopicName } from './topic-naming.service';
import { StoredTopic } from './semantic-topic.interface';
import { LlmUsage } from '../../src/ai/llm.provider';

export interface SavedEmbedding {
  video_id: string;
  source_hash: string;
  vector: number[];
}
export interface TopicPublication {
  id: string;
  name: string;
  classification_cache?: Record<
    string,
    TopicName & { retryAfter?: string | null }
  >;
  primary_topic?: string | null;
  canonical_key?: string | null;
  confidence?: number | null;
  keywords: string[];
  entities: string[];
  centroid: number[];
  naming_source: string;
  naming_hash: string;
  member_ids: string[];
  retry_after: Date | null;
}
@Injectable()
export class SemanticTopicsRepository {
  constructor(private readonly database: PostgresDatabaseService) {}
  async exclusive<T>(
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T | null> {
    return this.database.withClient(async (client) => {
      const lock = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock(741239810) AS locked',
      );
      if (!lock.rows[0].locked) return null;
      try {
        return await work(client);
      } finally {
        await client.query('SELECT pg_advisory_unlock(741239810)');
      }
    });
  }
  async regions(client: PoolClient) {
    return (
      await client.query<{ region_code: string }>(
        'SELECT region_code FROM youtube_collection_regions ORDER BY region_code',
      )
    ).rows.map((r) => r.region_code);
  }
  async videos(client: PoolClient, region: string): Promise<YouTubeVideo[]> {
    return (
      await client.query<{ video: YouTubeVideo }>(
        `SELECT v.video FROM youtube_videos v JOIN youtube_video_regions r ON v.id=r.video_id WHERE r.region_code=$1 ORDER BY v.id`,
        [region],
      )
    ).rows.map((r) => r.video);
  }
  async embeddings(
    client: PoolClient,
    ids: string[],
    model: string,
  ): Promise<SavedEmbedding[]> {
    return (
      await client.query<SavedEmbedding>(
        'SELECT video_id, source_hash, vector FROM youtube_video_embeddings WHERE video_id=ANY($1::text[]) AND model=$2',
        [ids, model],
      )
    ).rows;
  }
  async saveEmbeddings(
    client: PoolClient,
    embeddings: SavedEmbedding[],
    model: string,
  ) {
    await client.query(
      `INSERT INTO youtube_video_embeddings(video_id,model,source_hash,vector)
      SELECT video_id,$2,source_hash,ARRAY(SELECT jsonb_array_elements_text(vector)::float8)
      FROM jsonb_to_recordset($1::jsonb) AS x(video_id text,source_hash text,vector jsonb)
      ON CONFLICT(video_id,model) DO UPDATE SET source_hash=EXCLUDED.source_hash,vector=EXCLUDED.vector,updated_at=now()`,
      [JSON.stringify(embeddings), model],
    );
  }
  async existing(
    client: PoolClient,
    region: string,
    model: string,
  ): Promise<StoredTopic[]> {
    return (
      await client.query<StoredTopic>(
        `SELECT t.* FROM youtube_semantic_topics t WHERE region_code=$1 AND model=$2
      AND EXISTS(SELECT 1 FROM youtube_video_topics m WHERE m.topic_id=t.id) ORDER BY t.id`,
        [region, model],
      )
    ).rows;
  }
  async publish(
    client: PoolClient,
    region: string,
    model: string,
    topics: TopicPublication[],
    memberships: Array<{
      video_id: string;
      topic_id: string;
      source_hash: string;
    }>,
  ) {
    await client.query('BEGIN');
    try {
      await client.query(
        `INSERT INTO youtube_semantic_topics(id,region_code,model,name,keywords,entities,centroid,naming_source,naming_hash,member_ids,retry_after,primary_topic,canonical_key,confidence,classification_cache)
        SELECT id::uuid,$2,$3,name,keywords,entities,centroid,naming_source,naming_hash,member_ids,retry_after,primary_topic,canonical_key,confidence,COALESCE(classification_cache,'{}'::jsonb)
        FROM jsonb_to_recordset($1::jsonb) AS x(id text,name text,keywords text[],entities text[],centroid float8[],naming_source text,naming_hash text,member_ids text[],retry_after timestamptz,primary_topic text,canonical_key text,confidence float8,classification_cache jsonb)
        ON CONFLICT(id) DO UPDATE SET classification_cache=EXCLUDED.classification_cache,primary_topic=EXCLUDED.primary_topic,canonical_key=EXCLUDED.canonical_key,confidence=EXCLUDED.confidence,name=EXCLUDED.name,keywords=EXCLUDED.keywords,entities=EXCLUDED.entities,centroid=EXCLUDED.centroid,naming_source=EXCLUDED.naming_source,naming_hash=EXCLUDED.naming_hash,member_ids=EXCLUDED.member_ids,retry_after=EXCLUDED.retry_after,updated_at=now()`,
        [JSON.stringify(topics), region, model],
      );
      await client.query(
        `INSERT INTO youtube_video_topics(region_code,video_id,topic_id,source_hash)
        SELECT $2,video_id,topic_id::uuid,source_hash FROM jsonb_to_recordset($1::jsonb) AS x(video_id text,topic_id text,source_hash text)
        ON CONFLICT(region_code,video_id) DO UPDATE SET topic_id=EXCLUDED.topic_id,source_hash=EXCLUDED.source_hash`,
        [JSON.stringify(memberships), region],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
  async record(
    client: PoolClient,
    region: string,
    model: string,
    threshold: number,
    diagnostics: unknown,
    embeddingUsage: LlmUsage,
    namingUsage: LlmUsage,
  ) {
    await client.query(
      'INSERT INTO youtube_semantic_processing_runs(region_code,model,threshold,diagnostics,embedding_usage,naming_usage) VALUES($1,$2,$3,$4,$5,$6)',
      [
        region,
        model,
        threshold,
        JSON.stringify(diagnostics),
        JSON.stringify(embeddingUsage),
        JSON.stringify(namingUsage),
      ],
    );
  }
}
