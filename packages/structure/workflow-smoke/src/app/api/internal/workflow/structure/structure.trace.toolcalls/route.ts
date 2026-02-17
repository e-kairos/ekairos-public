import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { id } from "@instantdb/admin";
import { config as dotenvConfig } from "dotenv";
import { resolve } from "node:path";
import { extractToolParts, getAdminDb, getInstantEnvOrThrow } from "../../../../../../lib/e2e/structure-e2e.helpers";
import { structureTraceToolcallsWorkflow } from "../../../../../../lib/workflows/structure/structure.trace.toolcalls.workflow";

export const runtime = "nodejs";

dotenvConfig({ path: resolve(process.cwd(), ".env.local") });
dotenvConfig({ path: resolve(process.cwd(), ".env") });
dotenvConfig({ path: resolve(process.cwd(), "../../../.env.local") });
dotenvConfig({ path: resolve(process.cwd(), "../../../.env") });

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const orgId = String(body?.orgId || "test-org");

    const { appId, adminToken } = getInstantEnvOrThrow();
    const adminDb = getAdminDb(appId, adminToken);

    const datasetId = id();
    const run = await start(structureTraceToolcallsWorkflow, [{ env: { orgId }, datasetId }]);
    await run.returnValue;

    const contextKey = `structure:${datasetId}`;
    const q: any = await (adminDb as any).query({
      thread_items: {
        $: {
          where: { "context.key": contextKey } as any,
          limit: 30,
          order: { createdAt: "asc" },
        },
      },
    });

    const events = q.thread_items ?? [];
    const toolParts = extractToolParts(events);
    const settled = toolParts.some((p: any) => p?.state === "output-available" || p?.state === "output-error");

    return NextResponse.json(
      {
        runId: run.runId,
        datasetId,
        trace: { eventsCount: events.length, toolPartsCount: toolParts.length, hasSettledToolPart: settled },
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "structure.trace.toolcalls failed", details: message }, { status: 500 });
  }
}


