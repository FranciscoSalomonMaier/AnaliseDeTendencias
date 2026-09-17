import { Injectable } from '@nestjs/common';
import { QueryResultRow } from 'pg';
import { PostgresDatabaseService } from 'src/database/postgres-database.service';
import { AiAnalyzedTopicCluster } from 'trends/interfaces/ai-analyzed-topic-cluster/ai-analyzed-topic-cluster.interface';
import { CachedAiAnalysis } from './interfaces/cached-ai-analysis.interface';

interface AnalysisRow extends QueryResultRow {
  cache_key: string;
  region_code: string;
  fingerprint: string;
  model: string;
  generated_at: Date;
  expires_at: Date;
  result: AiAnalyzedTopicCluster[];
}

@Injectable()
export class AiAnalysisCacheService {
  constructor(private readonly database: PostgresDatabaseService) {}

  async get(key: string): Promise<CachedAiAnalysis | undefined> {
    await this.removeExpired();
    const rows = await this.database.query<AnalysisRow>(
      `SELECT * FROM ai_analyses WHERE cache_key = $1 AND expires_at > NOW()`,
      [key],
    );
    return rows.rows[0] ? this.toEntry(rows.rows[0]) : undefined;
  }

  async getLatest(regionCode: string): Promise<CachedAiAnalysis | undefined> {
    await this.removeExpired();
    const rows = await this.database.query<AnalysisRow>(
      `SELECT * FROM ai_analyses
       WHERE region_code = $1 AND expires_at > NOW()
       ORDER BY last_accessed_at DESC LIMIT 1`,
      [regionCode],
    );
    return rows.rows[0] ? this.toEntry(rows.rows[0]) : undefined;
  }

  async save(entry: CachedAiAnalysis): Promise<CachedAiAnalysis> {
    await this.database.query(
      `INSERT INTO ai_analyses
       (cache_key, region_code, fingerprint, model, generated_at, expires_at, result)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT (cache_key) DO UPDATE SET
         region_code = EXCLUDED.region_code,
         fingerprint = EXCLUDED.fingerprint,
         model = EXCLUDED.model,
         generated_at = EXCLUDED.generated_at,
         expires_at = EXCLUDED.expires_at,
         result = EXCLUDED.result,
         last_accessed_at = NOW()`,
      [
        entry.key,
        entry.regionCode,
        entry.fingerprint,
        entry.model,
        entry.generatedAt,
        entry.expiresAt,
        JSON.stringify(entry.result),
      ],
    );
    return entry;
  }

  private async removeExpired(): Promise<void> {
    await this.database.query(
      `DELETE FROM ai_analyses WHERE expires_at <= NOW()`,
    );
  }

  private toEntry(row: AnalysisRow): CachedAiAnalysis {
    return {
      key: row.cache_key,
      regionCode: row.region_code.trim(),
      fingerprint: row.fingerprint.trim(),
      model: row.model,
      generatedAt: row.generated_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      result: row.result.map(({ cluster, aiAnalysis }) => ({
        aiAnalysis,
        cluster: {
          ...cluster,
          items: cluster.items.map((item) => ({
            ...item,
            publishedAt: new Date(item.publishedAt),
            collectedAt: new Date(item.collectedAt),
          })),
        },
      })),
    };
  }
}
