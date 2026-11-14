BEGIN;
CREATE TABLE IF NOT EXISTS video_remix_files (
 id UUID PRIMARY KEY,
 project_id UUID NOT NULL REFERENCES video_remix_projects(id) ON DELETE CASCADE,
 storage_key TEXT NOT NULL UNIQUE,
 original_name TEXT NOT NULL,
 byte_size BIGINT NOT NULL CHECK(byte_size>0),
 extension TEXT NOT NULL CHECK(extension IN ('mp4','mov','webm','mkv')),
 mime_type TEXT NOT NULL,
 duration_seconds DOUBLE PRECISION NOT NULL CHECK(duration_seconds>0 AND duration_seconds<=86400),
 width INTEGER NOT NULL CHECK(width BETWEEN 1 AND 16384),
 height INTEGER NOT NULL CHECK(height BETWEEN 1 AND 16384),
 fps DOUBLE PRECISION NOT NULL CHECK(fps>0 AND fps<=240),
 codec TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'READY' CHECK(status='READY'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(project_id,id)
);
ALTER TABLE video_remix_sources ADD COLUMN IF NOT EXISTS platform TEXT,
 ADD COLUMN IF NOT EXISTS external_id TEXT,
 ADD COLUMN IF NOT EXISTS platform_metadata JSONB NOT NULL DEFAULT '{}',
 ADD COLUMN IF NOT EXISTS imported_file_id UUID,
 ADD COLUMN IF NOT EXISTS platform_metadata_expires_at TIMESTAMPTZ;
ALTER TABLE video_remix_sources DROP CONSTRAINT IF EXISTS video_remix_sources_status_check;
ALTER TABLE video_remix_sources ADD CONSTRAINT video_remix_sources_status_check CHECK(status IN ('METADATA_ONLY','LOCAL_AVAILABLE','SELECTED','IMPORTED','UNAVAILABLE'));
ALTER TABLE video_remix_sources DROP CONSTRAINT IF EXISTS video_remix_sources_origin_type_check;
ALTER TABLE video_remix_sources ADD CONSTRAINT video_remix_sources_origin_type_check CHECK(origin_type IN ('EXTERNAL_URL','LOCAL_ASSET','LOCAL_UPLOAD'));
-- The original compound check was unnamed in migration 015.
DO $$ DECLARE constraint_name TEXT; BEGIN
 FOR constraint_name IN SELECT conname FROM pg_constraint WHERE conrelid='video_remix_sources'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%origin_type%original_url%' LOOP
  EXECUTE format('ALTER TABLE video_remix_sources DROP CONSTRAINT %I',constraint_name);
 END LOOP;
END $$;
ALTER TABLE video_remix_sources DROP CONSTRAINT IF EXISTS video_remix_sources_origin_reference;
ALTER TABLE video_remix_sources ADD CONSTRAINT video_remix_sources_origin_reference CHECK(
 (origin_type='EXTERNAL_URL' AND original_url IS NOT NULL AND local_asset_id IS NULL) OR
 (origin_type='LOCAL_ASSET' AND local_asset_id IS NOT NULL) OR
 (origin_type='LOCAL_UPLOAD' AND local_asset_id IS NULL));
ALTER TABLE video_remix_sources DROP CONSTRAINT IF EXISTS video_remix_source_file;
ALTER TABLE video_remix_sources ADD CONSTRAINT video_remix_source_file FOREIGN KEY(project_id,imported_file_id) REFERENCES video_remix_files(project_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX IF NOT EXISTS video_remix_source_external_unique ON video_remix_sources(project_id,platform,external_id) WHERE external_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS video_remix_discovery_cache(cache_key TEXT PRIMARY KEY,payload JSONB NOT NULL,expires_at TIMESTAMPTZ NOT NULL);
CREATE TABLE IF NOT EXISTS video_remix_discovery_rate(owner_id TEXT NOT NULL,window_at BIGINT NOT NULL,hits INTEGER NOT NULL,PRIMARY KEY(owner_id,window_at));
CREATE TABLE IF NOT EXISTS video_remix_storage_cleanup(storage_key TEXT PRIMARY KEY,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),not_before TIMESTAMPTZ NOT NULL DEFAULT NOW(),attempts INTEGER NOT NULL DEFAULT 0);
COMMIT;
