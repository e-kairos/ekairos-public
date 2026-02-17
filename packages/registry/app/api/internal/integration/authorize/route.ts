import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

// Generates a redirect URL to platform integration flow, indicating required permission (e.g., "github").
export async function GET(req: NextRequest) {
  const { orgId: clerkOrgId } = await auth();
  if (!clerkOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams, origin } = new URL(req.url);
  const permission = searchParams.get("permission") || "auth";
  const returnUrl = searchParams.get("returnUrl") || `${origin}/registry`;
  const app = searchParams.get("app") || "registry";

  const platformUrl = new URL("https://platform.ekairos.dev/integration");
  platformUrl.searchParams.set("permission", permission);
  platformUrl.searchParams.set("redirect", returnUrl);
  platformUrl.searchParams.set("app", app);

  return NextResponse.json({ url: platformUrl.toString() });
}


