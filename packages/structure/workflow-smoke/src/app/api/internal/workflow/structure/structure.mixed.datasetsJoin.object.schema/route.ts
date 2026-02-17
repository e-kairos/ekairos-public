import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { id } from "@instantdb/admin";
import { config as dotenvConfig } from "dotenv";
import { resolve } from "node:path";
import { createRowsDatasetContext, getAdminDb, getInstantEnvOrThrow } from "../../../../../../lib/e2e/structure-e2e.helpers";
import { structureMixedDatasetsJoinObjectSchemaWorkflow } from "../../../../../../lib/workflows/structure/structure.mixed.datasetsJoin.object.schema.workflow";

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

    const productsDatasetId = id();
    const categoriesDatasetId = id();

    const productsRows = [
      { code: "P-001", description: "Widget, Deluxe", price: 1200.5, categoryId: "C-1" },
      { code: "P-002", description: 'Gadget "Pro"', price: 20, categoryId: "C-2" },
      { code: "P-003", description: "Thing", price: 30.25, categoryId: "C-1" },
    ];
    const categoriesRows = [
      { categoryId: "C-1", categoryName: "Hardware" },
      { categoryId: "C-2", categoryName: "Software" },
    ];

    await createRowsDatasetContext({ adminDb, datasetId: productsDatasetId, rows: productsRows, name: "products" });
    await createRowsDatasetContext({ adminDb, datasetId: categoriesDatasetId, rows: categoriesRows, name: "categories" });

    const datasetId = id();
    const run = await start(structureMixedDatasetsJoinObjectSchemaWorkflow, [
      { env: { orgId }, datasetId, productsDatasetId, categoriesDatasetId },
    ]);

    const returnValue = await run.returnValue;
    const value = extractObjectValue(returnValue);
    if (!value) {
      return NextResponse.json(
        { error: "Missing object value", runId: run.runId, datasetId, productsDatasetId, categoriesDatasetId, returnValue },
        { status: 500 },
      );
    }

    return NextResponse.json({ runId: run.runId, datasetId, value }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "structure.mixed.datasetsJoin.object.schema failed", details: message }, { status: 500 });
  }
}

