BEGIN;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='short_files' AND column_name='role') THEN
  IF EXISTS (SELECT 1 FROM short_jobs WHERE status IN ('QUEUED','RUNNING')) THEN
   RAISE EXCEPTION 'Aguarde as tarefas de Criar Short terminarem antes da migration 022';
  END IF;
  ALTER TABLE short_files ADD COLUMN role text NOT NULL DEFAULT 'SOURCE' CHECK(role IN ('SOURCE','REFERENCE'));
  ALTER TABLE short_projects DROP CONSTRAINT short_projects_step_check;
  UPDATE short_projects SET step=step+1 WHERE step>=3;
  ALTER TABLE short_projects ADD CONSTRAINT short_projects_step_check CHECK(step BETWEEN 1 AND 8);
 END IF;
END $$;
ALTER TABLE short_jobs DROP CONSTRAINT IF EXISTS short_jobs_kind_check;
ALTER TABLE short_jobs ADD CONSTRAINT short_jobs_kind_check CHECK(kind IN ('SCRIPT','REFERENCES','TEXT','AUDIO','PLAN','RENDER'));
CREATE TABLE IF NOT EXISTS short_reference_analyses (
 file_id uuid PRIMARY KEY REFERENCES short_files(id) ON DELETE CASCADE,
 project_id uuid NOT NULL REFERENCES short_projects(id) ON DELETE CASCADE,
 cache_key text NOT NULL, profile jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS short_reference_cache_idx ON short_reference_analyses(project_id,cache_key);
COMMIT;
