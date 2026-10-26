CREATE TABLE IF NOT EXISTS youtube_channel_connections (
 id UUID PRIMARY KEY, owner_id TEXT NOT NULL, channel_id TEXT NOT NULL, title TEXT NOT NULL,
 thumbnail_url TEXT, credentials TEXT, status TEXT NOT NULL CHECK(status IN ('CONNECTED','EXPIRED','REVOKED','ERROR')),
 verified_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(owner_id,channel_id), UNIQUE(owner_id,id)
);
CREATE TABLE IF NOT EXISTS youtube_oauth_states (
 state_hash TEXT PRIMARY KEY, owner_id TEXT NOT NULL, browser_hash TEXT NOT NULL, verifier TEXT NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS youtube_publications (
 id UUID PRIMARY KEY, owner_id TEXT NOT NULL, project_id UUID NOT NULL REFERENCES content_generation_runs(generation_id),
 render_job_id UUID NOT NULL, connection_id UUID NOT NULL, target TEXT NOT NULL CHECK(target IN ('YOUTUBE_VIDEO','YOUTUBE_SHORTS')),
 idempotency_key UUID NOT NULL, snapshot JSONB NOT NULL, status TEXT NOT NULL DEFAULT 'DRAFT'
 CHECK(status IN ('DRAFT','QUEUED','UPLOADING','PROCESSING','SCHEDULED','PUBLISHED','PRIVATE','UNLISTED','FAILED','CANCELLED','NEEDS_ATTENTION')),
 session_cipher TEXT, session_started BOOLEAN NOT NULL DEFAULT FALSE, confirmed_bytes BIGINT NOT NULL DEFAULT 0,
 youtube_video_id TEXT, remote_privacy TEXT, remote_publish_at TIMESTAMPTZ, thumbnail_status TEXT NOT NULL DEFAULT 'PENDING',
 cancel_requested BOOLEAN NOT NULL DEFAULT FALSE, attempts INTEGER NOT NULL DEFAULT 0, error_code TEXT, error_message TEXT,
 next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_checked_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(owner_id,idempotency_key),
 FOREIGN KEY(project_id,render_job_id) REFERENCES content_video_renders(project_id,id),
 FOREIGN KEY(owner_id,connection_id) REFERENCES youtube_channel_connections(owner_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS youtube_publications_no_duplicate_idx ON youtube_publications(owner_id,connection_id,render_job_id) WHERE status <> 'CANCELLED' OR session_started OR youtube_video_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS youtube_publications_queue_idx ON youtube_publications(status,next_attempt_at);
CREATE TABLE IF NOT EXISTS youtube_publication_events (
 id BIGSERIAL PRIMARY KEY, publication_id UUID REFERENCES youtube_publications(id), owner_id TEXT NOT NULL,
 operation TEXT NOT NULL, result TEXT NOT NULL, code TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS youtube_automation_rules (
 project_id UUID PRIMARY KEY REFERENCES content_generation_runs(generation_id), owner_id TEXT NOT NULL,
 settings JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
