import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

@Injectable()
export class PostgresDatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly pool: Pool;

  constructor(configService: ConfigService) {
    const connectionString = configService.get<string>('DATABASE_URL');
    if (!connectionString) {
      throw new Error('DATABASE_URL não está configurada');
    }
    this.pool = new Pool({
      connectionString,
      max: 10,
      connectionTimeoutMillis: 5_000,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ai_analyses (
        cache_key TEXT PRIMARY KEY,
        region_code CHAR(2) NOT NULL,
        fingerprint CHAR(64) NOT NULL,
        model TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'openai',
        usage JSONB NOT NULL DEFAULT '{"inputTokens":0,"outputTokens":0,"totalTokens":0}'::jsonb,
        generated_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        result JSONB NOT NULL
      )
    `);
    await this.pool.query(`
      ALTER TABLE ai_analyses
      ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'openai',
      ADD COLUMN IF NOT EXISTS usage JSONB NOT NULL DEFAULT '{"inputTokens":0,"outputTokens":0,"totalTokens":0}'::jsonb
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS ai_analyses_latest_idx
      ON ai_analyses (region_code, last_accessed_at DESC)
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS content_generation_runs (
        generation_id UUID PRIMARY KEY,
        trend_id TEXT NOT NULL,
        region_code CHAR(2) NOT NULL,
        language TEXT NOT NULL,
        trend_snapshot JSONB NOT NULL,
        ideas JSONB NOT NULL,
        selected_idea JSONB,
        script JSONB,
        video_plan JSONB,
        production_approved BOOLEAN NOT NULL DEFAULT FALSE,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await this.pool.query(`
      ALTER TABLE content_generation_runs
      ADD COLUMN IF NOT EXISTS production_approved BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS content_generation_runs_trend_idx
      ON content_generation_runs (trend_id, region_code, created_at DESC)
    `);
  }

  async withClient<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await work(client);
    } finally {
      client.release();
    }
  }

  query<T extends QueryResultRow>(
    sql: string,
    values: unknown[] = [],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(sql, values);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
