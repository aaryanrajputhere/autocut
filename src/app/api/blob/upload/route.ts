import { auth } from "@clerk/nextjs/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { send } from "@vercel/queue";
import { upsertQueuedPreviewJob } from "@/lib/preview-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = ["video/mp4", "video/quicktime", "video/x-m4v"];

export async function POST(request: Request) {
  try {
    const body = await request.json() as HandleUploadBody;
    const response = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const { userId } = await auth();
        if (!userId) throw new Error("Sign in before uploading a video.");
        if (!pathname.startsWith(`videos/${userId}/`)) throw new Error("Invalid upload path.");
        const payload = parseClientPayload(clientPayload);

        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_FILE_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ userId, previewJobId: payload.previewJobId }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const payload = parseTokenPayload(tokenPayload);
        if (!payload.previewJobId) return;
        await upsertQueuedPreviewJob({
          id: payload.previewJobId,
          userId: payload.userId,
          sourcePathname: blob.pathname,
          sourceUrl: blob.url,
        });
        await send("video-preview-jobs", { jobId: payload.previewJobId }, {
          idempotencyKey: `video-preview-${payload.previewJobId}`,
          retentionSeconds: 24 * 60 * 60,
        });
      },
    });
    return Response.json(response);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not authorize this upload." },
      { status: 400 },
    );
  }
}

function parseClientPayload(value: string | null) {
  if (!value) return { previewJobId: null };
  const parsed = JSON.parse(value) as { previewJobId?: unknown };
  if (parsed.previewJobId === null || parsed.previewJobId === undefined) return { previewJobId: null };
  if (typeof parsed.previewJobId !== "string" || !isUuid(parsed.previewJobId)) {
    throw new Error("Invalid preview job id.");
  }
  return { previewJobId: parsed.previewJobId };
}

function parseTokenPayload(value: string | null | undefined) {
  if (!value) throw new Error("Upload ownership metadata is missing.");
  const parsed = JSON.parse(value) as { userId?: unknown; previewJobId?: unknown };
  if (typeof parsed.userId !== "string") throw new Error("Upload owner is missing.");
  if (parsed.previewJobId !== null && parsed.previewJobId !== undefined &&
      (typeof parsed.previewJobId !== "string" || !isUuid(parsed.previewJobId))) {
    throw new Error("Invalid preview job id.");
  }
  return {
    userId: parsed.userId,
    previewJobId: typeof parsed.previewJobId === "string" ? parsed.previewJobId : null,
  };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
