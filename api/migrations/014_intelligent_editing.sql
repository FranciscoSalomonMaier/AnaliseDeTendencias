BEGIN;
CREATE TABLE IF NOT EXISTS content_editing_plans (
 id UUID PRIMARY KEY,
 project_id UUID NOT NULL REFERENCES content_generation_runs(generation_id),
 owner_id TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version>0),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 status TEXT NOT NULL CHECK(status IN ('PENDING','PROCESSING','COMPLETED','FAILED','CANCELLED','APPROVED','APPLIED','RESTORED')),
 input_hash TEXT NOT NULL,
 input JSONB NOT NULL,
 result JSONB,
 progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
 cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
 usage JSONB NOT NULL DEFAULT '[]',
 error TEXT,
 previous_editing JSONB,
 applied_editing_revision INTEGER,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(project_id,version)
);
CREATE UNIQUE INDEX IF NOT EXISTS content_editing_one_analysis ON content_editing_plans(project_id) WHERE status IN ('PENDING','PROCESSING');
CREATE INDEX IF NOT EXISTS content_editing_plans_due ON content_editing_plans(created_at) WHERE status='PENDING';
CREATE TABLE IF NOT EXISTS content_editing_analysis_cache (
 owner_id TEXT NOT NULL,
 cache_key TEXT NOT NULL,
 result JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(owner_id,cache_key)
);
CREATE TABLE IF NOT EXISTS content_editing_plan_events (
 id BIGSERIAL PRIMARY KEY,
 plan_id UUID NOT NULL REFERENCES content_editing_plans(id),
 action TEXT NOT NULL,
 revision INTEGER NOT NULL,
 details JSONB NOT NULL DEFAULT '{}',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMIT;
