import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { createUIMessageStreamResponse } from "ai";
import { config as dotenvConfig } from "dotenv";
import { resolve } from "node:path";
import { storySmokeWorkflow } from "../../../../../src/lib/story-smoke.workflow";

// Ensure env is available in dev (turbopack) even if the bootstrap module isn't evaluated.
dotenvConfig({ path: resolve(process.cwd(), ".env.local"), quiet: true });
dotenvConfig({ path: resolve(process.cwd(), ".env"), quiet: true });
dotenvConfig({ path: resolve(process.cwd(), "../../../.env.local"), quiet: true });
dotenvConfig({ path: resolve(process.cwd(), "../../../.env"), quiet: true });

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const modeParam = url.searchParams.get("mode");
    const mode =
      modeParam === "tool-error"
        ? "tool-error"
        : modeParam === "scripted"
          ? "scripted"
          : "success";

    const run = await start(storySmokeWorkflow, [mode]);
    const stream = run.getReadable();
    const response = createUIMessageStreamResponse({ stream });

    response.headers.set("x-workflow-run-id", run.runId);
    response.headers.set("cache-control", "no-cache");
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Story smoke failed", details: message }, { status: 500 });
  }
}
