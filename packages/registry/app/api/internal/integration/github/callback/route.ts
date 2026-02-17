import { NextRequest, NextResponse } from "next/server";

// This callback simply redirects back to returnUrl (handled by Ekairos integration flow)
export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const returnUrl = searchParams.get("returnUrl") || `${origin}/registry`;
  return NextResponse.redirect(returnUrl);
}


