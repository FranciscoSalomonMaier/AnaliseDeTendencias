CREATE TABLE IF NOT EXISTS content_publication_destinations (
  project_id UUID NOT NULL REFERENCES content_publication(project_id),
  target TEXT NOT NULL CHECK (target IN ('YOUTUBE_SHORTS', 'INSTAGRAM_REELS')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  data JSONB NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(project_id,target),
  render_job_id UUID GENERATED ALWAYS AS ((data->>'renderJobId')::uuid) STORED,
  selected_thumbnail_id UUID GENERATED ALWAYS AS ((data->>'selectedThumbnailId')::uuid) STORED,
  FOREIGN KEY(project_id,render_job_id) REFERENCES content_video_renders(project_id,id),
  FOREIGN KEY(project_id,selected_thumbnail_id) REFERENCES content_publication_thumbnails(project_id,id)
);

ALTER TABLE content_publication_generations ADD COLUMN IF NOT EXISTS target TEXT NOT NULL DEFAULT 'YOUTUBE_VIDEO' CHECK (target IN ('YOUTUBE_VIDEO', 'YOUTUBE_SHORTS', 'INSTAGRAM_REELS'));
