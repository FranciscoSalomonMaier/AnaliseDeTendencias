BEGIN;
CREATE TABLE IF NOT EXISTS video_remix_projects (
 id UUID PRIMARY KEY,
 owner_id TEXT NOT NULL,
 title TEXT NOT NULL CHECK(char_length(title) BETWEEN 1 AND 160),
 topic TEXT NOT NULL CHECK(char_length(topic) BETWEEN 1 AND 300),
 description TEXT NOT NULL DEFAULT '' CHECK(char_length(description)<=4000),
 mode TEXT NOT NULL CHECK(mode IN ('SINGLE_SOURCE','MULTI_SOURCE')),
 narration_language TEXT NOT NULL,
 target_duration_seconds INTEGER NOT NULL CHECK(target_duration_seconds BETWEEN 5 AND 600),
 aspect_ratio TEXT NOT NULL CHECK(aspect_ratio IN ('16:9','9:16')),
 status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','SOURCES_PENDING','ANALYZING','SCRIPTING','RENDERING','COMPLETED','FAILED')),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS video_remix_owner_updated ON video_remix_projects(owner_id,updated_at DESC,id);
CREATE TABLE IF NOT EXISTS video_remix_sources (
 id UUID PRIMARY KEY,
 project_id UUID NOT NULL REFERENCES video_remix_projects(id) ON DELETE CASCADE,
 title TEXT NOT NULL CHECK(char_length(title) BETWEEN 1 AND 200),
 origin_type TEXT NOT NULL CHECK(origin_type IN ('EXTERNAL_URL','LOCAL_ASSET')),
 original_url TEXT,
 local_asset_id UUID REFERENCES content_assets(id) ON DELETE RESTRICT,
 duration_seconds DOUBLE PRECISION CHECK(duration_seconds>0 AND duration_seconds<=86400 AND duration_seconds<>'NaN'::float8),
 status TEXT NOT NULL CHECK(status IN ('METADATA_ONLY','LOCAL_AVAILABLE','UNAVAILABLE')),
 licensing JSONB NOT NULL CHECK(jsonb_typeof(licensing)='object'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK((origin_type='EXTERNAL_URL' AND original_url IS NOT NULL AND local_asset_id IS NULL) OR (origin_type='LOCAL_ASSET' AND local_asset_id IS NOT NULL AND original_url IS NULL))
);
CREATE INDEX IF NOT EXISTS video_remix_sources_project ON video_remix_sources(project_id,created_at,id);
-- Serialize source insertion and changes to the project mode at the database
-- boundary as well, so SINGLE_SOURCE remains valid under concurrent writers.
CREATE OR REPLACE FUNCTION video_remix_validate_source_count() RETURNS trigger AS $$
DECLARE project_mode TEXT;
BEGIN
 SELECT mode INTO project_mode FROM video_remix_projects WHERE id=NEW.project_id FOR UPDATE;
 IF project_mode='SINGLE_SOURCE' AND EXISTS(SELECT 1 FROM video_remix_sources WHERE project_id=NEW.project_id AND id<>NEW.id) THEN
  RAISE EXCEPTION 'SINGLE_SOURCE accepts one source' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS video_remix_source_count ON video_remix_sources;
CREATE TRIGGER video_remix_source_count BEFORE INSERT OR UPDATE OF project_id ON video_remix_sources FOR EACH ROW EXECUTE FUNCTION video_remix_validate_source_count();
CREATE OR REPLACE FUNCTION video_remix_validate_mode() RETURNS trigger AS $$
BEGIN
 IF NEW.mode='SINGLE_SOURCE' AND (SELECT COUNT(*) FROM video_remix_sources WHERE project_id=NEW.id)>1 THEN
  RAISE EXCEPTION 'Remove extra sources before SINGLE_SOURCE' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS video_remix_mode_count ON video_remix_projects;
CREATE TRIGGER video_remix_mode_count BEFORE UPDATE OF mode ON video_remix_projects FOR EACH ROW EXECUTE FUNCTION video_remix_validate_mode();
COMMIT;
