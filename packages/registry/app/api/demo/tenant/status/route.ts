import { NextResponse } from "next/server";
import { getDemoTenantStatus } from "@/lib/demo/tenant.service";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const visitorId = String(searchParams.get("visitorId") ?? "").trim();
    const appId = searchParams.get("appId");

    if (!visitorId) {
      return NextResponse.json(
        { ok: false, error: "visitorId is required." },
        { status: 400 },
      );
    }

    const status = await getDemoTenantStatus({
      visitorId,
      appId,
    });

    return NextResponse.json({
      ok: true,
      data: status,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 },
    );
  }
}

