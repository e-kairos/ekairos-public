import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { id } from "@instantdb/admin";
import { config as dotenvConfig } from "dotenv";
import { resolve } from "node:path";
import { getAdminDb, getInstantEnvOrThrow, uploadCsvFixture } from "../../../../../../lib/e2e/structure-e2e.helpers";
import { structureMixedDatasetToObjectSchemaWorkflow } from "../../../../../../lib/workflows/structure/structure.mixed.datasetToObject.schema.workflow";

export const runtime = "nodejs";

dotenvConfig({ path: resolve(process.cwd(), ".env.local") });
dotenvConfig({ path: resolve(process.cwd(), ".env") });
dotenvConfig({ path: resolve(process.cwd(), "../../../.env.local") });
dotenvConfig({ path: resolve(process.cwd(), "../../../.env") });

function extractObjectValue(returnValue: any) {
  const rv = JSON.parse(JSON.stringify(returnValue ?? null));
  return rv?.dataset?.content?.structure?.outputs?.object?.value ?? rv?.dataset?.content?.structure?.outputs?.object?.resultJson ?? null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const orgId = String(body?.orgId || "test-org");

    const { appId, adminToken } = getInstantEnvOrThrow();
    const adminDb = getAdminDb(appId, adminToken);

    const datasetId = id();
    const rowsDatasetId = id();
    const fileId = await uploadCsvFixture(adminDb as any, "sample.csv");

    const run = await start(structureMixedDatasetToObjectSchemaWorkflow, [{ env: { orgId }, datasetId, rowsDatasetId, fileId }]);
    const returnValue = await run.returnValue;

    const value = extractObjectValue(returnValue);
    if (!value) {
      return NextResponse.json({ error: "Missing object value", runId: run.runId, datasetId, rowsDatasetId, returnValue }, { status: 500 });
    }

    return NextResponse.json({ runId: run.runId, datasetId, rowsDatasetId, value }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "structure.mixed.datasetToObject.schema failed", details: message }, { status: 500 });
  }
}

