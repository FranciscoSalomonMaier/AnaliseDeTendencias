BEGIN;
ALTER TABLE content_generation_runs ADD COLUMN IF NOT EXISTS owner_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS content_video_renders_project_id_idx ON content_video_renders(project_id,id);
CREATE TABLE IF NOT EXISTS content_publication (
 project_id UUID PRIMARY KEY REFERENCES content_generation_runs(generation_id),
 platform TEXT NOT NULL DEFAULT 'YOUTUBE' CHECK(platform='YOUTUBE'),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 data JSONB NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(data)='object'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS content_publication_generations (
 id UUID PRIMARY KEY, project_id UUID NOT NULL REFERENCES content_publication(project_id),
 kind TEXT NOT NULL CHECK(kind IN ('METADATA','TITLES','DESCRIPTION','THUMBNAILS')),
 status TEXT NOT NULL CHECK(status IN ('RUNNING','COMPLETED','FAILED')),
 result JSONB, provider TEXT, model TEXT, usage JSONB, error TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS content_publication_running_idx ON content_publication_generations(project_id) WHERE status='RUNNING';
CREATE INDEX IF NOT EXISTS content_publication_generations_project_idx ON content_publication_generations(project_id,created_at DESC);
CREATE TABLE IF NOT EXISTS content_publication_thumbnails (
 id UUID PRIMARY KEY,project_id UUID NOT NULL REFERENCES content_publication(project_id),
 asset_id UUID NOT NULL, UNIQUE(project_id,id), background_key TEXT NOT NULL, overlay JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 FOREIGN KEY(project_id,asset_id) REFERENCES content_assets(project_id,id)
);
CREATE INDEX IF NOT EXISTS content_publication_thumbnails_project_idx ON content_publication_thumbnails(project_id,created_at DESC);
ALTER TABLE content_publication ADD COLUMN IF NOT EXISTS render_job_id UUID GENERATED ALWAYS AS ((data->>'renderJobId')::uuid) STORED;
ALTER TABLE content_publication ADD COLUMN IF NOT EXISTS selected_thumbnail_id UUID GENERATED ALWAYS AS ((data->>'selectedThumbnailId')::uuid) STORED;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='content_publication_render_fk' AND conrelid='content_publication'::regclass) THEN
  ALTER TABLE content_publication ADD CONSTRAINT content_publication_render_fk FOREIGN KEY(project_id,render_job_id) REFERENCES content_video_renders(project_id,id);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='content_publication_thumbnail_fk' AND conrelid='content_publication'::regclass) THEN
  ALTER TABLE content_publication ADD CONSTRAINT content_publication_thumbnail_fk FOREIGN KEY(project_id,selected_thumbnail_id) REFERENCES content_publication_thumbnails(project_id,id);
 END IF;
END $$;
COMMIT;
