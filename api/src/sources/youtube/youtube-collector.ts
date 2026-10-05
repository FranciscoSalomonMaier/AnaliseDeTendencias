import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { YoutubeService } from './youtube.service';
import { YoutubeMetricsRepository } from './youtube-metrics.repository';
import { COLLECTION_INTERVAL_MS } from './youtube-period';

@Injectable()
export class YoutubeCollector
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly logger = new Logger(YoutubeCollector.name);
  constructor(
    private readonly youtube: YoutubeService,
    private readonly metrics: YoutubeMetricsRepository,
  ) {}
  onApplicationBootstrap() {
    void this.collect();
    this.timer = setInterval(() => void this.collect(), COLLECTION_INTERVAL_MS);
    this.timer.unref();
  }
  async collect() {
    if (this.running) return;
    this.running = true;
    try {
      const captured = new Set<string>();
      for (const region of await this.metrics.regions()) {
        const videos = await this.youtube.getPopularVideos(region);
        videos.forEach((video) => captured.add(video.id));
      }
      await this.youtube.refreshKnownVideos(captured);
    } catch (error: unknown) {
      const missingTable =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '42P01';
      this.logger.error(
        missingTable
          ? 'Tabelas de snapshots ausentes. Execute npm run migrate:youtube na pasta api e reinicie a API.'
          : 'Falha na coleta de snapshots. Verifique a conexão e a quota da API.',
        error,
      );
    } finally {
      this.running = false;
    }
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
