import { NextResponse } from "next/server";
import { destroyDemoTenant } from "@/lib/demo/tenant.service";

type DestroyTenantBody = {
  appId?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as DestroyTenantBody;
    const appId = String(body?.appId ?? "").trim();
    if (!appId) {
      return NextResponse.json(
        { ok: false, error: "appId is required." },
        { status: 400 },
      );
    }

    const result = await destroyDemoTenant({ appId });
    return NextResponse.json({
      ok: true,
      data: result,
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

