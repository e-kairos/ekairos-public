import { test, expect } from "@playwright/test";
import { init } from "@instantdb/admin";
import { domain } from "@ekairos/domain";
import { eventsDomain } from "@ekairos/events";
import { config as dotenvConfig } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readdirSync, statSync } from "node:fs";
import { createStageTimer } from "./_benchmark";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const smokeDir = resolve(__dirname, "..");
const repoRoot = resolve(smokeDir, "..", "..", "..", "..", "..");

dotenvConfig({ path: resolve(smokeDir, ".env.local"), quiet: true });
dotenvConfig({ path: resolve(smokeDir, ".env"), quiet: true });
dotenvConfig({ path: resolve(repoRoot, ".env.local"), quiet: true });
dotenvConfig({ path: resolve(repoRoot, ".env"), quiet: true });

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
  const appDomain = domain("story-workflow-smoke-test")
    .includes(eventsDomain)
    .schema({ entities: {}, links: {}, rooms: {} });
  return init({ appId, adminToken, schema: appDomain.toInstantSchema() });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function readRows(queryResult: unknown, key: string): Record<string, unknown>[] {
  const root = asRecord(queryResult);
  if (!root) return [];
  const value = root[key];
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

function readString(row: Record<string, unknown> | undefined, key: string): string | null {
  if (!row) return null;
  const value = row[key];
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
}

function emitContextE2EReport(payload: Record<string, unknown>) {
  console.log(`[context-e2e-report] ${JSON.stringify(payload)}`);
}

function getRecentWorkflowRunArtifacts(sinceEpochMs: number) {
  const runsDir = resolve(smokeDir, ".next", "workflow-data", "streams", "runs");
  if (!existsSync(runsDir)) {
    return { count: 0, files: [] as string[] };
  }

  const files = readdirSync(runsDir)
    .filter((entry) => entry.endsWith(".json"))
    .filter((entry) => {
      const absolutePath = resolve(runsDir, entry);
      const { mtimeMs } = statSync(absolutePath);
      return mtimeMs >= sinceEpochMs - 1_000;
    });

  return { count: files.length, files };
}

async function waitForWorkflowArtifacts(sinceEpochMs: number) {
  const deadline = Date.now() + 30_000;
  let artifacts = { count: 0, files: [] as string[] };
  while (Date.now() < deadline) {
    artifacts = getRecentWorkflowRunArtifacts(sinceEpochMs);
    if (artifacts.count > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return artifacts;
}

async function startDurableTurn(
  request: Parameters<typeof test>[0] extends never ? never : any,
  mode: "success" | "tool-error",
  timer?: ReturnType<typeof createStageTimer>,
) {
  const res = timer
    ? await timer.measure("requestShellMs", async () =>
        await request.post(`/api/internal/workflow/story-smoke?mode=${mode}`),
      )
    : await request.post(`/api/internal/workflow/story-smoke?mode=${mode}`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body?.ok).toBe(true);
  const payload = asRecord(body?.data);
  const contextRow = asRecord(payload?.context);
  const triggerRow = asRecord(payload?.trigger);
  const reactionRow = asRecord(payload?.reaction);
  const executionRow = asRecord(payload?.execution);

  expect(readString(contextRow ?? undefined, "id")).toBeTruthy();
  expect(readString(contextRow ?? undefined, "status")).toBe("open_streaming");
  expect(readString(triggerRow ?? undefined, "status")).toBe("stored");
  expect(readString(reactionRow ?? undefined, "status")).toBe("pending");
  expect(readString(executionRow ?? undefined, "status")).toBe("executing");
  expect("workflowRunId" in (executionRow ?? {})).toBe(false);

  return {
    contextId: readString(contextRow ?? undefined, "id"),
    executionId: readString(executionRow ?? undefined, "id"),
  };
}

async function waitForCompletedExecution(executionId: string) {
  const adminDb = getAdminDb();
  const deadline = Date.now() + 60_000;
  let persistedExecution: Record<string, unknown> | null = null;

  while (Date.now() < deadline) {
    const queryResult = await adminDb.query({
      event_executions: {
        $: { where: { id: executionId as any }, limit: 1 },
      },
    });
    const rows = readRows(queryResult, "event_executions");
    persistedExecution = rows[0] ?? null;
    if (
      persistedExecution &&
      readString(persistedExecution, "workflowRunId") &&
      readString(persistedExecution, "status") === "completed"
    ) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }

  expect(persistedExecution).toBeTruthy();
  return {
    adminDb,
    execution: persistedExecution as Record<string, unknown>,
    workflowRunId: readString(persistedExecution ?? undefined, "workflowRunId"),
  };
}

test("story smoke runs context engine with AI SDK mocked model in durable workflow mode", async ({
  request,
}) => {
  test.setTimeout(180_000);
  const startedAt = Date.now();
  const timer = createStageTimer();

  const started = await startDurableTurn(request, "success", timer);
  expect(started.executionId).toBeTruthy();
  expect(started.contextId).toBeTruthy();

  const completed = await timer.measure("waitForWorkflowCompletionMs", async () =>
    await waitForCompletedExecution(String(started.executionId)),
  );
  expect(completed.workflowRunId).toBeTruthy();
  expect(readString(completed.execution, "status")).toBe("completed");

  const verificationQuery = await timer.measure("verificationQueryMs", async () =>
    await completed.adminDb.query({
      event_steps: {
        $: { where: { "execution.id": started.executionId as any }, limit: 50 },
      },
      event_items: {
        $: { where: { "context.id": started.contextId as any }, limit: 50 },
      },
    }),
  );
  const stepRows = readRows(verificationQuery, "event_steps");
  const itemRows = readRows(verificationQuery, "event_items");

  expect(stepRows.length).toBeGreaterThan(0);
  expect(stepRows.some((step) => readString(step, "status") === "completed")).toBe(true);
  expect(itemRows.length).toBeGreaterThan(0);

  const reaction = itemRows.find((item) => readString(item, "type") === "output");
  expect(reaction).toBeTruthy();
  if (!reaction) {
    throw new Error("Missing output reaction item for execution.");
  }
  expect(readString(reaction, "status")).toBe("completed");

  const stepId = readString(stepRows[0], "id");
  expect(stepId).toBeTruthy();
  const partsQuery = await completed.adminDb.query({
    event_parts: {
      $: {
        where: { stepId: stepId as any },
        limit: 50,
        order: { idx: "asc" as const },
      },
    },
  });
  const partRows = readRows(partsQuery, "event_parts");
  const hasToolOutput = partRows.some((row) => {
    const part = asRecord(row.part);
    if (!part) return false;
    return (
      readString(part, "type") === "tool-result" &&
      readString(part, "toolName") === "echo" &&
      readString(part, "state") === "output-available"
    );
  });
  expect(hasToolOutput).toBe(true);

  const recentWorkflowArtifacts = await timer.measure("workflowArtifactsMs", async () =>
    await waitForWorkflowArtifacts(startedAt),
  );
  expect(recentWorkflowArtifacts.count).toBeGreaterThan(0);

  const timings = timer.snapshot();
  emitContextE2EReport({
    test: "story smoke runs context engine with AI SDK mocked model in durable workflow mode",
    mode: "success",
    totalMs: timings.totalMs,
    stageTimingsMs: timings.stageTimingsMs,
    executionId: started.executionId,
    contextId: started.contextId,
    workflowRunId: completed.workflowRunId,
    executionStatus: readString(completed.execution, "status"),
    stepCount: stepRows.length,
    itemCount: itemRows.length,
    reactionStatus: readString(reaction, "status"),
    workflowRunArtifactsCount: recentWorkflowArtifacts.count,
    workflowRunArtifacts: recentWorkflowArtifacts.files,
  });
});

test("story smoke persists tool errors through durable workflow mode", async ({ request }) => {
  test.setTimeout(180_000);
  const startedAt = Date.now();
  const timer = createStageTimer();

  const started = await startDurableTurn(request, "tool-error", timer);
  expect(started.executionId).toBeTruthy();
  expect(started.contextId).toBeTruthy();

  const completed = await timer.measure("waitForWorkflowCompletionMs", async () =>
    await waitForCompletedExecution(String(started.executionId)),
  );
  expect(completed.workflowRunId).toBeTruthy();
  expect(readString(completed.execution, "status")).toBe("completed");

  const verificationQuery = await timer.measure("verificationQueryMs", async () =>
    await completed.adminDb.query({
      event_steps: {
        $: { where: { "execution.id": started.executionId as any }, limit: 50 },
      },
      event_items: {
        $: { where: { "context.id": started.contextId as any }, limit: 50 },
      },
    }),
  );
  const stepRows = readRows(verificationQuery, "event_steps");
  const itemRows = readRows(verificationQuery, "event_items");

  expect(stepRows.length).toBeGreaterThan(0);
  expect(stepRows.some((step) => readString(step, "status") === "completed")).toBe(true);

  const hasPersistedToolError = stepRows.some((step) => {
    const raw =
      step.actionResults ??
      step.actionError ??
      step.errorText ??
      null;
    const text = typeof raw === "string" ? raw : JSON.stringify(raw ?? {});
    return text.includes("echo_failed");
  });
  expect(hasPersistedToolError).toBe(true);

  const reaction = itemRows.find((item) => readString(item, "type") === "output");
  expect(reaction).toBeTruthy();
  if (!reaction) {
    throw new Error("Missing output reaction item for execution.");
  }
  expect(readString(reaction, "status")).toBe("completed");

  const stepId = readString(stepRows[0], "id");
  expect(stepId).toBeTruthy();
  const partsQuery = await completed.adminDb.query({
    event_parts: {
      $: {
        where: { stepId: stepId as any },
        limit: 50,
        order: { idx: "asc" as const },
      },
    },
  });
  const partRows = readRows(partsQuery, "event_parts");
  const hasToolErrorOutput = partRows.some((row) => {
    const part = asRecord(row.part);
    if (!part) return false;
    return (
      readString(part, "type") === "tool-result" &&
      readString(part, "toolName") === "echo" &&
      readString(part, "state") === "output-error"
    );
  });
  expect(hasToolErrorOutput).toBe(true);

  const recentWorkflowArtifacts = await timer.measure("workflowArtifactsMs", async () =>
    await waitForWorkflowArtifacts(startedAt),
  );
  expect(recentWorkflowArtifacts.count).toBeGreaterThan(0);

  const timings = timer.snapshot();
  emitContextE2EReport({
    test: "story smoke persists tool errors through durable workflow mode",
    mode: "tool-error",
    totalMs: timings.totalMs,
    stageTimingsMs: timings.stageTimingsMs,
    executionId: started.executionId,
    contextId: started.contextId,
    workflowRunId: completed.workflowRunId,
    executionStatus: readString(completed.execution, "status"),
    stepCount: stepRows.length,
    itemCount: itemRows.length,
    hasPersistedToolError,
    reactionStatus: readString(reaction, "status"),
    workflowRunArtifactsCount: recentWorkflowArtifacts.count,
    workflowRunArtifacts: recentWorkflowArtifacts.files,
  });
});
