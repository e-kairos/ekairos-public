import { NextResponse } from "next/server";
import { config as dotenvConfig } from "dotenv";
import { resolve } from "node:path";
import { storySmoke, storySmokeScripted, storySmokeToolError } from "../../../../../src/lib/story-smoke.story";
import type { ContextItem } from "@ekairos/events";
import "../../../../../src/ekairos";

// Ensure env is available in dev (turbopack) even if the bootstrap module isn't evaluated.
dotenvConfig({ path: resolve(process.cwd(), ".env.local"), quiet: true });
dotenvConfig({ path: resolve(process.cwd(), ".env"), quiet: true });
dotenvConfig({ path: resolve(process.cwd(), "../../../.env.local"), quiet: true });
dotenvConfig({ path: resolve(process.cwd(), "../../../.env"), quiet: true });

function buildTriggerEvent(): ContextItem {
  return {
    id: crypto.randomUUID(),
    type: "input",
    channel: "web",
    createdAt: new Date().toISOString(),
    content: {
      parts: [{ type: "text", text: "ping" }],
    },
  };
}

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

    const context =
      mode === "tool-error"
        ? storySmokeToolError
        : mode === "scripted"
          ? storySmokeScripted
          : storySmoke;

    const result = await context.react(buildTriggerEvent(), {
      env: { mode },
      context: null,
      durable: true,
      options: {
        maxIterations: 1,
        maxModelSteps: 1,
      },
    });

    return NextResponse.json({
      ok: true,
      data: {
        context: result.context,
        trigger: result.trigger,
        reaction: result.reaction,
        execution: result.execution,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Story smoke failed", details: message }, { status: 500 });
  }
}
