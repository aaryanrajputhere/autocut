import { auth } from "@clerk/nextjs/server";
import { get } from "@vercel/blob";
import { getPreviewJob } from "@/lib/preview-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized.", { status: 401 });

  const { id } = await context.params;
  const job = await getPreviewJob(id, userId);
  if (!job?.previewUrl || job.status !== "ready") {
    return new Response("Preview is not ready.", { status: 404 });
  }

  const range = request.headers.get("range");
  const result = await get(job.previewUrl, {
    access: "private",
    headers: range ? { Range: range } : undefined,
  });
  if (!result || result.statusCode !== 200) return new Response("Preview not found.", { status: 404 });

  const headers = new Headers();
  result.headers.forEach((value, key) => headers.set(key, value));
  headers.set("Content-Type", "video/mp4");
  headers.set("Cache-Control", "private, max-age=3600");
  headers.set("Accept-Ranges", "bytes");
  return new Response(result.stream, { status: range ? 206 : 200, headers });
}
