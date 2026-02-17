import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { config as dotenvConfig } from "dotenv";
import { resolve } from "node:path";
import { storySmokeWorkflow } from "../../../../../lib/story-smoke.workflow";

// Ensure env is available in dev (turbopack) even if the bootstrap module isn't evaluated.
dotenvConfig({ path: resolve(process.cwd(), ".env.local") });
dotenvConfig({ path: resolve(process.cwd(), ".env") });
dotenvConfig({ path: resolve(process.cwd(), "../../../.env.local") });
dotenvConfig({ path: resolve(process.cwd(), "../../../.env") });

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const orgId = String(body?.orgId || "test-org");

    const run = await start(storySmokeWorkflow, [{ env: { orgId } }]);
    const result = await run.returnValue;

    return NextResponse.json(
      {
        message: "Story smoke workflow completed",
        runId: run.runId,
        result,
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Story smoke failed", details: message }, { status: 500 });
  }
}
