BEGIN;
-- Reuse the existing studio persistence. Also supports a fresh database.
CREATE TABLE IF NOT EXISTS content_generation_runs (
 generation_id UUID PRIMARY KEY, trend_id TEXT NOT NULL, region_code CHAR(2) NOT NULL,
 language TEXT NOT NULL, trend_snapshot JSONB NOT NULL, ideas JSONB NOT NULL,
 selected_idea JSONB, script JSONB, video_plan JSONB,
 production_approved BOOLEAN NOT NULL DEFAULT FALSE, provider TEXT NOT NULL, model TEXT NOT NULL,
 input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
 total_tokens INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE content_generation_runs
 ADD COLUMN IF NOT EXISTS project_config JSONB,
 ADD COLUMN IF NOT EXISTS project_status TEXT NOT NULL DEFAULT 'DRAFT',
 ADD COLUMN IF NOT EXISTS project_revision INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS script_stale BOOLEAN NOT NULL DEFAULT FALSE,
 ADD COLUMN IF NOT EXISTS scenes_stale BOOLEAN NOT NULL DEFAULT FALSE,
 ADD COLUMN IF NOT EXISTS project_usage JSONB NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS content_projects_updated_idx ON content_generation_runs(updated_at DESC, generation_id) WHERE project_config IS NOT NULL;
COMMIT;
