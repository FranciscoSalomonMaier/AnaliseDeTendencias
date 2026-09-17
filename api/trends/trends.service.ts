import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TrendItem } from 'src/sources/interfaces/trend-item/trend-item.interface';
import { YouTubeNormalizerService } from 'src/sources/youtube/youtube-normalizer/youtube-normalizer.service';
import { YoutubeService } from 'src/sources/youtube/youtube.service';
import { MetricsService } from './metrics/metrics.service';
import { AnalyzedTrendItem } from './interfaces/analyzed-trend-item/analyzed-trend-item.interface';
import { TopicCluster } from './interfaces/topic-cluster/topic-cluster.interface';
import { TopicClusteringService } from './topic-clustering.service';
import { AiAnalysisService } from 'src/ai/ai-analysis.service';
import { AiAnalysisCacheService } from 'src/ai/cache/ai-analysis-cache.service';
import { AiAnalysisFingerprintService } from 'src/ai/ai-analysis-fingerprint.service';
import {
  AiAnalysisResponse,
  CachedAiAnalysis,
} from 'src/ai/cache/interfaces/cached-ai-analysis.interface';

@Injectable()
export class TrendsService {
  private readonly inFlightRequests = new Map<
    string,
    Promise<AiAnalysisResponse>
  >();

  constructor(
    private readonly youtubeService: YoutubeService,
    private readonly youtubeNormalizer: YouTubeNormalizerService,
    private readonly metricsService: MetricsService,
    private readonly topicClusteringService: TopicClusteringService,
    private readonly aiAnalysisService: AiAnalysisService,
    private readonly cacheService: AiAnalysisCacheService,
    private readonly fingerprintService: AiAnalysisFingerprintService,
    private readonly configService: ConfigService,
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

  async getLatestYoutubeAiAnalysis(
    regionCode = 'BR',
  ): Promise<AiAnalysisResponse> {
    const cached = await this.cacheService.getLatest(regionCode);
    if (!cached) {
      throw new NotFoundException('Nenhuma análise com IA está disponível');
    }
    return this.toResponse(cached, true);
  }

  async generateYoutubeAiAnalysis(
    regionCode = 'BR',
    force = false,
  ): Promise<AiAnalysisResponse> {
    const clusters = await this.analyzeGroupedYoutube(regionCode);
    const fingerprint = this.fingerprintService.createFingerprint(clusters);
    const model = this.aiAnalysisService.getModel();
    const key = `youtube:${regionCode}:${model}:${fingerprint}`;

    const inFlight = this.inFlightRequests.get(key);
    if (inFlight) return inFlight;

    const request = this.executeGeneration(
      key,
      regionCode,
      model,
      fingerprint,
      clusters,
      force,
    );
    this.inFlightRequests.set(key, request);
    try {
      return await request;
    } finally {
      this.inFlightRequests.delete(key);
    }
  }

  private async executeGeneration(
    key: string,
    regionCode: string,
    model: string,
    fingerprint: string,
    clusters: TopicCluster[],
    force: boolean,
  ): Promise<AiAnalysisResponse> {
    if (!force) {
      const cached = await this.cacheService.get(key);
      if (cached) {
        await this.cacheService.save(cached);
        return this.toResponse(cached, true);
      }
    }

    const result = await this.aiAnalysisService.analyzeTopicClusters(clusters);

    const clustersMap = new Map(
      clusters.map((cluster) => [cluster.id, cluster]),
    );

    const data = result.analyses.map((analysis) => {
      const cluster = clustersMap.get(analysis.clusterId);

      if (!cluster) {
        throw new Error(`Cluster não encontrado: ${analysis.clusterId}`);
      }

      return {
        cluster,
        aiAnalysis: analysis,
      };
    });
    const generatedAt = new Date();
    const cached = await this.cacheService.save({
      key,
      regionCode,
      fingerprint,
      model,
      generatedAt: generatedAt.toISOString(),
      expiresAt: new Date(
        generatedAt.getTime() + this.getTtlSeconds() * 1000,
      ).toISOString(),
      result: data,
    });
    return this.toResponse(cached, false);
  }

  private getTtlSeconds(): number {
    const value = Number(
      this.configService.get<string>('AI_ANALYSIS_CACHE_TTL_SECONDS'),
    );
    return Number.isInteger(value) && value >= 60 && value <= 86400
      ? value
      : 1800;
  }

  private toResponse(
    cached: CachedAiAnalysis,
    reused: boolean,
  ): AiAnalysisResponse {
    return {
      data: cached.result,
      meta: {
        regionCode: cached.regionCode,
        model: cached.model,
        generatedAt: cached.generatedAt,
        expiresAt: cached.expiresAt,
        cached: reused,
        fingerprint: cached.fingerprint,
      },
    };
  }
}
