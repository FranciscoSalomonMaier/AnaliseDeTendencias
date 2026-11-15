ALTER TABLE video_remix_exports ADD COLUMN IF NOT EXISTS version integer;
WITH ranked AS (SELECT id,row_number() OVER(PARTITION BY project_id ORDER BY created_at,id)::integer v FROM video_remix_exports)
UPDATE video_remix_exports e SET version=r.v FROM ranked r WHERE e.id=r.id AND e.version IS NULL;
ALTER TABLE video_remix_exports ALTER COLUMN version SET NOT NULL;
ALTER TABLE video_remix_projects ADD COLUMN IF NOT EXISTS render_sequence integer NOT NULL DEFAULT 0;
UPDATE video_remix_projects p SET render_sequence=GREATEST(p.render_sequence,COALESCE((SELECT MAX(version) FROM video_remix_exports e WHERE e.project_id=p.id),0));
CREATE UNIQUE INDEX IF NOT EXISTS remix_render_version ON video_remix_exports(project_id,version);
CREATE TABLE IF NOT EXISTS video_remix_reviews (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES video_remix_projects ON DELETE CASCADE,
 render_id uuid NOT NULL UNIQUE REFERENCES video_remix_exports ON DELETE CASCADE,
 ratings jsonb NOT NULL,notes text NOT NULL DEFAULT '',revision integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS video_remix_finalization_jobs (
 id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES video_remix_projects ON DELETE CASCADE,
 render_id uuid NOT NULL REFERENCES video_remix_exports ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
 kind text NOT NULL CHECK(kind IN ('VALIDATE','EXPORT','METADATA')),
 status text NOT NULL CHECK(status IN ('QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED')),
 fingerprint text NOT NULL,payload jsonb NOT NULL,result jsonb NOT NULL DEFAULT '{}',progress jsonb NOT NULL DEFAULT '{}',
 cancel_requested boolean NOT NULL DEFAULT false,attempts integer NOT NULL DEFAULT 0,error_message text,
 created_at timestamptz NOT NULL DEFAULT now(),started_at timestamptz,completed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS remix_finalization_active ON video_remix_finalization_jobs(project_id,fingerprint) WHERE status IN ('QUEUED','RUNNING');
CREATE INDEX IF NOT EXISTS remix_finalization_queue ON video_remix_finalization_jobs(status,created_at);
CREATE TABLE IF NOT EXISTS video_remix_deliveries (
 id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES video_remix_projects ON DELETE CASCADE,
 render_id uuid NOT NULL REFERENCES video_remix_exports ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
 job_id uuid NOT NULL UNIQUE REFERENCES video_remix_finalization_jobs ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
 platform text NOT NULL,preset jsonb NOT NULL,config_hash text NOT NULL,
 storage_key text,byte_size bigint NOT NULL,media jsonb NOT NULL,validation jsonb NOT NULL,reused boolean NOT NULL,
 metadata jsonb NOT NULL,revision integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS video_remix_review_events (
 id bigserial PRIMARY KEY,project_id uuid NOT NULL REFERENCES video_remix_projects ON DELETE CASCADE,
 action text NOT NULL,subject_id uuid NOT NULL,details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION remix_delivery_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.storage_key IS NOT NULL THEN INSERT INTO video_remix_storage_cleanup(storage_key) VALUES(OLD.storage_key) ON CONFLICT DO NOTHING; END IF; RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS remix_delivery_cleanup ON video_remix_deliveries;
CREATE TRIGGER remix_delivery_cleanup AFTER DELETE ON video_remix_deliveries FOR EACH ROW EXECUTE FUNCTION remix_delivery_cleanup();
