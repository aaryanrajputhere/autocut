import { analyzeMedia } from "@/lib/server-media";
import type { DetectionSettings, VideoMetadata } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json() as { metadata: VideoMetadata; settings: DetectionSettings };
    if (!body.metadata || !body.settings) return Response.json({ error: "Missing analysis settings." }, { status: 400 });
    return Response.json(await analyzeMedia(id, body.metadata, body.settings));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Analysis failed." }, { status: 500 });
  }
}
