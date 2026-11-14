import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { VideoRemixRepository } from './video-remix.repository';
import {
  VideoDiscoveryProvider,
  searchSchema,
  type DiscoveredVideo,
} from './discovery.schema';
@Injectable()
export class RemixDiscoveryService {
  constructor(
    private readonly repo: VideoRemixRepository,
    private readonly provider: VideoDiscoveryProvider,
    private readonly config: ConfigService,
  ) {}
  private key(owner: string, identity: unknown) {
    return createHash('sha256')
      .update(
        JSON.stringify({
          owner,
          provider: this.provider.getProviderName(),
          identity,
        }),
      )
      .digest('hex');
  }
  private async cached<T>(
    owner: string,
    identity: unknown,
    fetcher: () => Promise<T>,
  ): Promise<T> {
    const key = this.key(owner, identity);
    return this.repo.db.withClient(async (c) => {
      const lock = await c.query<{ ok: boolean }>(
        'SELECT pg_try_advisory_lock(hashtextextended($1,0)) ok',
        ['remix-discovery:' + key],
      );
      if (!lock.rows[0].ok)
        throw new ConflictException(
          'Esta consulta está em andamento. Aguarde e tente novamente.',
        );
      try {
        const cached = await c.query<{ payload: T }>(
          'SELECT payload FROM video_remix_discovery_cache WHERE cache_key=$1 AND expires_at>NOW()',
          [key],
        );
        if (cached.rows[0]) return cached.rows[0].payload;
        const window = Math.floor(Date.now() / 60000);
        const limit = Math.max(
          1,
          Math.min(
            30,
            Number(this.config.get('VIDEO_REMIX_SEARCH_PER_MINUTE')) || 10,
          ),
        );
        const rate = await c.query(
          'INSERT INTO video_remix_discovery_rate(owner_id,window_at,hits) VALUES($1,$2,1) ON CONFLICT(owner_id,window_at) DO UPDATE SET hits=video_remix_discovery_rate.hits+1 WHERE video_remix_discovery_rate.hits<$3 RETURNING hits',
          [owner, window, limit],
        );
        if (!rate.rowCount)
          throw new HttpException(
            'Limite local de consultas atingido. Aguarde um minuto.',
            429,
          );
        const result = await fetcher();
        await c.query(
          "INSERT INTO video_remix_discovery_cache(cache_key,payload,expires_at) VALUES($1,$2::jsonb,NOW()+INTERVAL '15 minutes') ON CONFLICT(cache_key) DO UPDATE SET payload=EXCLUDED.payload,expires_at=EXCLUDED.expires_at",
          [key, JSON.stringify(result)],
        );
        return result;
      } finally {
        await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [
          'remix-discovery:' + key,
        ]);
      }
    });
  }
  async search(owner: string, input: unknown) {
    const p = searchSchema.safeParse(input);
    if (!p.success)
      throw new BadRequestException(
        'Pesquisa inválida. Informe termo, quantidade de 1–25, idioma e filtros válidos.',
      );
    return this.cached(owner, p.data, async () => {
      const result = await this.provider.search(p.data);
      for (const video of result.items)
        await this.repo.db.query(
          "INSERT INTO video_remix_discovery_cache(cache_key,payload,expires_at) VALUES($1,$2::jsonb,NOW()+INTERVAL '15 minutes') ON CONFLICT(cache_key) DO UPDATE SET payload=EXCLUDED.payload,expires_at=EXCLUDED.expires_at",
          [
            this.key(owner, { videoId: video.externalId }),
            JSON.stringify(video),
          ],
        );
      return result;
    });
  }
  async details(owner: string, id: string): Promise<DiscoveredVideo> {
    if (!/^[\w-]{11}$/.test(id))
      throw new BadRequestException('Identificador de vídeo inválido.');
    return this.cached(owner, { videoId: id }, () =>
      this.provider.getVideoDetails(id),
    );
  }
}
