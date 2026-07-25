import { auth } from "@clerk/nextjs/server";
import { del } from "@vercel/blob";
import { deletePreviewJob, getPreviewJob } from "@/lib/preview-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Unauthorized." }, { status: 401 });

    const body = await request.json() as { pathname?: string; previewJobId?: string | null };
    if (!body.pathname?.startsWith(`videos/${userId}/`)) {
      return Response.json({ error: "Invalid video path." }, { status: 400 });
    }

    const pathnames = [body.pathname];
    let deleteJobId: string | null = null;
    if (body.previewJobId) {
      const job = await getPreviewJob(body.previewJobId, userId);
      if (job && job.sourcePathname !== body.pathname) {
        return Response.json({ error: "Invalid preview job." }, { status: 400 });
      }
      if (job) {
        if (job.previewPathname) pathnames.push(job.previewPathname);
        deleteJobId = body.previewJobId;
      }
    }
    await del(pathnames);
    if (deleteJobId) await deletePreviewJob(deleteJobId, userId);
    return Response.json({ deleted: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not delete the stored video." },
      { status: 500 },
    );
  }
}
