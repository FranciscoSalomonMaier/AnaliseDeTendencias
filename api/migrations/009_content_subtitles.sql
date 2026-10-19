BEGIN;
CREATE TABLE IF NOT EXISTS content_subtitles (
 id UUID PRIMARY KEY,
 project_id UUID NOT NULL REFERENCES content_generation_runs(generation_id),
 scene_id UUID NOT NULL,
 audio_asset_id UUID NOT NULL REFERENCES content_assets(id),
 status TEXT NOT NULL CHECK(status IN ('QUEUED','PROCESSING','READY','FAILED')),
 data JSONB NOT NULL CHECK(jsonb_typeof(data)='object'),
 error TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS content_subtitles_project_idx ON content_subtitles(project_id,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS content_subtitles_active_idx ON content_subtitles(project_id,scene_id,audio_asset_id) WHERE status IN ('QUEUED','PROCESSING');
CREATE TABLE IF NOT EXISTS content_project_subtitles (
 project_id UUID PRIMARY KEY REFERENCES content_generation_runs(generation_id),
 settings JSONB NOT NULL CHECK(jsonb_typeof(settings)='object'),
 selections JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(selections)='object'),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMIT;
