import { Injectable } from '@nestjs/common';
import { TrendItem } from 'src/sources/interfaces/trend-item/trend-item.interface';
import { YouTubeNormalizerService } from 'src/sources/youtube/youtube-normalizer/youtube-normalizer.service';
import { YoutubeService } from 'src/sources/youtube/youtube.service';
import { MetricsService } from './metrics/metrics.service';
import { AnalyzedTrendItem } from './interfaces/analyzed-trend-item/analyzed-trend-item.interface';
import { TopicCluster } from './interfaces/topic-cluster/topic-cluster.interface';
import { TopicClusteringService } from './topic-clustering.service';

@Injectable()
export class TrendsService {
  constructor(
    private readonly youtubeService: YoutubeService,
    private readonly youtubeNormalizer: YouTubeNormalizerService,
    private readonly metricsService: MetricsService,
    private readonly topicClusteringService: TopicClusteringService,
  ) {}

  async collectYouTubeTrends(): Promise<TrendItem[]> {
    const videos = await this.youtubeService.getPopularVideos('BR');

    return this.youtubeNormalizer.normalizeMany(videos);
  }

  async analyzeYoutube(regionCode = 'BR'): Promise<AnalyzedTrendItem[]> {
    const normalizedVideos =
      await this.youtubeService.getNormalizedPopularVideos(regionCode);

    return this.metricsService.calculateMany(normalizedVideos);
  }

  async analyzeGroupedYoutube(regionCode = 'BR'): Promise<TopicCluster[]> {
    const analyzedItems = await this.analyzeYoutube(regionCode);

    return this.topicClusteringService.groupByTopic(analyzedItems);
  }
}
