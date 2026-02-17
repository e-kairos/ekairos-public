import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { GitHubIntegrationService } from "@/lib/domain/integration/github/service";

export async function GET(req: NextRequest) {
  const { orgId, userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!orgId) return NextResponse.json({ error: "organization_required" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const ghOrg = searchParams.get("org") || undefined;
  const perPage = searchParams.get("perPage") ? Number(searchParams.get("perPage")) : undefined;

  const res = await GitHubIntegrationService.listRepositories(orgId, ghOrg, perPage);

  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: 400 });
  }

  return NextResponse.json(res.data, { status: 200 });
}


