import { config as dotenvConfig } from "dotenv";
import { resolve } from "node:path";
import { start } from "workflow/api";
import { id } from "@instantdb/admin";

import { structureSmokeWorkflow } from "../src/lib/workflows/structure-smoke.workflow";

// Load env files (same strategy as other runners)
dotenvConfig({ path: resolve(process.cwd(), ".env.local") });
dotenvConfig({ path: resolve(process.cwd(), ".env") });
dotenvConfig({ path: resolve(process.cwd(), "../../../.env.local") });
dotenvConfig({ path: resolve(process.cwd(), "../../../.env") });

function requireEnv(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) throw new Error(`${name}_required`);
  return String(v).trim();
}

function stripSlash(v) {
  return String(v || "").replace(/\/$/, "");
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url, apiKey) {
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  const text = await res.text().catch(() => "");
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, text };
}

async function main() {
  // Where ekairos-core is running
  const ekairosBaseUrl = stripSlash(process.env.EKAIROS_CORE_BASE_URL || "http://localhost:3001");
  const apiKey = requireEnv("EKAIROS_CLERK_API_KEY"); // do not print

  // Evidence: demo project + origin
  console.log("=== DEMO PROJECT EVIDENCE ===");
  console.log(`demo.cwd: ${process.cwd()}`);
  console.log(`demo.script: ${new URL(import.meta.url).pathname}`);
  console.log(`demo.ekairosBaseUrl: ${ekairosBaseUrl}`);
  console.log("demo.originStack:");
  console.log(new Error("demo_trace_origin").stack);
  console.log("");

  // Run the real workflow
  const datasetId = id();
  const env = { orgId: "test-org" };
  const run = await start(structureSmokeWorkflow, [{ env, datasetId }]);
  console.log(`[traces-e2e] workflow started runId=${run.runId} datasetId=${datasetId}`);

  const returnValue = await run.returnValue;
  console.log("[traces-e2e] workflow value", JSON.stringify(returnValue?.value ?? null, null, 2));

  // Verify traces exist in ekairos-core via machine query API (auth by api key)
  const deadline = Date.now() + 90_000;
  let events = null;

  while (Date.now() < deadline) {
    const r = await fetchJson(
      `${ekairosBaseUrl}/api/story/traces/machine/events?workflowRunId=${encodeURIComponent(run.runId)}&limit=20000`,
      apiKey,
    );

    if (r.ok && r.json?.ok && Array.isArray(r.json?.events) && r.json.events.length > 0) {
      events = r.json.events;
      break;
    }

    // Helpful debug if auth is wrong (don't print the key)
    if (!r.ok) {
      console.log(`[traces-e2e] waiting traces... status=${r.status} body=${r.text}`);
    }

    await sleep(1500);
  }

  if (!events) {
    throw new Error(
      `[traces-e2e] traces not found for runId=${run.runId} on ${ekairosBaseUrl} (timed out)`,
    );
  }

  const kinds = Array.from(new Set(events.map((e) => String(e?.event_kind ?? e?.eventKind ?? "")))).sort();
  console.log(`[traces-e2e] traces ok events=${events.length} kinds=${kinds.join(",")}`);

  if (!kinds.includes("story.llm")) {
    throw new Error(`[traces-e2e] expected story.llm trace event, got kinds=${kinds.join(",")}`);
  }

  // Print full trace payloads (requested: "en consola quiero ver trazas")
  console.log("=== EKAIROS_TRACES_JSON_BEGIN ===");
  console.log(JSON.stringify(events, null, 2));
  console.log("=== EKAIROS_TRACES_JSON_END ===");

  console.log(`[traces-e2e] open ekairos UI: ${ekairosBaseUrl}/platform/traces (search runId=${run.runId})`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack || e.message : String(e));
  process.exit(1);
});

