CREATE TABLE IF NOT EXISTS video_remix_scripts (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES video_remix_projects(id) ON DELETE CASCADE,
 provider text NOT NULL, model text NOT NULL, version integer NOT NULL, revision integer NOT NULL DEFAULT 0, config jsonb NOT NULL, plan jsonb NOT NULL DEFAULT '{}',
 context_hash text NOT NULL, context_snapshot jsonb NOT NULL, full_narration_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(project_id,version)
);
CREATE TABLE IF NOT EXISTS video_remix_narrations (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES video_remix_projects(id) ON DELETE CASCADE,
 fingerprint text NOT NULL, storage_key text NOT NULL UNIQUE, duration_seconds double precision NOT NULL CHECK(duration_seconds>0),
 format text NOT NULL CHECK(format IN ('mp3','wav')), byte_size integer NOT NULL, settings jsonb NOT NULL, provider text NOT NULL, model text NOT NULL,
 character_count integer NOT NULL, usage jsonb, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(project_id,fingerprint)
);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='remix_script_full_audio_fk' AND conrelid='video_remix_scripts'::regclass) THEN
  ALTER TABLE video_remix_scripts ADD CONSTRAINT remix_script_full_audio_fk FOREIGN KEY(full_narration_id) REFERENCES video_remix_narrations(id) ON DELETE SET NULL;
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS video_remix_script_segments (
 id uuid PRIMARY KEY, script_id uuid NOT NULL REFERENCES video_remix_scripts(id) ON DELETE CASCADE,
 ordinal integer NOT NULL, kind text NOT NULL CHECK(kind IN ('HOOK','DEVELOPMENT','REVEAL','ENDING')),
 text text NOT NULL, candidate_ids uuid[] NOT NULL, estimated_seconds double precision NOT NULL,
 notes text NOT NULL DEFAULT '', validation jsonb NOT NULL DEFAULT '{"status":"PENDING"}',
 narration_id uuid REFERENCES video_remix_narrations(id) ON DELETE SET NULL,
 UNIQUE(script_id,ordinal) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE IF NOT EXISTS video_remix_script_revisions (
 id uuid PRIMARY KEY, script_id uuid NOT NULL REFERENCES video_remix_scripts(id) ON DELETE CASCADE,
 revision integer NOT NULL, snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(script_id,revision)
);
CREATE TABLE IF NOT EXISTS video_remix_story_jobs (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES video_remix_projects(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('SCRIPT','REGENERATE','VALIDATE','NARRATE')),
 status text NOT NULL CHECK(status IN ('QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED')),
 fingerprint text NOT NULL, payload jsonb NOT NULL, result_id uuid, progress jsonb NOT NULL DEFAULT '{}',
 usage jsonb NOT NULL DEFAULT '{"inputTokens":0,"outputTokens":0,"totalTokens":0,"charactersSubmitted":0}',
 reserved_characters integer NOT NULL DEFAULT 0, error_message text, cancel_requested boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS remix_story_job_active ON video_remix_story_jobs(project_id,fingerprint) WHERE status IN ('QUEUED','RUNNING');
CREATE INDEX IF NOT EXISTS remix_story_job_queue ON video_remix_story_jobs(status,created_at);
CREATE OR REPLACE FUNCTION remix_narration_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO video_remix_storage_cleanup(storage_key) VALUES(OLD.storage_key) ON CONFLICT DO NOTHING;
 RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS remix_narration_cleanup ON video_remix_narrations;
CREATE TRIGGER remix_narration_cleanup AFTER DELETE ON video_remix_narrations FOR EACH ROW EXECUTE FUNCTION remix_narration_cleanup();
