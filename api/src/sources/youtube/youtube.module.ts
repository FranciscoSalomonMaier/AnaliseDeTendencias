import { Module } from '@nestjs/common';
import { YoutubeService } from './youtube.service';
import { YoutubeController } from './youtube.controller';
import { YouTubeNormalizerService } from './youtube-normalizer/youtube-normalizer.service';

import { PostgresDatabaseService } from '../../database/postgres-database.service';
import { YoutubeMetricsRepository } from './youtube-metrics.repository';
import { YoutubeCollector } from './youtube-collector';

@Module({
  providers: [
    YoutubeService,
    YouTubeNormalizerService,
    PostgresDatabaseService,
    YoutubeMetricsRepository,
    YoutubeCollector,
  ],
  controllers: [YoutubeController],
  exports: [YoutubeService, YouTubeNormalizerService, YoutubeMetricsRepository],
})
export class YoutubeModule {}
