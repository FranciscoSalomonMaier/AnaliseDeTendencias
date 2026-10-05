BEGIN;
CREATE TABLE IF NOT EXISTS youtube_collection_regions (region_code TEXT PRIMARY KEY);
INSERT INTO youtube_collection_regions VALUES ('BR') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS youtube_videos (
  id TEXT PRIMARY KEY,
  video JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS youtube_video_regions (
  video_id TEXT NOT NULL REFERENCES youtube_videos(id),
  region_code TEXT NOT NULL,
  PRIMARY KEY(region_code, video_id)
);
CREATE TABLE IF NOT EXISTS youtube_video_metric_snapshots (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES youtube_videos(id),
  view_count BIGINT NOT NULL CHECK(view_count >= 0),
  like_count BIGINT CHECK(like_count >= 0),
  comment_count BIGINT CHECK(comment_count >= 0),
  captured_at TIMESTAMPTZ NOT NULL,
  capture_slot TIMESTAMPTZ NOT NULL,
  UNIQUE(video_id, capture_slot)
);
CREATE INDEX IF NOT EXISTS youtube_snapshots_video_time_idx
  ON youtube_video_metric_snapshots(video_id, captured_at);
CREATE INDEX IF NOT EXISTS youtube_snapshots_captured_idx
  ON youtube_video_metric_snapshots(captured_at);
COMMIT;
