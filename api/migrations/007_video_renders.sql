BEGIN;
ALTER TABLE content_assets DROP CONSTRAINT IF EXISTS content_assets_type_check;
ALTER TABLE content_assets ADD CONSTRAINT content_assets_type_check CHECK(type IN ('IMAGE','AUDIO','VIDEO'));
ALTER TABLE content_assets DROP CONSTRAINT IF EXISTS content_assets_source_check;
ALTER TABLE content_assets ADD CONSTRAINT content_assets_source_check CHECK(source IN ('AI_GENERATED','USER_UPLOAD','RENDERED'));
ALTER TABLE content_assets DROP CONSTRAINT IF EXISTS content_assets_ready_check;
ALTER TABLE content_assets ADD CONSTRAINT content_assets_ready_check CHECK(status <> 'READY' OR
  (storage_key IS NOT NULL AND mime_type IS NOT NULL AND
   ((type='IMAGE' AND width IS NOT NULL AND height IS NOT NULL AND width>0 AND height>0) OR
    (type='AUDIO' AND duration_seconds IS NOT NULL AND duration_seconds>0 AND duration_seconds<=600) OR
    (type='VIDEO' AND mime_type='video/mp4' AND width IS NOT NULL AND height IS NOT NULL AND width>0 AND height>0 AND duration_seconds IS NOT NULL AND duration_seconds>0))));
CREATE TABLE IF NOT EXISTS content_video_renders (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES content_generation_runs(generation_id),
  status TEXT NOT NULL CHECK(status IN ('QUEUED','PREPARING','RENDERING','FINALIZING','COMPLETED','FAILED','CANCELLED')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
  snapshot JSONB NOT NULL,
  output_asset_id UUID,
  error TEXT,
  cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  render_duration_seconds DOUBLE PRECISION,
  FOREIGN KEY(project_id,output_asset_id) REFERENCES content_assets(project_id,id),
  CHECK(status<>'COMPLETED' OR (output_asset_id IS NOT NULL AND progress=100))
);
CREATE INDEX IF NOT EXISTS content_video_renders_project_idx ON content_video_renders(project_id,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS content_video_renders_active_idx ON content_video_renders(project_id) WHERE status IN ('QUEUED','PREPARING','RENDERING','FINALIZING');
COMMIT;
