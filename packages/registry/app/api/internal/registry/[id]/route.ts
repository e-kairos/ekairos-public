import { NextRequest, NextResponse } from "next/server";
import { getOrgAdminDb } from "@/lib/admin-org-db";
import { auth } from "@clerk/nextjs/server";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, orgId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!orgId) {
    return NextResponse.json({ error: "organization_required" }, { status: 403 });
  }
  const db = await getOrgAdminDb(orgId);
  const { id } = params;

  const qr = await db.query({
    registry_repositories: {
      $: { where: { id }, limit: 1 },
      components: {
        dependencies: {},
        registryDependencies: {},
        files: {
          storage: {},
        },
        commits: { $: { limit: 5, order: { date: "desc" } } },
      },
    },
  });

  const repo = qr.registry_repositories?.[0];
  if (!repo) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(repo, { status: 200 });
}


