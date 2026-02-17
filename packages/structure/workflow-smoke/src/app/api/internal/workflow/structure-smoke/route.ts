import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { id, init } from "@instantdb/admin";
import { domain } from "@ekairos/domain";
import { sandboxDomain } from "@ekairos/sandbox";
import { structureDomain } from "@ekairos/structure";
import { structureSmokeWorkflow } from "../../../../../lib/workflows/structure-smoke.workflow";
import { structureRowsLargeWorkflow } from "../../../../../lib/workflows/structure-rows-large.workflow";
import { config as dotenvConfig } from "dotenv";
import { resolve } from "node:path";

// Ensure env is available in dev (turbopack) even if the bootstrap module isn't evaluated.
dotenvConfig({ path: resolve(process.cwd(), ".env.local") });
dotenvConfig({ path: resolve(process.cwd(), ".env") });
dotenvConfig({ path: resolve(process.cwd(), "../../../.env.local") });
dotenvConfig({ path: resolve(process.cwd(), "../../../.env") });

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  try {
    const body = await req.json();
    const orgId = String(body?.orgId || "test-org");
    const variant = String(body?.variant || "object");
    const sandboxConfig = body?.sandboxConfig;

    const appId =
      process.env.NEXT_PUBLIC_INSTANT_APP_ID ||
      process.env.INSTANT_APP_ID ||
      process.env.INSTANTDB_APP_ID;
    const adminToken =
      process.env.INSTANT_APP_ADMIN_TOKEN ||
      process.env.INSTANT_ADMIN_TOKEN ||
      process.env.INSTANTDB_ADMIN_TOKEN;
    if (!appId || !adminToken) {
      return NextResponse.json({ error: "Instant env not configured" }, { status: 500 });
    }

    const datasetId = id();
    const workflow = variant === "rows-large" ? structureRowsLargeWorkflow : structureSmokeWorkflow;
    const run = await start(workflow, [{ env: { orgId }, datasetId, sandboxConfig }]);

    console.log("[structure-smoke] started workflow");
    console.log("[structure-smoke] orgId", orgId);
    console.log("[structure-smoke] datasetId", datasetId);
    console.log("[structure-smoke] runId", run.runId);

    const appDomain = domain("structure-workflow-smoke-status")
      .includes(structureDomain)
      .includes(sandboxDomain)
      .schema({ entities: {}, links: {}, rooms: {} });

    const db = init({ appId, adminToken, schema: appDomain.toInstantSchema() });
    const key = `structure:${datasetId}`;

    // Wait for workflow completion + returnValue (blocks until completion).
    let workflowStatus = null;
    let returnValue = null;
    try {
      returnValue = await run.returnValue;
      console.log("[structure-smoke] workflow returnValue", JSON.stringify(returnValue, null, 2));
    } catch (e) {
      console.log("[structure-smoke] workflow returnValue error", e instanceof Error ? e.message : String(e));
    }

    try {
      workflowStatus = await run.status;
      console.log("[structure-smoke] workflow status", workflowStatus);
    } catch (e) {
      console.log("[structure-smoke] workflow status error", e instanceof Error ? e.message : String(e));
    }

    // Prefer returnValue for response; fallback to Instant polling if missing.
    let value = null;
    if (returnValue) {
      const returnValueJson = JSON.parse(JSON.stringify(returnValue));
      value =
        returnValueJson?.dataset?.content?.structure?.outputs?.object?.value ??
        returnValueJson?.dataset?.content?.structure?.outputs?.object?.resultJson ??
        null;
    }

    if (!value && variant !== "rows-large") {
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        const q = await db.query({
          thread_contexts: { $: { where: { key }, limit: 1 } },
        });
        const ctx = q?.thread_contexts?.[0];
        const content: any = ctx?.content ?? {};
        value = content?.structure?.outputs?.object?.value ?? null;
        if (value) break;
        await sleep(750);
      }
      console.log("[structure-smoke] instant value (fallback)", JSON.stringify(value, null, 2));
    } else {
      console.log("[structure-smoke] value (from returnValue)", JSON.stringify(value, null, 2));
    }

    if (!value && variant !== "rows-large") {
      return NextResponse.json(
        {
          error: "Timed out waiting for structure output",
          runId: run.runId,
          datasetId,
          workflowStatus,
          returnValue,
        },
        { status: 504 },
      );
    }

    return NextResponse.json(
      {
        message: "Structure smoke workflow completed",
        variant,
        runId: run.runId,
        workflowStatus,
        returnValue,
        datasetId,
        value,
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Structure smoke failed", details: message }, { status: 500 });
  } finally {
    const elapsedMs = Date.now() - startedAt;
    console.log(`[structure-smoke] request elapsedMs=${elapsedMs}`);
  }
}


