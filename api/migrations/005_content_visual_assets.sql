BEGIN;
CREATE TABLE IF NOT EXISTS content_assets (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES content_generation_runs(generation_id),
  scene_id UUID,
  type TEXT NOT NULL DEFAULT 'IMAGE' CHECK (type = 'IMAGE'),
  source TEXT NOT NULL CHECK (source IN ('AI_GENERATED','USER_UPLOAD')),
  status TEXT NOT NULL CHECK (status IN ('PENDING','GENERATING','READY','FAILED')),
  usage TEXT NOT NULL DEFAULT 'OPTIONAL' CHECK (usage IN ('REQUIRED','REFERENCE','OPTIONAL')),
  storage_key TEXT,
  mime_type TEXT,
  width INTEGER,
  height INTEGER,
  provider TEXT,
  model TEXT,
  original_prompt TEXT,
  final_generation_prompt TEXT,
  scene_fingerprint TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  token_usage JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id,id),
  CHECK (status <> 'READY' OR (storage_key IS NOT NULL AND mime_type IS NOT NULL AND width > 0 AND height > 0))
);
CREATE INDEX IF NOT EXISTS content_assets_project_scene_idx ON content_assets(project_id,scene_id,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS content_assets_active_scene_idx ON content_assets(project_id,scene_id) WHERE status IN ('PENDING','GENERATING') AND scene_id IS NOT NULL AND source='AI_GENERATED';
CREATE TABLE IF NOT EXISTS content_scene_visuals (
  project_id UUID NOT NULL REFERENCES content_generation_runs(generation_id),
  scene_id UUID NOT NULL,
  asset_id UUID NOT NULL,
  fingerprint TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(project_id,scene_id),
  FOREIGN KEY(project_id,asset_id) REFERENCES content_assets(project_id,id)
);
COMMIT;
