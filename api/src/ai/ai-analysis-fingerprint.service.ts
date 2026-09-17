import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { TopicCluster } from 'trends/interfaces/topic-cluster/topic-cluster.interface';

@Injectable()
export class AiAnalysisFingerprintService {
  createFingerprint(clusters: TopicCluster[]): string {
    const canonical = clusters
      .map((cluster) => ({
        id: cluster.id,
        topic: cluster.topic,
        keywords: [...cluster.keywords].sort(),
        categories: [...cluster.categories].sort(),
        sources: [...cluster.sources].sort(),
        isRecurringTopic: cluster.isRecurringTopic,
        relevanceScore: this.number(cluster.relevanceScore),
        metrics: {
          itemCount: cluster.metrics.itemCount,
          totalViews: this.number(cluster.metrics.totalViews),
          totalLikes: this.number(cluster.metrics.totalLikes),
          totalComments: this.number(cluster.metrics.totalComments),
          averageEngagementRate: this.number(
            cluster.metrics.averageEngagementRate,
          ),
          averageViewsPerHour: this.number(cluster.metrics.averageViewsPerHour),
          highestTrendScore: this.number(cluster.metrics.highestTrendScore),
          averageTrendScore: this.number(cluster.metrics.averageTrendScore),
        },
        items: cluster.items
          .map((item) => ({
            externalId: item.externalId,
            title: item.title,
            author: item.author,
            publishedAt: item.publishedAt.toISOString(),
            category: item.category ?? '',
            tags: [...item.tags].sort(),
            metrics: {
              views: this.number(item.metrics.views ?? 0),
              likes: this.number(item.metrics.likes ?? 0),
              comments: this.number(item.metrics.comments ?? 0),
            },
            trendScore: this.number(item.calculatedMetrics.trendScore),
          }))
          .sort((first, second) =>
            first.externalId.localeCompare(second.externalId),
          ),
      }))
      .sort((first, second) => first.id.localeCompare(second.id));

    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  }

  private number(value: number): number {
    return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
  }
}
