import { NextResponse } from "next/server";
import { ensureDemoTenant } from "@/lib/demo/tenant.service";

type InitTenantBody = {
  visitorId?: string;
  appId?: string | null;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as InitTenantBody;
    const visitorId = String(body?.visitorId ?? "").trim();
    if (!visitorId) {
      return NextResponse.json(
        { ok: false, error: "visitorId is required." },
        { status: 400 },
      );
    }

    const tenant = await ensureDemoTenant({
      visitorId,
      appId: body?.appId ?? null,
    });

    return NextResponse.json({
      ok: true,
      data: tenant,
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

