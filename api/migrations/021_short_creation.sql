BEGIN;
CREATE TABLE IF NOT EXISTS short_projects (
 id uuid PRIMARY KEY, owner_id text NOT NULL, title text NOT NULL,
 description text NOT NULL, target_seconds integer NOT NULL CHECK(target_seconds IN (30,45,60)),
 revision integer NOT NULL DEFAULT 0, step integer NOT NULL DEFAULT 1 CHECK(step BETWEEN 1 AND 7),
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','QUEUED','RUNNING','FAILED','COMPLETED')),
 data jsonb NOT NULL DEFAULT '{}', error_message text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS short_projects_owner_idx ON short_projects(owner_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS short_files (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES short_projects(id) ON DELETE CASCADE,
 original_name text NOT NULL, storage_key text NOT NULL UNIQUE, bytes bigint NOT NULL CHECK(bytes>0),
 duration double precision NOT NULL CHECK(duration>0), width integer NOT NULL, height integer NOT NULL,
 fps double precision NOT NULL, mime text NOT NULL, rights_declared_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS short_jobs (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES short_projects(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('SCRIPT','TEXT','AUDIO','PLAN','RENDER')),
 status text NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED','RUNNING','FAILED','COMPLETED')),
 input jsonb NOT NULL, progress integer NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
 usage jsonb NOT NULL DEFAULT '{}', error_message text,
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS short_jobs_one_active_idx ON short_jobs(project_id) WHERE status IN ('QUEUED','RUNNING');
CREATE TABLE IF NOT EXISTS short_storage_cleanup (
 storage_key text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
