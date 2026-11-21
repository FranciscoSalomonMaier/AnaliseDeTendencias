BEGIN;
-- Add a terminal cancellation state; existing kinds, queue and statuses retain their meaning.
ALTER TABLE short_jobs DROP CONSTRAINT IF EXISTS short_jobs_status_check;
ALTER TABLE short_jobs ADD CONSTRAINT short_jobs_status_check CHECK(status IN ('QUEUED','RUNNING','FAILED','COMPLETED','CANCELLED'));
-- Old worker builds cannot claim intelligent jobs using the legacy UPDATE statement.
CREATE OR REPLACE FUNCTION short_intelligent_claim_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status='QUEUED' AND NEW.status='RUNNING' AND OLD.input->>'engine'='INTELLIGENT'
    AND OLD.kind IN ('PLAN','RENDER') AND COALESCE(NEW.input->>'workerContractVersion','')<>'1' THEN
   RAISE EXCEPTION 'Intelligent job requires worker contract 1';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS short_intelligent_claim ON short_jobs;
CREATE TRIGGER short_intelligent_claim BEFORE UPDATE ON short_jobs FOR EACH ROW EXECUTE FUNCTION short_intelligent_claim_guard();
COMMIT;
