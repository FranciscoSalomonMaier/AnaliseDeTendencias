BEGIN;
CREATE TABLE IF NOT EXISTS content_project_audio (
 project_id UUID PRIMARY KEY REFERENCES content_generation_runs(generation_id),
 settings JSONB NOT NULL CHECK(jsonb_typeof(settings)='object'),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMIT;
