import { Module } from '@nestjs/common';
import { TrendsService } from './trends.service';
import { TrendsController } from './trends.controller';
import { MetricsService } from './metrics/metrics.service';
import { YoutubeModule } from 'src/sources/youtube/youtube.module';
import { TopicClusteringService } from './topic-clustering.service';
import { AiModule } from 'src/ai/ai.module';
import { ContentGenerationService } from './content-generation.service';
import { ContentGenerationController } from './content-generation.controller';
import { ContentGenerationRepository } from './content-generation.repository';

@Module({
  imports: [YoutubeModule, AiModule],
  controllers: [TrendsController, ContentGenerationController],
  providers: [
    TrendsService,
    MetricsService,
    TopicClusteringService,
    ContentGenerationService,
    ContentGenerationRepository,
  ],
  exports: [TrendsService, MetricsService],
})
export class TrendsModule {}
