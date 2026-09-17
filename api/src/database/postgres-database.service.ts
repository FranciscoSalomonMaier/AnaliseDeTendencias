import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, QueryResult, QueryResultRow } from 'pg';

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
        generated_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        result JSONB NOT NULL
      )
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS ai_analyses_latest_idx
      ON ai_analyses (region_code, last_accessed_at DESC)
    `);
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
