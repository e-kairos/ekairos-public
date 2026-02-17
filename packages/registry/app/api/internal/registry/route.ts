import { NextRequest, NextResponse } from "next/server";
import { getOrgAdminDb } from "@/lib/admin-org-db";
import { auth } from "@clerk/nextjs/server";

// GET: list registry repositories
// POST: create registry repository
export async function GET(req: NextRequest) {
  const { userId, orgId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!orgId) {
    return NextResponse.json({ error: "organization_required" }, { status: 403 });
  }
  const db = await getOrgAdminDb(orgId);

  const qr = await db.query({
    registry_repositories: {
      $: { limit: 100, order: { lastSyncedAt: "desc" } },
    },
  });

  return NextResponse.json(qr.registry_repositories || [], { status: 200 });
}

export async function POST(req: NextRequest) {
  const { userId, orgId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!orgId) {
    return NextResponse.json({ error: "organization_required" }, { status: 403 });
  }
  const db = await getOrgAdminDb(orgId);
  const body = await req.json();
  const { url, name } = body;

  if (!url) return NextResponse.json({ error: "url requerida" }, { status: 400 });

  const existing = await db.query({
    registry_repositories: {
      $: { where: { url }, limit: 1 },
    },
  });
  if (existing.registry_repositories?.length) {
    return NextResponse.json(existing.registry_repositories[0], { status: 200 });
  }

  const repoId = crypto.randomUUID();
  await db.transact(
    db.tx.registry_repositories[repoId].update({
      url,
      name: name || url.split("/").pop() || "repo",
      lastSyncedAt: 0,
    }),
  );

  return NextResponse.json({ id: repoId, url, name }, { status: 201 });
}


