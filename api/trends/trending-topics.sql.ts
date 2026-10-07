import { VIDEO_PERIOD_SQL } from '../src/sources/youtube/youtube-period.sql';

export const TOPIC_AGGREGATION_SQL = `
WITH measurements AS (${VIDEO_PERIOD_SQL}),
-- One membership per video, even if malformed input repeats an ID.
membership AS (
 SELECT DISTINCT ON (video_id) video_id, topic_id
 FROM jsonb_to_recordset($4::jsonb) AS x(video_id text, topic_id text)
 ORDER BY video_id, topic_id
), members AS (
 SELECT m.*, t.topic_id,
 ROW_NUMBER() OVER (
   PARTITION BY t.topic_id ORDER BY m."viewsInPeriod"::bigint DESC, m.video->>'id'
 ) AS video_rank
 FROM measurements m JOIN membership t ON t.video_id = m.video->>'id'
)
SELECT topic_id AS id,
 COUNT(*)::int AS "videoCount",
 SUM("currentViews"::numeric)::text AS "totalViews",
 SUM("viewsInPeriod"::numeric)::text AS "viewsInPeriod",
 BOOL_AND("hasFullPeriodData") AS "hasFullPeriodData",
 MIN("actualHistorySeconds") AS "actualHistorySeconds",
 MAX("actualHistorySeconds") AS "maxHistorySeconds",
 MIN("capturedAt") AS "capturedAt",
 JSONB_AGG(jsonb_build_object(
   'id', video->>'id', 'title', video->'snippet'->>'title',
   'channelTitle', video->'snippet'->>'channelTitle',
   'thumbnail', video->'snippet'->'thumbnails'->'high'->>'url',
   'currentViews', "currentViews", 'baselineViews', "baselineViews",
   'viewsInPeriod', "viewsInPeriod", 'capturedAt', "capturedAt",
   'baselineCapturedAt', "baselineCapturedAt",
   'actualHistorySeconds', "actualHistorySeconds",
   'hasFullPeriodData', "hasFullPeriodData"
 ) ORDER BY video_rank) FILTER (WHERE video_rank <= 5) AS "topVideos"
FROM members GROUP BY topic_id
ORDER BY SUM("viewsInPeriod"::numeric) DESC, topic_id ASC
LIMIT $5`;
