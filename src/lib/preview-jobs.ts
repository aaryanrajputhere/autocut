import "server-only";

import { neon } from "@neondatabase/serverless";

export type PreviewJobStatus = "queued" | "processing" | "ready" | "failed";

export type PreviewJob = {
  id: string;
  userId: string;
  sourcePathname: string;
  sourceUrl: string;
  previewPathname: string | null;
  previewUrl: string | null;
  status: PreviewJobStatus;
  error: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
};

type JobRow = {
  id: string;
  user_id: string;
  source_pathname: string;
  source_url: string;
  preview_pathname: string | null;
  preview_url: string | null;
  status: PreviewJobStatus;
  error: string | null;
  attempts: number;
  created_at: string | Date;
  updated_at: string | Date;
};

let schemaPromise: Promise<void> | null = null;

function getSql() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for preview jobs.");
  return neon(databaseUrl);
}

async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const sql = getSql();
      await sql`
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
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS video_preview_jobs_user_id_idx
        ON video_preview_jobs (user_id, created_at DESC)
      `;
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}

export async function upsertQueuedPreviewJob(input: {
  id: string;
  userId: string;
  sourcePathname: string;
  sourceUrl: string;
}) {
  await ensureSchema();
  const sql = getSql();
  await sql`
    INSERT INTO video_preview_jobs (id, user_id, source_pathname, source_url, status)
    VALUES (${input.id}, ${input.userId}, ${input.sourcePathname}, ${input.sourceUrl}, 'queued')
    ON CONFLICT (id) DO UPDATE SET
      source_pathname = EXCLUDED.source_pathname,
      source_url = EXCLUDED.source_url,
      updated_at = now()
    WHERE video_preview_jobs.user_id = EXCLUDED.user_id
  `;
}

export async function getPreviewJob(id: string, userId?: string) {
  await ensureSchema();
  const sql = getSql();
  const rows = userId
    ? await sql`SELECT * FROM video_preview_jobs WHERE id = ${id} AND user_id = ${userId} LIMIT 1`
    : await sql`SELECT * FROM video_preview_jobs WHERE id = ${id} LIMIT 1`;
  return rows[0] ? mapJob(rows[0] as JobRow) : null;
}

export async function claimPreviewJob(id: string) {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    UPDATE video_preview_jobs
    SET status = 'processing', error = NULL, attempts = attempts + 1, updated_at = now()
    WHERE id = ${id} AND status IN ('queued', 'failed')
    RETURNING *
  `;
  return rows[0] ? mapJob(rows[0] as JobRow) : null;
}

export async function markPreviewReady(id: string, previewPathname: string, previewUrl: string) {
  await ensureSchema();
  const sql = getSql();
  await sql`
    UPDATE video_preview_jobs
    SET status = 'ready', preview_pathname = ${previewPathname},
        preview_url = ${previewUrl}, error = NULL, updated_at = now()
    WHERE id = ${id}
  `;
}

export async function markPreviewRetrying(id: string, error: string) {
  await ensureSchema();
  const sql = getSql();
  await sql`
    UPDATE video_preview_jobs
    SET status = 'queued', error = ${error}, updated_at = now()
    WHERE id = ${id}
  `;
}

export async function markPreviewFailed(id: string, error: string) {
  await ensureSchema();
  const sql = getSql();
  await sql`
    UPDATE video_preview_jobs
    SET status = 'failed', error = ${error}, updated_at = now()
    WHERE id = ${id}
  `;
}

export async function deletePreviewJob(id: string, userId: string) {
  await ensureSchema();
  const sql = getSql();
  await sql`DELETE FROM video_preview_jobs WHERE id = ${id} AND user_id = ${userId}`;
}

function mapJob(row: JobRow): PreviewJob {
  return {
    id: row.id,
    userId: row.user_id,
    sourcePathname: row.source_pathname,
    sourceUrl: row.source_url,
    previewPathname: row.preview_pathname,
    previewUrl: row.preview_url,
    status: row.status,
    error: row.error,
    attempts: row.attempts,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}
