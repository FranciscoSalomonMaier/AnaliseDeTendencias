BEGIN;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='short_projects' AND column_name='soundtrack_version') THEN
  LOCK TABLE short_jobs IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM short_jobs WHERE status IN ('QUEUED','RUNNING')) THEN
   RAISE EXCEPTION 'Aguarde as tarefas de Criar Short terminarem antes da migration 023';
  END IF;
  ALTER TABLE short_projects DROP CONSTRAINT short_projects_step_check;
  UPDATE short_projects SET step=step+1 WHERE step>=7;
  ALTER TABLE short_projects ADD CONSTRAINT short_projects_step_check CHECK(step BETWEEN 1 AND 9);
  ALTER TABLE short_projects ADD COLUMN soundtrack_version smallint NOT NULL DEFAULT 1 CHECK(soundtrack_version=1);
 END IF;
END $$;
COMMIT;
