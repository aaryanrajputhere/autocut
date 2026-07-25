import { handleCallback } from "@vercel/queue";
import {
  claimPreviewJob,
  getPreviewJob,
  markPreviewFailed,
  markPreviewReady,
  markPreviewRetrying,
} from "@/lib/preview-jobs";
import { transcodePreview } from "@/lib/server-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 1800;

type PreviewMessage = { jobId: string };

export const POST = handleCallback<PreviewMessage>(
  async (message, metadata) => {
    const existing = await getPreviewJob(message.jobId);
    if (!existing || existing.status === "ready") return;

    const job = await claimPreviewJob(message.jobId);
    if (!job) return;

    try {
      const preview = await transcodePreview(job);
      await markPreviewReady(job.id, preview.pathname, preview.url);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Preview conversion failed.";
      if (metadata.deliveryCount >= 5) await markPreviewFailed(job.id, messageText);
      else await markPreviewRetrying(job.id, messageText);
      throw error;
    }
  },
  {
    visibilityTimeoutSeconds: 1800,
    retry: (_error, metadata) => {
      if (metadata.deliveryCount >= 5) return { acknowledge: true };
      return { afterSeconds: Math.min(300, 15 * (2 ** (metadata.deliveryCount - 1))) };
    },
  },
);
