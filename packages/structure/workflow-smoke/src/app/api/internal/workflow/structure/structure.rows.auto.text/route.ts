import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { id } from "@instantdb/admin";
import { config as dotenvConfig } from "dotenv";
import { resolve } from "node:path";
import { getAdminDb, getInstantEnvOrThrow, readRowsOutput } from "../../../../../../lib/e2e/structure-e2e.helpers";
import { structureRowsAutoTextWorkflow } from "../../../../../../lib/workflows/structure/structure.rows.auto.text.workflow";

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
    const run = await start(structureRowsAutoTextWorkflow, [{ env: { orgId }, datasetId }]);
    await run.returnValue;

    const rowsOutput = await readRowsOutput(adminDb as any, datasetId);
    if (!rowsOutput.ok) {
      return NextResponse.json({ error: "Failed to read rows output", runId: run.runId, datasetId, rowsOutput }, { status: 500 });
    }

    return NextResponse.json({ runId: run.runId, datasetId, rowsOutput }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "structure.rows.auto.text failed", details: message }, { status: 500 });
  }
}

