export const VIDEO_PERIOD_SQL = `
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
WHERE r.region_code = $1`;

export const RANKING_SQL = `${VIDEO_PERIOD_SQL}
ORDER BY GREATEST(c.view_count - COALESCE(b.view_count, c.view_count), 0) DESC, v.id ASC
LIMIT 50`;
