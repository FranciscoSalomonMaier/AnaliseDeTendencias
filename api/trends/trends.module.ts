import { Module } from '@nestjs/common';
import { TrendsService } from './trends.service';
import { TrendsController } from './trends.controller';
import { MetricsService } from './metrics/metrics.service';
import { YoutubeModule } from 'src/sources/youtube/youtube.module';
import { TopicClusteringService } from './topic-clustering.service';

@Module({
  imports: [YoutubeModule],
  controllers: [TrendsController],
  providers: [TrendsService, MetricsService, TopicClusteringService],
  exports: [TrendsService, MetricsService],
})
export class TrendsModule {}
