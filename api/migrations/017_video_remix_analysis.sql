CREATE TABLE IF NOT EXISTS video_remix_analyses (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES video_remix_projects(id) ON DELETE CASCADE,
 source_id uuid NOT NULL REFERENCES video_remix_sources(id) ON DELETE CASCADE,
 file_id uuid NOT NULL REFERENCES video_remix_files(id) ON DELETE CASCADE,
 fingerprint text NOT NULL, status text NOT NULL CHECK(status IN ('QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED')),
 config jsonb NOT NULL, context jsonb NOT NULL, progress jsonb NOT NULL DEFAULT '{}',
 metadata jsonb NOT NULL DEFAULT '{}', usage jsonb NOT NULL DEFAULT '{"inputTokens":0,"outputTokens":0,"totalTokens":0}',
 attempts integer NOT NULL DEFAULT 0, cancel_requested boolean NOT NULL DEFAULT false,
 error_message text, started_at timestamptz, completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS remix_analysis_active ON video_remix_analyses(source_id,fingerprint) WHERE status IN ('QUEUED','RUNNING');
CREATE INDEX IF NOT EXISTS remix_analysis_queue ON video_remix_analyses(status,created_at);
CREATE TABLE IF NOT EXISTS video_remix_scenes (
 id uuid PRIMARY KEY, analysis_id uuid NOT NULL REFERENCES video_remix_analyses(id) ON DELETE CASCADE,
 ordinal integer NOT NULL, start_seconds double precision NOT NULL CHECK(start_seconds>=0),
 end_seconds double precision NOT NULL CHECK(end_seconds>start_seconds),
 status text NOT NULL DEFAULT 'COMPLETED', result jsonb NOT NULL, UNIQUE(analysis_id,ordinal)
);
CREATE TABLE IF NOT EXISTS video_remix_scene_frames (
 id uuid PRIMARY KEY, scene_id uuid NOT NULL REFERENCES video_remix_scenes(id) ON DELETE CASCADE,
 timestamp_seconds double precision NOT NULL, storage_key text NOT NULL UNIQUE,
 width integer NOT NULL, height integer NOT NULL, byte_size integer NOT NULL, hash text NOT NULL
);
CREATE TABLE IF NOT EXISTS video_remix_segment_candidates (
 id uuid PRIMARY KEY, analysis_id uuid NOT NULL REFERENCES video_remix_analyses(id) ON DELETE CASCADE,
 scene_ids uuid[] NOT NULL, start_seconds double precision NOT NULL, end_seconds double precision NOT NULL,
 relevance double precision NOT NULL CHECK(relevance BETWEEN 0 AND 100), confidence double precision NOT NULL CHECK(confidence BETWEEN 0 AND 1),
 description text NOT NULL, justification text NOT NULL, evidence_type text NOT NULL CHECK(evidence_type IN ('OBSERVED','INFERRED','UNCONFIRMED')),
 selected boolean NOT NULL DEFAULT false, revision integer NOT NULL DEFAULT 0,
 CHECK(start_seconds>=0 AND end_seconds>start_seconds)
);
CREATE OR REPLACE FUNCTION remix_analysis_frame_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO video_remix_storage_cleanup(storage_key) VALUES(OLD.storage_key) ON CONFLICT DO NOTHING;
 RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS remix_frame_cleanup ON video_remix_scene_frames;
CREATE TRIGGER remix_frame_cleanup AFTER DELETE ON video_remix_scene_frames FOR EACH ROW EXECUTE FUNCTION remix_analysis_frame_cleanup();
