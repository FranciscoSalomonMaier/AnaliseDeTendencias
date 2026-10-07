BEGIN;
ALTER TABLE youtube_semantic_topics ADD COLUMN IF NOT EXISTS primary_topic text;
ALTER TABLE youtube_semantic_topics ADD COLUMN IF NOT EXISTS canonical_key text;
ALTER TABLE youtube_semantic_topics ADD COLUMN IF NOT EXISTS confidence double precision CHECK(confidence BETWEEN 0 AND 1);
ALTER TABLE youtube_semantic_topics ADD COLUMN IF NOT EXISTS classification_cache jsonb NOT NULL DEFAULT '{}'::jsonb;
-- Old display names are deliberately not backfilled as canonical subjects.
CREATE INDEX IF NOT EXISTS youtube_semantic_topics_canonical_idx ON youtube_semantic_topics(region_code,model,canonical_key);
COMMIT;
