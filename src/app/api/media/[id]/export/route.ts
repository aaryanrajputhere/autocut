import { auth, clerkClient } from "@clerk/nextjs/server";
import { exportMedia, getExportProgress } from "@/lib/server-media";
import {
  dodoCheckoutUrl,
  freeExportMetadata,
  hasUsedFreeExport,
  withUserExportLock,
} from "@/lib/export-entitlement";
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
    const { userId } = await auth();
    if (!userId) {
      return Response.json(
        { error: "Sign in to use your free video export.", signInRequired: true },
        { status: 401 },
      );
    }

    const { id } = await context.params;
    const body = await request.json() as { ranges: KeepRange[] };
    if (!Array.isArray(body.ranges)) return Response.json({ error: "Missing keep ranges." }, { status: 400 });

    return await withUserExportLock(userId, async () => {
      const client = await clerkClient();
      const user = await client.users.getUser(userId);

      if (hasUsedFreeExport(user.privateMetadata)) {
        const checkoutUrl = dodoCheckoutUrl();
        if (!checkoutUrl) {
          return Response.json(
            { error: "Payments are not configured yet. Please contact support." },
            { status: 503 },
          );
        }
        return Response.json(
          { error: "Your free video has been used. Continue to payment.", checkoutUrl },
          { status: 402 },
        );
      }

      const result = await exportMedia(id, body.ranges);
      await client.users.updateUserMetadata(userId, {
        privateMetadata: freeExportMetadata(),
      });

      return new Response(result.stream, {
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": String(result.size),
          "Content-Disposition": 'attachment; filename="autocut-output.mp4"',
          "Cache-Control": "private, no-store",
        },
      });
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Export failed." }, { status: 500 });
  }
}
