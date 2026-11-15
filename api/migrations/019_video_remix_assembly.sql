CREATE TABLE IF NOT EXISTS video_remix_timelines (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES video_remix_projects(id) ON DELETE CASCADE,
 script_id uuid NOT NULL REFERENCES video_remix_scripts(id) ON DELETE CASCADE,
 version integer NOT NULL, fingerprint text NOT NULL, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(project_id,version)
);
CREATE TABLE IF NOT EXISTS video_remix_exports (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES video_remix_projects(id) ON DELETE CASCADE,
 timeline_id uuid NOT NULL REFERENCES video_remix_timelines(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('PREVIEW','FINAL')), status text NOT NULL CHECK(status IN ('QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED')),
 fingerprint text NOT NULL, options jsonb NOT NULL, progress jsonb NOT NULL DEFAULT '{}', cancel_requested boolean NOT NULL DEFAULT false,
 storage_key text, byte_size bigint, duration_seconds double precision, width integer, height integer, metadata jsonb NOT NULL DEFAULT '{}',
 attempts integer NOT NULL DEFAULT 0,error_message text,created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz,completed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS remix_export_active ON video_remix_exports(project_id,fingerprint) WHERE status IN ('QUEUED','RUNNING');
CREATE INDEX IF NOT EXISTS remix_export_queue ON video_remix_exports(status,created_at);
CREATE TABLE IF NOT EXISTS video_remix_caption_alignments (
 fingerprint text PRIMARY KEY, project_id uuid NOT NULL REFERENCES video_remix_projects(id) ON DELETE CASCADE,
 audio_id uuid NOT NULL REFERENCES video_remix_narrations(id) ON DELETE CASCADE,
 cues jsonb NOT NULL, method text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION remix_export_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.storage_key IS NOT NULL THEN
 INSERT INTO video_remix_storage_cleanup(storage_key) VALUES(OLD.storage_key) ON CONFLICT DO NOTHING;
 END IF; RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS remix_export_cleanup ON video_remix_exports;
CREATE TRIGGER remix_export_cleanup AFTER DELETE ON video_remix_exports FOR EACH ROW EXECUTE FUNCTION remix_export_cleanup();
