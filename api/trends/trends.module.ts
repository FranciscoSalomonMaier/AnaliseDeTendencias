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

import { TrendingTopicsService } from './trending-topics.service';
import { TrendingTopicsController } from './trending-topics.controller';

import { SemanticTopicsProcessor } from './semantic/semantic-topics.processor';
import { SemanticTopicsRepository } from './semantic/semantic-topics.repository';
import { SemanticTextBuilder } from './semantic/semantic-text.builder';
import { TopicEntitiesService } from './semantic/topic-entities.service';
import { TopicNamingService } from './semantic/topic-naming.service';

@Module({
  imports: [YoutubeModule, AiModule],
  controllers: [
    TrendsController,
    ContentGenerationController,
    TrendingTopicsController,
  ],
  providers: [
    TrendsService,
    TrendingTopicsService,
    SemanticTopicsProcessor,
    SemanticTopicsRepository,
    SemanticTextBuilder,
    TopicEntitiesService,
    TopicNamingService,
    MetricsService,
    TopicClusteringService,
    ContentGenerationService,
    ContentGenerationRepository,
  ],
  exports: [TrendsService, MetricsService],
})
export class TrendsModule {}
