import { BadRequestException, Injectable } from '@nestjs/common';
import { YoutubeMetricsRepository } from '../src/sources/youtube/youtube-metrics.repository';
import {
  periodStart,
  YoutubePeriod,
} from '../src/sources/youtube/youtube-period';

@Injectable()
export class TrendingTopicsService {
  constructor(private readonly metrics: YoutubeMetricsRepository) {}

  async getTrending(region = 'BR', period = 'today', limit = 20) {
    const now = new Date();
    const start = periodStart(period, now);
    if (!/^[A-Z]{2}$/.test(region))
      throw new BadRequestException('Região inválida');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException('limit deve ser inteiro entre 1 e 100');
    }
    const persisted = await this.metrics.persistedTopics(region);
    const memberships = persisted.map(({ video_id, topic_id }) => ({
      video_id,
      topic_id,
    }));
    const aggregates = memberships.length
      ? await this.metrics.aggregateTopics(
          region,
          start,
          now,
          memberships,
          limit,
        )
      : [];
    const descriptors = new Map(
      persisted.map((topic) => [topic.topic_id, topic]),
    );
    return {
      period: period as YoutubePeriod,
      regionCode: region,
      periodStartedAt: start.toISOString(),
      topics: aggregates.map((aggregate) => {
        const topic = descriptors.get(aggregate.id)!;
        return {
          ...aggregate,
          name: topic.name,
          primaryTopic: topic.primary_topic ?? null,
          canonicalKey: topic.canonical_key ?? null,
          entities: topic.entities ?? [],
          confidence: topic.confidence ?? null,
          keywords: topic.keywords.slice(0, 5),
          period: period as YoutubePeriod,
        };
      }),
    };
  }
}
