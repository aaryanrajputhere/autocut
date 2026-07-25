import { randomUUID } from "node:crypto";
import { storeMedia } from "@/lib/server-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!request.body) return Response.json({ error: "The upload was empty." }, { status: 400 });
  const lengthHeader = request.headers.get("content-length");
  const declaredBytes = lengthHeader ? Number(lengthHeader) : null;
  const id = randomUUID();
  try {
    await storeMedia(id, request.body, declaredBytes);
    return Response.json({ mediaId: id });
  } catch (error) {
    return Response.json({ error: messageFor(error) }, { status: 400 });
  }
}

function messageFor(error: unknown) {
  return error instanceof Error ? error.message : "The server could not store this video.";
}
