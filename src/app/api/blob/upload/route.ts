import { auth } from "@clerk/nextjs/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

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
      onBeforeGenerateToken: async (pathname) => {
        const { userId } = await auth();
        if (!userId) throw new Error("Sign in before uploading a video.");
        if (!pathname.startsWith(`videos/${userId}/`)) throw new Error("Invalid upload path.");

        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_FILE_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ userId }),
        };
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
