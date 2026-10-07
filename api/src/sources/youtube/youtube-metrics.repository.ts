import { Injectable } from '@nestjs/common';
import { PostgresDatabaseService } from '../../database/postgres-database.service';
import { YouTubeVideo } from './interfaces/youtube-video.interface';
import { COLLECTION_INTERVAL_MS, periodStart } from './youtube-period';

import { RANKING_SQL } from './youtube-period.sql';
import { TOPIC_AGGREGATION_SQL } from '../../../trends/trending-topics.sql';
import { TrendingTopic } from '../../../trends/interfaces/trending-topic.interface';

interface RankingRow extends Record<string, unknown> {
  video: YouTubeVideo;
  currentViews: string;
  baselineViews: string;
  viewsInPeriod: string;
}

@Injectable()
export class YoutubeMetricsRepository {
  constructor(private readonly database: PostgresDatabaseService) {}

  async capture(videos: YouTubeVideo[], region?: string, now = new Date()) {
    const capturedAt = new Date(
      Math.floor(now.getTime() / COLLECTION_INTERVAL_MS) *
        COLLECTION_INTERVAL_MS,
    );
    const valid = videos.filter((v) =>
      /^\d+$/.test(v.statistics?.viewCount ?? ''),
    );
    if (!valid.length) return;
    // One atomic statement, including metadata and region membership; no per-video queries.
    await this.database.query(
      `
      WITH input AS (SELECT * FROM jsonb_array_elements($1::jsonb) AS x(video)),
      saved AS (
        INSERT INTO youtube_videos(id, video)
        SELECT video->>'id', video FROM input
        ON CONFLICT(id) DO UPDATE SET video = youtube_videos.video || EXCLUDED.video RETURNING id
      ), regions AS (
        INSERT INTO youtube_video_regions(video_id, region_code)
        SELECT id, $2::text FROM saved WHERE $2::text IS NOT NULL
        ON CONFLICT DO NOTHING
      )
      INSERT INTO youtube_video_metric_snapshots(video_id, view_count, like_count, comment_count, captured_at, capture_slot)
      SELECT saved.id, (video->'statistics'->>'viewCount')::bigint,
        (video->'statistics'->>'likeCount')::bigint,
        (video->'statistics'->>'commentCount')::bigint, $3, $4
      FROM input JOIN saved ON saved.id = video->>'id'
      ON CONFLICT(video_id, capture_slot) DO UPDATE SET
        captured_at = EXCLUDED.captured_at,
        view_count = EXCLUDED.view_count, like_count = EXCLUDED.like_count,
        comment_count = EXCLUDED.comment_count
    `,
      [JSON.stringify(valid), region ?? null, now, capturedAt],
    );
  }

  async knownIds(): Promise<string[]> {
    const result = await this.database.query<{ id: string }>(
      'SELECT id FROM youtube_videos ORDER BY id',
    );
    return result.rows.map((row) => row.id);
  }

  async regions(): Promise<string[]> {
    const result = await this.database.query<{ region: string }>(
      'SELECT region_code AS region FROM youtube_collection_regions ORDER BY region',
    );
    return result.rows.map((row) => row.region);
  }

  async persistedTopics(region: string) {
    await this.database.query(
      'INSERT INTO youtube_collection_regions(region_code) VALUES($1) ON CONFLICT DO NOTHING',
      [region],
    );
    const result = await this.database.query<{
      video_id: string;
      topic_id: string;
      name: string;
      keywords: string[];
      primary_topic?: string;
      canonical_key?: string;
      entities?: string[];
      confidence?: number;
    }>(
      `SELECT m.video_id, m.topic_id::text, t.name, t.keywords, t.primary_topic, t.canonical_key, t.entities, t.confidence
      FROM youtube_video_topics m JOIN youtube_semantic_topics t ON t.id=m.topic_id
      WHERE m.region_code=$1 ORDER BY m.video_id`,
      [region],
    );
    return result.rows;
  }

  async topicCandidates(region: string): Promise<YouTubeVideo[]> {
    await this.database.query(
      'INSERT INTO youtube_collection_regions(region_code) VALUES($1) ON CONFLICT DO NOTHING',
      [region],
    );
    const result = await this.database.query<{ video: YouTubeVideo }>(
      `
      SELECT v.video FROM youtube_video_regions r
      JOIN youtube_videos v ON v.id = r.video_id
      WHERE r.region_code = $1 AND EXISTS (
        SELECT 1 FROM youtube_video_metric_snapshots s WHERE s.video_id = v.id
      ) ORDER BY v.id
    `,
      [region],
    );
    return result.rows.map((row) => row.video);
  }

  async aggregateTopics(
    region: string,
    start: Date,
    now: Date,
    memberships: Array<{ video_id: string; topic_id: string }>,
    limit: number,
  ): Promise<Array<Omit<TrendingTopic, 'name' | 'keywords' | 'period'>>> {
    const result = await this.database.query<
      Omit<TrendingTopic, 'name' | 'keywords' | 'period'> &
        Record<string, unknown>
    >(TOPIC_AGGREGATION_SQL, [
      region,
      start,
      now,
      JSON.stringify(memberships),
      limit,
    ]);
    return result.rows;
  }

  async ranking(region: string, period: string, now = new Date()) {
    const start = periodStart(period, now);
    await this.database.query(
      'INSERT INTO youtube_collection_regions(region_code) VALUES($1) ON CONFLICT DO NOTHING',
      [region],
    );
    const result = await this.database.query<RankingRow>(RANKING_SQL, [
      region,
      start,
      now,
    ]);
    return result.rows.map(({ video, ...metrics }) => ({
      ...video,
      ...metrics,
      period,
      requestedPeriod: period,
      periodStartedAt: start,
    }));
  }
}
