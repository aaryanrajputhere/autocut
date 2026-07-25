import { exportMedia, getExportProgress } from "@/lib/server-media";
import type { KeepRange } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return Response.json(getExportProgress(id), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not read export progress." }, { status: 400 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json() as { ranges: KeepRange[] };
    if (!Array.isArray(body.ranges)) return Response.json({ error: "Missing keep ranges." }, { status: 400 });
    const result = await exportMedia(id, body.ranges);
    return new Response(result.stream, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(result.size),
        "Content-Disposition": 'attachment; filename="autocut-output.mp4"',
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Export failed." }, { status: 500 });
  }
}
