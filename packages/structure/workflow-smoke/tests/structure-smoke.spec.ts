import { test, expect } from "@playwright/test";
import { init } from "@instantdb/admin";
import { domain } from "@ekairos/domain";
import { sandboxDomain } from "@ekairos/sandbox";
import { DatasetService, structureDomain } from "@ekairos/structure";
import { threadDomain } from "@ekairos/thread";
import { config as dotenvConfig } from "dotenv";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

// Ensure the test process has Instant env (not just the Next server).
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const smokeDir = resolve(__dirname, "..");
const repoRoot = resolve(smokeDir, "..", "..", "..");
dotenvConfig({ path: resolve(smokeDir, ".env.local") });
dotenvConfig({ path: resolve(smokeDir, ".env") });
dotenvConfig({ path: resolve(repoRoot, ".env.local") });
dotenvConfig({ path: resolve(repoRoot, ".env") });

function getInstantEnvOrThrow() {
  const appId =
    process.env.NEXT_PUBLIC_INSTANT_APP_ID ||
    process.env.INSTANT_APP_ID ||
    process.env.INSTANTDB_APP_ID;
  const adminToken =
    process.env.INSTANT_APP_ADMIN_TOKEN ||
    process.env.INSTANT_ADMIN_TOKEN ||
    process.env.INSTANTDB_ADMIN_TOKEN;
  if (!appId || !adminToken) {
    throw new Error("Instant env not configured for tests (.env.local missing?)");
  }
  return { appId, adminToken };
}

function getAdminDb() {
  const { appId, adminToken } = getInstantEnvOrThrow();
  const appDomain = domain("structure-workflow-smoke-test")
    .includes(threadDomain)
    .includes(structureDomain)
    .includes(sandboxDomain)
    .schema({ entities: {}, links: {}, rooms: {} });
  return init({ appId, adminToken, schema: appDomain.toInstantSchema() } as any);
}

async function fetchPromptContext(datasetId: string) {
  const contextKey = `structure:${datasetId}`;
  const adminDb: any = getAdminDb();
  const q: any = await adminDb.query({
    thread_contexts: { $: { where: { key: contextKey }, limit: 1 } },
  });
  const ctx = q?.thread_contexts?.[0];
  return (ctx?.content as any)?.promptContext ?? null;
}

test("structure runs inside workflow runtime", async ({ request }) => {
  test.setTimeout(420_000);
  let runId = "unknown";
  try {
    // Evidence: this is the demo project (URL + origin stack).
    console.log(`DEMO_BASE_URL=${test.info().project.use.baseURL ?? ""}`);
    console.log("DEMO_ORIGIN_STACK_BEGIN");
    console.log(new Error("demo_trace_origin").stack);
    console.log("DEMO_ORIGIN_STACK_END");

    const res = await request.post("/api/internal/workflow/structure-smoke", {
      data: { orgId: "test-org" },
    });
    const body = await res.json();

    runId = String(body?.runId ?? "unknown");
    console.log(`WORKFLOW_RUN_ID_START=${runId}`);

    if (res.status() !== 200) {
      console.log("structure-smoke non-200 response body");
      console.log(JSON.stringify(body, null, 2));
    }

    expect(res.status()).toBe(200);
    expect(body).toHaveProperty("datasetId");
    expect(body).toHaveProperty("value");
    expect(body.value).toEqual({ recordCount: 3, currency: "USD" });

    // Validate persisted entities in InstantDB (dataset + story entities).
    const datasetId = String(body.datasetId);
    const contextKey = `structure:${datasetId}`;
    const adminDb: any = getAdminDb();

    const q: any = await adminDb.query({
      thread_contexts: { $: { where: { key: contextKey }, limit: 1 } },
      thread_items: {
        $: {
          where: { "context.key": contextKey },
          order: { createdAt: "asc" },
          limit: 200,
        },
      },
      story_executions: { $: { where: { "context.key": contextKey }, limit: 20 } },
    });

    const ctx = q?.thread_contexts?.[0];
    const events = (q?.thread_items ?? []) as any[];
    const executions = (q?.story_executions ?? []) as any[];

    expect(ctx).toBeTruthy();
    expect(ctx.key).toBe(contextKey);

    // Log persisted ids (so we can debug without relying on story.engine logs)
    console.log(`STRUCTURE_DATASET_ID=${datasetId}`);
    console.log(`STORY_CONTEXT_ID=${String(ctx?.id ?? "")}`);
    console.log(`STORY_EVENTS_COUNT=${events.length}`);
    console.log(`STORY_EVENT_IDS=${events.map((e) => String(e?.id ?? "")).filter(Boolean).join(",")}`);

    const persistedValue =
      ctx?.content?.structure?.outputs?.object?.value ??
      ctx?.content?.structure?.outputs?.object?.resultJson ??
      null;
    expect(persistedValue).toEqual({ recordCount: 3, currency: "USD" });

    console.log("STRUCTURE_DATASET_PREVIEW_BEGIN");
    console.log(
      JSON.stringify(
        {
          datasetId,
          status: ctx?.status ?? null,
          outputs: ctx?.content?.structure?.outputs ?? null,
          inputs: ctx?.content?.structure?.inputs ?? null,
          files: ctx?.content?.structure?.files ?? null,
        },
        null,
        2,
      ),
    );
    console.log("STRUCTURE_DATASET_PREVIEW_END");

    const datasetService = new DatasetService(adminDb);
    const datasetRes = await datasetService.getDatasetById(datasetId);
    expect(datasetRes.ok).toBe(true);

    const rowsRes = await datasetService.readRecordsFromFile(datasetId);
    if (rowsRes.ok) {
      const preview: any[] = [];
      for await (const row of rowsRes.data) {
        preview.push(row);
        if (preview.length >= 3) break;
      }
      console.log(`STRUCTURE_ROWS_PREVIEW=${JSON.stringify(preview)}`);
    } else {
      console.log(`STRUCTURE_ROWS_PREVIEW_SKIPPED=${rowsRes.error}`);
    }

    expect(events.length).toBeGreaterThan(0);
    expect(executions.length).toBeGreaterThan(0);

    const executionIds = executions.map((e) => String(e.id)).filter(Boolean);
    console.log(`STORY_EXECUTION_IDS=${executionIds.join(",")}`);

    const q2: any = await adminDb.query({
      story_steps: {
        $: {
          where: { executionId: { $in: executionIds } },
          order: { createdAt: "asc" },
          limit: 500,
        },
      },
    });
    const steps = (q2?.story_steps ?? []) as any[];
    expect(steps.length).toBeGreaterThan(0);

    const stepIds = steps.map((s) => String(s.id)).filter(Boolean);
    console.log(`STORY_STEPS_COUNT=${steps.length}`);
    console.log(`STORY_STEP_IDS=${stepIds.slice(0, 50).join(",")}`);
    const q3: any = await adminDb.query({
      story_parts: {
        $: {
          where: { stepId: { $in: stepIds } },
          order: { idx: "asc" },
          limit: 5000,
        },
      },
    });
    const parts = (q3?.story_parts ?? []) as any[];
    expect(parts.length).toBeGreaterThan(0);
    console.log(`STORY_PARTS_COUNT=${parts.length}`);
    console.log(
      `STORY_PART_KEYS_SAMPLE=${parts
        .slice(0, 20)
        .map((p) => String(p?.key ?? ""))
        .filter(Boolean)
        .join(",")}`,
    );

    // Deep debug logs: exact JSON for events/steps/parts.
    // This is intentionally verbose to understand toolCallsCount and tool payloads end-to-end.
    console.log("=== STORY_DEBUG_thread_items_JSON_BEGIN ===");
    console.log(
      JSON.stringify(
        events.map((e: any) => ({
          id: e?.id,
          createdAt: e?.createdAt,
          channel: e?.channel,
          type: e?.type,
          status: e?.status,
          content: e?.content,
        })),
        null,
        2,
      ),
    );
    console.log("=== STORY_DEBUG_thread_items_JSON_END ===");

    console.log("=== STORY_DEBUG_STEPS_JSON_BEGIN ===");
    console.log(
      JSON.stringify(
        steps.map((s: any) => ({
          id: s?.id,
          createdAt: s?.createdAt,
          updatedAt: s?.updatedAt,
          status: s?.status,
          iteration: s?.iteration,
          executionId: s?.executionId,
          eventId: s?.eventId,
          triggerEventId: s?.triggerEventId,
          reactionEventId: s?.reactionEventId,
          toolCalls: s?.toolCalls,
          toolExecutionResults: s?.toolExecutionResults,
          continueLoop: s?.continueLoop,
          errorText: s?.errorText,
        })),
        null,
        2,
      ),
    );
    console.log("=== STORY_DEBUG_STEPS_JSON_END ===");

    console.log("=== STORY_DEBUG_PARTS_JSON_BEGIN ===");
    console.log(
      JSON.stringify(
        parts.map((p: any) => ({
          id: p?.id,
          key: p?.key,
          stepId: p?.stepId,
          idx: p?.idx,
          type: p?.type,
          part: p?.part,
          updatedAt: p?.updatedAt,
        })),
        null,
        2,
      ),
    );
    console.log("=== STORY_DEBUG_PARTS_JSON_END ===");

    // Basic integrity checks.
    expect(parts.every((p) => stepIds.includes(String(p.stepId)))).toBe(true);

    // --- ClickHouse traces in ekairos-core (real ingestion; machine auth) ---
    // This is the critical integration: workflow -> story.engine -> writeStoryTraceEvents -> ekairos-core ingest.
    const ekairosBaseUrl = (process.env.EKAIROS_CORE_BASE_URL || "http://localhost:3001").replace(/\/$/, "");
    const ekairosApiKey = process.env.EKAIROS_CLERK_API_KEY || "";
    if (!ekairosApiKey) {
      console.warn("EKAIROS_TRACE_VERIFY_SKIPPED=1 (missing EKAIROS_CLERK_API_KEY)");
      return;
    }
    const ekairosKeyFp = createHash("sha256").update(ekairosApiKey).digest("hex").slice(0, 12);
    console.log(`EKAIROS_BASE_URL=${ekairosBaseUrl}`);
    console.log(`EKAIROS_API_KEY_FP=${ekairosKeyFp}`);

    async function sleep(ms: number) {
      await new Promise((r) => setTimeout(r, ms));
    }

    async function fetchJson<T>(url: string): Promise<T> {
      const res2 = await fetch(url, {
        headers: { authorization: `Bearer ${ekairosApiKey}` },
      } as any);
      const json2 = (await res2.json()) as T;
      return json2;
    }

    const deadline = Date.now() + 90_000;
    let found = false;
    while (Date.now() < deadline) {
      const runsRes = await fetchJson<any>(`${ekairosBaseUrl}/api/story/traces/machine/runs?limit=50`);
      const runs = Array.isArray(runsRes?.runs) ? runsRes.runs : [];
      found = runs.some((r: any) => String(r?.workflowRunId ?? "") === runId);
      if (found) break;
      await sleep(1500);
    }
    expect(found).toBe(true);

    const evRes = await fetchJson<any>(
      `${ekairosBaseUrl}/api/story/traces/machine/runs/${encodeURIComponent(runId)}?limit=20000`,
    );
    const evs = Array.isArray(evRes?.events) ? evRes.events : [];
    expect(evs.length).toBeGreaterThan(0);

    // We expect at least one LLM metering event from story.engine (story.llm).
    const kinds = new Set(evs.map((e: any) => String(e?.event_kind ?? e?.eventKind ?? "")));
    expect(kinds.has("story.llm") || kinds.has("story.review") || kinds.has("story.run")).toBe(true);

    console.log(`EKAIROS_TRACE_EVENTS_COUNT=${evs.length}`);
    console.log(`EKAIROS_TRACE_EVENT_KINDS=${Array.from(kinds).sort().join(",")}`);

    console.log("EKAIROS_TRACES_JSON_BEGIN");
    console.log(JSON.stringify(evs, null, 2));
    console.log("EKAIROS_TRACES_JSON_END");
  } finally {
    console.log(`WORKFLOW_RUN_ID_END=${runId}`);
  }
});

test("structure rows from large file input (workflow smoke)", async ({ request }) => {
  test.setTimeout(420_000);
  let runId = "unknown";
  try {
    const res = await request.post("/api/internal/workflow/structure-smoke", {
      data: { orgId: "test-org", variant: "rows-large" },
    });
    const body = await res.json();

    runId = String(body?.runId ?? "unknown");
    console.log(`WORKFLOW_RUN_ID_START=${runId}`);

    if (res.status() !== 200) {
      console.log("structure-rows-large non-200 response body");
      console.log(JSON.stringify(body, null, 2));
    }

    expect(res.status()).toBe(200);
    expect(body).toHaveProperty("datasetId");

    const datasetId = String(body.datasetId);
    const adminDb: any = getAdminDb();
    const datasetService = new DatasetService(adminDb);

    const datasetRes = await datasetService.getDatasetById(datasetId);
    expect(datasetRes.ok).toBe(true);

    const rowsRes = await datasetService.readRecordsFromFile(datasetId);
    expect(rowsRes.ok).toBe(true);

    const rows: any[] = [];
    for await (const row of rowsRes.ok ? rowsRes.data : []) {
      rows.push(row);
    }

    const dataRows = rows.filter((r) => r?.type === "row").map((r) => r.data);
    console.log(`STRUCTURE_ROWS_LARGE_COUNT=${dataRows.length}`);
    console.log(`STRUCTURE_ROWS_LARGE_PREVIEW=${JSON.stringify(dataRows.slice(0, 5))}`);

    expect(dataRows).toEqual([
      { code: "A1", description: "Widget", price: 10.5 },
      { code: "A2", description: "Gadget", price: 20 },
      { code: "A3", description: "Thing", price: 30.25 },
    ]);
  } finally {
    console.log(`WORKFLOW_RUN_ID_END=${runId}`);
  }
});

test("structure supports sandboxConfig: custom runtime", async ({ request }) => {
  test.setTimeout(420_000);
  const res = await request.post("/api/internal/workflow/structure-smoke", {
    data: {
      orgId: "test-org",
      sandboxConfig: {
        runtime: "python3.12",
        daytona: { ephemeral: true, autoStopIntervalMin: 5 },
      },
    },
  });
  const body = await res.json();
  expect(res.status()).toBe(200);
  const datasetId = String(body.datasetId);
  const promptContext = await fetchPromptContext(datasetId);
  expect(promptContext?.sandboxRuntime).toBe("python3.12");
  expect(promptContext?.sandboxProvider).toBe("daytona");
  expect(promptContext?.sandboxEphemeral).toBe(true);
});

test("structure supports sandboxConfig: declarative image", async ({ request }) => {
  test.setTimeout(420_000);
  const res = await request.post("/api/internal/workflow/structure-smoke", {
    data: {
      orgId: "test-org",
      sandboxConfig: {
        daytona: { image: "declarative", ephemeral: true, autoStopIntervalMin: 5 },
      },
    },
  });
  const body = await res.json();
  expect(res.status()).toBe(200);
  const datasetId = String(body.datasetId);
  const promptContext = await fetchPromptContext(datasetId);
  expect(promptContext?.sandboxImage).toBe("declarative");
  expect(promptContext?.sandboxProvider).toBe("daytona");
});

test("structure supports sandboxConfig: custom volumes", async ({ request }) => {
  test.setTimeout(420_000);
  const res = await request.post("/api/internal/workflow/structure-smoke", {
    data: {
      orgId: "test-org",
      sandboxConfig: {
        daytona: {
          ephemeral: true,
          autoStopIntervalMin: 5,
          volumes: [{ volumeName: "ekairos-structure", mountPath: "/home/daytona/.ekairos" }],
        },
      },
    },
  });
  const body = await res.json();
  expect(res.status()).toBe(200);
  const datasetId = String(body.datasetId);
  const promptContext = await fetchPromptContext(datasetId);
  expect(promptContext?.sandboxVolumeName).toBe("ekairos-structure");
  expect(promptContext?.sandboxVolumeMountPath).toBe("/home/daytona/.ekairos");
});


