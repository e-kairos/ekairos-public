import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { instantService } from "@/lib/domain/instant/service";

export async function POST() {
  try {
    const { userId, orgId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!orgId) {
      return NextResponse.json(
        { error: "No organization selected. Please select an organization first." },
        { status: 400 },
      );
    }

    const creds = await instantService.getOrgCredentials({
      clerkOrgId: orgId,
    });

    return NextResponse.json({ appId: creds.appId });
  } catch (error) {
    console.error("Error resolving org Instant app:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 },
    );
  }
}
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { instantService } from "@/lib/domain/instant/service";

export async function POST() {
  try {
    const { userId, orgId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!orgId) {
      return NextResponse.json(
        { error: "No organization selected. Please select an organization first." },
        { status: 400 },
      );
    }

    const creds = await instantService.getOrgCredentials({
      clerkOrgId: orgId,
    });

    return NextResponse.json({ appId: creds.appId });
  } catch (error) {
    console.error("Error resolving org Instant app:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 },
    );
  }
}
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { instantService } from "@/lib/domain/instant/service";

export async function POST() {
  try {
    const { userId, orgId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!orgId) {
      return NextResponse.json(
        { error: "No organization selected. Please select an organization first." },
        { status: 400 },
      );
    }

    const creds = await instantService.getOrgCredentials({
      clerkOrgId: orgId,
    });

    return NextResponse.json({ appId: creds.appId });
  } catch (error) {
    console.error("Error resolving org Instant app:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 },
    );
  }
}


