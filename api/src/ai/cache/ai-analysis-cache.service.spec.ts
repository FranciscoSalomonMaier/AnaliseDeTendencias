import { AiAnalysisCacheService } from './ai-analysis-cache.service';
import { CachedAiAnalysis } from './interfaces/cached-ai-analysis.interface';
import { createFakeDatabase } from '../../../test/support/fake-postgres-database';

jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));

const entry = (expiresAt: string): CachedAiAnalysis => ({
  key: 'youtube:BR:model:fingerprint',
  regionCode: 'BR',
  model: 'model',
  fingerprint: 'fingerprint',
  generatedAt: new Date().toISOString(),
  expiresAt,
  result: [],
});

describe('AiAnalysisCacheService', () => {
  it('stores and retrieves the latest unexpired result', async () => {
    const { database } = createFakeDatabase();
    const cache = new AiAnalysisCacheService(database);
    const saved = entry(new Date(Date.now() + 60_000).toISOString());
    await cache.save(saved);
    expect(await cache.get(saved.key)).toEqual(saved);
    expect(await cache.getLatest('BR')).toEqual(saved);
    expect(await cache.getLatest('US')).toBeUndefined();
  });

  it('removes expired entries', async () => {
    const { database } = createFakeDatabase();
    const cache = new AiAnalysisCacheService(database);
    const saved = entry(new Date(Date.now() - 1000).toISOString());
    await cache.save(saved);
    expect(await cache.get(saved.key)).toBeUndefined();
    expect(await cache.getLatest('BR')).toBeUndefined();
  });

  it('persists across service restarts when the database survives', async () => {
    const { database } = createFakeDatabase();
    const first = new AiAnalysisCacheService(database);
    const saved = entry(new Date(Date.now() + 60_000).toISOString());
    await first.save(saved);
    expect(await new AiAnalysisCacheService(database).getLatest('BR')).toEqual(
      saved,
    );
  });
});
