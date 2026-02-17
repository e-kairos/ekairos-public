import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";

// Redirects to Ekairos Core integrations page with returnUrl back to Registry
export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user || !user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const returnUrl = searchParams.get("returnUrl") || `${req.nextUrl.origin}/registry`;
  const ekairosIntegrationUrl = `https://platform.ekairos.dev/platform/integrations/github?returnUrl=${encodeURIComponent(
    returnUrl,
  )}`;

  return NextResponse.json({ url: ekairosIntegrationUrl });
}


