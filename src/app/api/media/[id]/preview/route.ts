import { createPreview } from "@/lib/server-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const result = await createPreview(id);
    return new Response(result.stream, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(result.size),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Preview conversion failed." }, { status: 500 });
  }
}
