import { QueryResultRow } from 'pg';
import { PostgresDatabaseService } from '../../src/database/postgres-database.service';

interface FakeRow extends QueryResultRow {
  cache_key: string;
  region_code: string;
  fingerprint: string;
  model: string;
  generated_at: Date;
  expires_at: Date;
  last_accessed_at: Date;
  result: unknown;
}

export function createFakeDatabase() {
  const entries = new Map<string, FakeRow>();
  const query = jest.fn(async (sql: string, values: unknown[] = []) => {
    await Promise.resolve();
    if (sql.includes('DELETE FROM ai_analyses')) {
      for (const [key, entry] of entries) {
        if (entry.expires_at.getTime() <= Date.now()) entries.delete(key);
      }
      return { rows: [] };
    }
    if (sql.includes('INSERT INTO ai_analyses')) {
      const [key, region, fingerprint, model, generatedAt, expiresAt, result] =
        values;
      entries.set(String(key), {
        cache_key: String(key),
        region_code: String(region),
        fingerprint: String(fingerprint),
        model: String(model),
        generated_at: new Date(String(generatedAt)),
        expires_at: new Date(String(expiresAt)),
        last_accessed_at: new Date(),
        result: JSON.parse(String(result)) as unknown,
      });
      return { rows: [] };
    }
    if (sql.includes('WHERE cache_key')) {
      const entry = entries.get(String(values[0]));
      return { rows: entry ? [entry] : [] };
    }
    if (sql.includes('WHERE region_code')) {
      const entry = [...entries.values()]
        .filter((row) => row.region_code === values[0])
        .sort(
          (a, b) => b.last_accessed_at.getTime() - a.last_accessed_at.getTime(),
        )[0];
      return { rows: entry ? [entry] : [] };
    }
    throw new Error(`Unexpected test SQL: ${sql}`);
  });

  return {
    entries,
    query,
    database: { query } as unknown as PostgresDatabaseService,
  };
}
