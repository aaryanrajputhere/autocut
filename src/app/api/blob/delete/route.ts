import { auth } from "@clerk/nextjs/server";
import { del } from "@vercel/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Unauthorized." }, { status: 401 });

    const body = await request.json() as { pathname?: string };
    if (!body.pathname?.startsWith(`videos/${userId}/`)) {
      return Response.json({ error: "Invalid video path." }, { status: 400 });
    }

    await del(body.pathname);
    return Response.json({ deleted: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not delete the stored video." },
      { status: 500 },
    );
  }
}
