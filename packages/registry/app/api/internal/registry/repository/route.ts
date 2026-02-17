import { NextRequest, NextResponse } from "next/server";
import { getOrgAdminDb } from "@/lib/admin-org-db";
import { RegistryService } from "@/lib/domain/registry/service";
import { auth } from "@clerk/nextjs/server";

export async function POST(req: NextRequest) {
  const { userId, orgId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!orgId) {
    return NextResponse.json({ error: "organization_required" }, { status: 403 });
  }

  try {
    const db = await getOrgAdminDb(orgId);
    const service = new RegistryService(db);
    const body = await req.json();

    const result = await service.registerRepository(body.url, body.name);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result.data, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

