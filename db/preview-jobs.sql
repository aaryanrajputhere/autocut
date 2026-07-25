CREATE TABLE IF NOT EXISTS video_preview_jobs (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  source_pathname text NOT NULL,
  source_url text NOT NULL,
  preview_pathname text,
  preview_url text,
  status text NOT NULL CHECK (status IN ('queued', 'processing', 'ready', 'failed')),
  error text,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS video_preview_jobs_user_id_idx
ON video_preview_jobs (user_id, created_at DESC);
