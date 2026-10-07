BEGIN;
CREATE TABLE IF NOT EXISTS youtube_video_embeddings (
 video_id TEXT NOT NULL REFERENCES youtube_videos(id),
 model TEXT NOT NULL,
 source_hash TEXT NOT NULL,
 vector DOUBLE PRECISION[] NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(video_id, model),
 CHECK(array_length(vector,1) > 0)
);
CREATE TABLE IF NOT EXISTS youtube_semantic_topics (
 id UUID PRIMARY KEY,
 region_code TEXT NOT NULL,
 model TEXT NOT NULL,
 name TEXT NOT NULL,
 keywords TEXT[] NOT NULL DEFAULT '{}',
 entities TEXT[] NOT NULL DEFAULT '{}',
 centroid DOUBLE PRECISION[] NOT NULL,
 naming_source TEXT NOT NULL,
 naming_hash TEXT NOT NULL,
 member_ids TEXT[] NOT NULL,
 retry_after TIMESTAMPTZ,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS youtube_semantic_topics_region_idx ON youtube_semantic_topics(region_code, model);
CREATE TABLE IF NOT EXISTS youtube_video_topics (
 region_code TEXT NOT NULL,
 video_id TEXT NOT NULL REFERENCES youtube_videos(id),
 topic_id UUID NOT NULL REFERENCES youtube_semantic_topics(id),
 source_hash TEXT NOT NULL,
 PRIMARY KEY(region_code, video_id)
);
CREATE INDEX IF NOT EXISTS youtube_video_topics_topic_idx ON youtube_video_topics(topic_id);
CREATE TABLE IF NOT EXISTS youtube_semantic_processing_runs (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 region_code TEXT NOT NULL,
 model TEXT NOT NULL,
 threshold DOUBLE PRECISION NOT NULL,
 diagnostics JSONB NOT NULL,
 embedding_usage JSONB NOT NULL,
 naming_usage JSONB NOT NULL,
 captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMIT;
