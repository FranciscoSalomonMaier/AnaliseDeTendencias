BEGIN;
ALTER TABLE content_generation_runs ADD COLUMN IF NOT EXISTS narration_settings JSONB;
ALTER TABLE content_assets DROP CONSTRAINT IF EXISTS content_assets_type_check;
ALTER TABLE content_assets ADD CONSTRAINT content_assets_type_check CHECK(type IN ('IMAGE','AUDIO'));
ALTER TABLE content_assets ADD COLUMN IF NOT EXISTS duration_seconds DOUBLE PRECISION;
ALTER TABLE content_assets ADD COLUMN IF NOT EXISTS voice TEXT;
ALTER TABLE content_assets DROP CONSTRAINT IF EXISTS content_assets_check;
ALTER TABLE content_assets DROP CONSTRAINT IF EXISTS content_assets_ready_check;
ALTER TABLE content_assets ADD CONSTRAINT content_assets_ready_check CHECK(status <> 'READY' OR
  (storage_key IS NOT NULL AND mime_type IS NOT NULL AND
   ((type='IMAGE' AND width IS NOT NULL AND height IS NOT NULL AND width>0 AND height>0) OR
    (type='AUDIO' AND duration_seconds IS NOT NULL AND duration_seconds>0 AND duration_seconds<=600))));
DROP INDEX IF EXISTS content_assets_active_scene_idx;
CREATE UNIQUE INDEX content_assets_active_scene_idx ON content_assets(project_id,scene_id,type)
  WHERE status IN ('PENDING','GENERATING') AND scene_id IS NOT NULL AND source='AI_GENERATED';
CREATE INDEX IF NOT EXISTS content_audio_pending_idx ON content_assets(created_at,id) WHERE type='AUDIO' AND status='PENDING';
CREATE TABLE IF NOT EXISTS content_scene_audio (
  project_id UUID NOT NULL REFERENCES content_generation_runs(generation_id),
  scene_id UUID NOT NULL,
  asset_id UUID NOT NULL,
  accepted_fingerprint TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(project_id,scene_id),
  FOREIGN KEY(project_id,asset_id) REFERENCES content_assets(project_id,id)
);
COMMIT;
