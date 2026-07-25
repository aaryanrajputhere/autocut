import { auth, clerkClient } from "@clerk/nextjs/server";
import {
  dodoCheckoutUrl,
  freeExportMetadata,
  hasUsedFreeExport,
  withUserExportLock,
} from "@/lib/export-entitlement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: "Sign in to export your free video." }, { status: 401 });
    }

    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    return entitlementResponse(user.privateMetadata);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: "Sign in to export your free video." }, { status: 401 });
    }

    return await withUserExportLock(userId, async () => {
      const client = await clerkClient();
      const user = await client.users.getUser(userId);
      const entitlement = entitlementResponse(user.privateMetadata);
      if (entitlement.status !== 200) return entitlement;
      await client.users.updateUserMetadata(userId, {
        privateMetadata: freeExportMetadata(),
      });
      return Response.json({ allowed: true });
    });
  } catch (error) {
    return errorResponse(error);
  }
}

function entitlementResponse(privateMetadata: Record<string, unknown>) {
  if (!hasUsedFreeExport(privateMetadata)) return Response.json({ allowed: true });

  const checkoutUrl = dodoCheckoutUrl();
  if (!checkoutUrl) {
    return Response.json(
      { error: "Payments are not configured yet. Please contact support." },
      { status: 503 },
    );
  }
  return Response.json({ checkoutUrl }, { status: 402 });
}

function errorResponse(error: unknown) {
  return Response.json(
    { error: error instanceof Error ? error.message : "Could not verify export access." },
    { status: 500 },
  );
}
