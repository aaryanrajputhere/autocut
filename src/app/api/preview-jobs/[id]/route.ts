import { auth } from "@clerk/nextjs/server";
import { getPreviewJob } from "@/lib/preview-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized." }, { status: 401 });
  const { id } = await context.params;
  const job = await getPreviewJob(id, userId);
  if (!job) return Response.json({ error: "Preview job not found." }, { status: 404 });
  return Response.json({
    id: job.id,
    status: job.status,
    error: job.status === "failed" ? job.error : null,
    attempts: job.attempts,
  });
}
