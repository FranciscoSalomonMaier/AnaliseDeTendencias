import { Injectable } from '@nestjs/common';
import { PostgresDatabaseService } from '../../database/postgres-database.service';
import { YouTubeVideo } from './interfaces/youtube-video.interface';
import { COLLECTION_INTERVAL_MS, periodStart } from './youtube-period';

export const RANKING_SQL = `
SELECT v.video, c.view_count::text AS "currentViews",
 COALESCE(b.view_count, c.view_count)::text AS "baselineViews",
 GREATEST(c.view_count - COALESCE(b.view_count, c.view_count), 0)::text AS "viewsInPeriod",
 c.captured_at AS "capturedAt", COALESCE(b.captured_at, c.captured_at) AS "baselineCapturedAt",
 EXTRACT(EPOCH FROM c.captured_at - COALESCE(b.captured_at, c.captured_at))::float8 AS "actualHistorySeconds",
 (COALESCE(b.captured_at, c.captured_at) <= $2::timestamptz + interval '1 hour'
  AND c.captured_at >= $3::timestamptz - interval '1 hour'
  AND c.captured_at > COALESCE(b.captured_at, c.captured_at)) AS "hasFullPeriodData"
FROM youtube_video_regions r
JOIN youtube_videos v ON v.id = r.video_id
JOIN LATERAL (
 SELECT view_count, captured_at FROM youtube_video_metric_snapshots
 WHERE video_id = v.id AND captured_at <= $3
 ORDER BY captured_at DESC LIMIT 1
) c ON true
LEFT JOIN LATERAL (
 SELECT view_count, captured_at FROM youtube_video_metric_snapshots
 WHERE video_id = v.id AND captured_at >= $2 AND captured_at <= c.captured_at
 ORDER BY captured_at ASC LIMIT 1
) b ON true
WHERE r.region_code = $1
ORDER BY GREATEST(c.view_count - COALESCE(b.view_count, c.view_count), 0) DESC, v.id ASC
LIMIT 50`;

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
