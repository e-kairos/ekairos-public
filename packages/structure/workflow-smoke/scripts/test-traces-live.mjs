import { config as dotenvConfig } from "dotenv";
import { resolve } from "node:path";
import { start } from "workflow/api";
import { id } from "@instantdb/admin";

import { structureSmokeWorkflow } from "../src/lib/workflows/structure-smoke.workflow";

// Load env files (same strategy as route.ts / tests)
dotenvConfig({ path: resolve(process.cwd(), ".env.local") });
dotenvConfig({ path: resolve(process.cwd(), ".env") });
dotenvConfig({ path: resolve(process.cwd(), "../../../.env.local") });
dotenvConfig({ path: resolve(process.cwd(), "../../../.env") });

function requireEnv(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) {
    throw new Error(`${name}_required`);
  }
  return String(v).trim();
}

// Ensure trace delivery target defaults to localhost:3001 (ekairos-core)
process.env.EKAIROS_CORE_BASE_URL = process.env.EKAIROS_CORE_BASE_URL || "http://localhost:3001";
process.env.EKAIROS_TRACES_BASE_URL = process.env.EKAIROS_TRACES_BASE_URL || process.env.EKAIROS_CORE_BASE_URL;

// Required for trace ingestion auth (do NOT print this)
requireEnv("EKAIROS_CLERK_API_KEY");

async function main() {
  const datasetId = id();
  const env = { orgId: "test-org" };

  const run = await start(structureSmokeWorkflow, [{ env, datasetId }]);
  console.log(`[workflow-smoke] started runId=${run.runId} datasetId=${datasetId}`);

  // Wait for completion (this runs the whole workflow)
  const returnValue = await run.returnValue;
  console.log("[workflow-smoke] returnValue (sanitized)", JSON.stringify(returnValue?.value ?? null, null, 2));

  console.log("");
  console.log("=== EKAIROS TRACE CHECK ===");
  console.log(`Ekairos ingest base: ${process.env.EKAIROS_CORE_BASE_URL}`);
  console.log(`workflowRunId: ${run.runId}`);
  console.log("Open Ekairos UI: /platform/traces and search the newest run by workflowRunId.");
  console.log(
    "If you don't see it, check that EKAIROS_CLERK_API_KEY is an Org API key from Ekairos' Clerk and that ekairos-core is running on port 3001.",
  );
}

main().catch((e) => {
  console.error("[workflow-smoke] failed:", e instanceof Error ? e.stack || e.message : String(e));
  process.exit(1);
});

