import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { id, init, lookup } from "@instantdb/admin";
import { domain } from "@ekairos/domain";
import { sandboxDomain } from "@ekairos/sandbox";
import { DatasetService, structureDomain } from "@ekairos/structure";
import { structureE2EWorkflow, type StructureE2EWorkflowScenario } from "../../../../../lib/workflows/structure-e2e.workflow";
import { config as dotenvConfig } from "dotenv";
import { resolve } from "node:path";
import { promises as fs } from "node:fs";

export const runtime = "nodejs";

// Ensure env is available in dev (turbopack) even if the bootstrap module isn't evaluated.
dotenvConfig({ path: resolve(process.cwd(), ".env.local") });
dotenvConfig({ path: resolve(process.cwd(), ".env") });
dotenvConfig({ path: resolve(process.cwd(), "../../../.env.local") });
dotenvConfig({ path: resolve(process.cwd(), "../../../.env") });

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

function getInstantEnv() {
  const appId = process.env.NEXT_PUBLIC_INSTANT_APP_ID || process.env.INSTANT_APP_ID || process.env.INSTANTDB_APP_ID;
  const adminToken =
    process.env.INSTANT_APP_ADMIN_TOKEN || process.env.INSTANT_ADMIN_TOKEN || process.env.INSTANTDB_ADMIN_TOKEN;
  return { appId, adminToken };
}

function getAdminDb(appId: string, adminToken: string) {
  const appDomain = domain("structure-workflow-e2e")
    .includes(structureDomain)
    .includes(sandboxDomain)
    .schema({ entities: {}, links: {}, rooms: {} });

  return init({ appId, adminToken, schema: appDomain.toInstantSchema() });
}

async function uploadFixtureFile(adminDb: any, fixtureName: string) {
  const fixturePath = resolve(process.cwd(), "tests", "structure", "fixtures", fixtureName);
  const fileBuffer = await fs.readFile(fixturePath);

  const contentType = fixtureName.toLowerCase().endsWith(".pdf") ? "application/pdf" : "text/csv";

  const storagePath = `/tests/structure/${Date.now()}-${Math.random().toString(16).slice(2)}-${fixtureName}`;
  const uploadResult = await adminDb.storage.uploadFile(storagePath, fileBuffer, {
    contentType,
    contentDisposition: fixtureName,
  });

  return uploadResult?.data?.id as string;
}

async function createRowsDatasetContext(params: { adminDb: any; datasetId: string; rows: any[]; name: string }) {
  const { adminDb, datasetId, rows, name } = params;
  const contextKey = `structure:${datasetId}`;

  const jsonl = rows.map((r) => JSON.stringify({ type: "row", data: r })).join("\n") + "\n";
  const storagePath = `/tests/structure/${Date.now()}-${Math.random().toString(16).slice(2)}-${name}.jsonl`;
  const uploadResult = await adminDb.storage.uploadFile(storagePath, Buffer.from(jsonl, "utf-8"), {
    contentType: "application/x-ndjson",
    contentDisposition: `${name}.jsonl`,
  });

  const fileId = uploadResult?.data?.id as string;
  if (!fileId) throw new Error("Failed to upload dataset jsonl");

  await adminDb.transact(
    adminDb.tx.thread_contexts[id()].create({
      createdAt: new Date(),
      updatedAt: new Date(),
      type: "structure",
      key: contextKey,
      status: "open",
      content: {
        structure: {
          kind: "ekairos.structure",
          version: 1,
          structureId: datasetId,
          state: "completed",
          outputs: {
            rows: { format: "jsonl", fileId },
          },
        },
      },
    }),
  );

  await adminDb.transact(adminDb.tx.thread_contexts[lookup("key", contextKey)].link({ structure_output_file: fileId }));

  return { datasetId, fileId };
}

function extractValueFromReturnValue(returnValue: any) {
  const rv = JSON.parse(JSON.stringify(returnValue ?? null));
  const candidates = [
    rv?.result?.dataset?.content?.structure?.outputs?.object?.value,
    rv?.result?.dataset?.content?.structure?.outputs?.object?.resultJson,
    rv?.objRes?.dataset?.content?.structure?.outputs?.object?.value,
    rv?.objRes?.dataset?.content?.structure?.outputs?.object?.resultJson,
    rv?.summary?.dataset?.content?.structure?.outputs?.object?.value,
    rv?.summary?.dataset?.content?.structure?.outputs?.object?.resultJson,
  ];
  for (const c of candidates) {
    if (c) return c;
  }
  return null;
}

async function readRowsOutput(adminDb: any, datasetId: string) {
  const ds = new DatasetService(adminDb as any);
  const gen = await ds.readRecordsFromFile(datasetId);
  if (!gen.ok) return { ok: false, error: gen.error };

  const rows: any[] = [];
  for await (const rec of gen.data) rows.push(rec);

  const dataRows = rows.filter((r) => r?.type === "row").map((r) => r.data);
  return { ok: true, dataRows };
}

function extractToolParts(events: any[]) {
  const parts: any[] = [];
  for (const e of events) {
    const ps = e?.content?.parts;
    if (!Array.isArray(ps)) continue;
    for (const p of ps) {
      if (typeof p?.type === "string" && p.type.startsWith("tool-")) {
        parts.push(p);
      }
    }
  }
  return parts;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const orgId = String(body?.orgId || "test-org");
    const scenario = String(body?.scenario || "") as StructureE2EWorkflowScenario;

    const { appId, adminToken } = getInstantEnv();
    if (!appId || !adminToken) {
      return NextResponse.json({ error: "Instant env not configured" }, { status: 500 });
    }

    const adminDb = getAdminDb(appId, adminToken);

    const datasetId = id();
    const input: any = { env: { orgId }, datasetId, scenario };

    if (scenario === "rows_schema_sample_csv") {
      input.fileId = await uploadFixtureFile(adminDb, "sample.csv");
    }

    if (scenario === "rows_schema_sample_pdf") {
      input.fileId = await uploadFixtureFile(adminDb, "sample.pdf");
    }

    if (scenario === "rows_schema_complex_products_csv") {
      input.fileId = await uploadFixtureFile(adminDb, "complex_products.csv");
    }

    if (scenario === "mixed_dataset_to_object") {
      input.fileId = await uploadFixtureFile(adminDb, "sample.csv");
      input.rowsDatasetId = id();
    }

    if (scenario === "datasets_join_object_summary") {
      // Pre-create two dataset contexts deterministically (so this scenario focuses on consuming datasets + joining them).
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
      await createRowsDatasetContext({
        adminDb,
        datasetId: categoriesDatasetId,
        rows: categoriesRows,
        name: "categories",
      });

      input.productsDatasetId = productsDatasetId;
      input.categoriesDatasetId = categoriesDatasetId;
    }

    const run = await start(structureE2EWorkflow, [input]);

    console.log("[structure-e2e] started workflow");
    console.log("[structure-e2e] scenario", scenario);
    console.log("[structure-e2e] orgId", orgId);
    console.log("[structure-e2e] datasetId", datasetId);
    console.log("[structure-e2e] runId", run.runId);

    let workflowStatus: any = null;
    let returnValue: any = null;
    try {
      returnValue = await run.returnValue;
      console.log("[structure-e2e] workflow returnValue", JSON.stringify(returnValue, null, 2));
    } catch (e) {
      console.log("[structure-e2e] workflow returnValue error", e instanceof Error ? e.message : String(e));
    }

    try {
      workflowStatus = await run.status;
      console.log("[structure-e2e] workflow status", workflowStatus);
    } catch (e) {
      console.log("[structure-e2e] workflow status error", e instanceof Error ? e.message : String(e));
    }

    // Prefer returnValue for object outputs; fallback to Instant polling if missing.
    let value: any = extractValueFromReturnValue(returnValue);

    if (!value && (scenario === "object_schema_text" || scenario === "object_auto_text" || scenario === "mixed_dataset_to_object")) {
      const key = `structure:${datasetId}`;
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        const q = await adminDb.query({ thread_contexts: { $: { where: { key }, limit: 1 } } });
        const ctx = q?.thread_contexts?.[0];
        const content: any = ctx?.content ?? {};
        value = content?.structure?.outputs?.object?.value ?? null;
        if (value) break;
        await sleep(750);
      }
      console.log("[structure-e2e] instant value (fallback)", JSON.stringify(value, null, 2));
    } else if (value) {
      console.log("[structure-e2e] value (from returnValue)", JSON.stringify(value, null, 2));
    }

    let rowsOutput: any = null;
    if (
      scenario === "rows_schema_sample_csv" ||
      scenario === "rows_schema_sample_pdf" ||
      scenario === "rows_schema_complex_products_csv" ||
      scenario === "rows_auto_text_csv"
    ) {
      rowsOutput = await readRowsOutput(adminDb, datasetId);
    }

    let trace: any = null;
    if (scenario === "trace_toolcalls") {
      const contextKey = `structure:${datasetId}`;
      const q: any = await adminDb.query({
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
      const settled = toolParts.some((p) => p?.state === "output-available" || p?.state === "output-error");
      trace = { eventsCount: events.length, toolPartsCount: toolParts.length, hasSettledToolPart: settled };
    }

    // For dataset->object scenario, surface the computed object value (from objRes).
    if (scenario === "mixed_dataset_to_object" && !value) {
      value = extractValueFromReturnValue(returnValue);
    }

    // If we still have nothing meaningful for object scenarios, return useful debug info.
    if (!value && (scenario === "object_schema_text" || scenario === "object_auto_text" || scenario === "mixed_dataset_to_object")) {
      return NextResponse.json(
        { error: "Timed out waiting for structure output", runId: run.runId, datasetId, workflowStatus, returnValue },
        { status: 504 },
      );
    }

    return NextResponse.json(
      {
        message: "Structure e2e workflow completed",
        runId: run.runId,
        workflowStatus,
        scenario,
        datasetId,
        value,
        rowsOutput,
        trace,
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Structure e2e failed", details: message }, { status: 500 });
  }
}


