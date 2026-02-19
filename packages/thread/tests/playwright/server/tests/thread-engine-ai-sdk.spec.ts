import { test, expect } from "@playwright/test";
import { init } from "@instantdb/admin";
import { domain } from "@ekairos/domain";
import { threadDomain, THREAD_STREAM_CHUNK_TYPES } from "@ekairos/thread";
import { config as dotenvConfig } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const smokeDir = resolve(__dirname, "..");
const repoRoot = resolve(smokeDir, "..", "..", "..", "..", "..");

// Ensure the test process has Instant env (not just the Next server).
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
    .includes(threadDomain)
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

function emitThreadE2EReport(payload: Record<string, unknown>) {
  console.log(`[thread-e2e-report] ${JSON.stringify(payload)}`);
}

test("story smoke runs thread engine with AI SDK mocked model in workflow runtime", async ({ request }) => {
  test.setTimeout(180_000);

  const res = await request.post("/api/internal/workflow/story-smoke");
  expect(res.status()).toBe(200);
  expect(String(res.headers()["content-type"] ?? "")).toContain("text/event-stream");

  const runId = String(res.headers()["x-workflow-run-id"] ?? "");
  expect(runId).toBeTruthy();

  const streamPayloads: string[] = [];
  const streamEvents: Record<string, unknown>[] = [];
  const rawBody = await res.body();
  const text = rawBody.toString("utf8");
  const lines = text.split("\n");
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice(6).trim();
    if (!payload) continue;

    streamPayloads.push(payload);
    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      streamEvents.push(parsed);
    } catch {
      // Ignore non-JSON chunks
    }
  }

  expect(streamPayloads.length).toBeGreaterThan(0);
  expect(streamEvents.some((event) => event.type === "data-context-id")).toBe(true);
  expect(streamEvents.some((event) => event.type === "finish")).toBe(true);
  const allowedCustomChunkTypes = new Set<string>(THREAD_STREAM_CHUNK_TYPES as readonly string[]);
  const customChunks = streamEvents.filter((event) => {
    const type = readString(event, "type");
    return typeof type === "string" && allowedCustomChunkTypes.has(type);
  });
  expect(customChunks.length).toBeGreaterThan(0);
  const firstCustomChunkType = readString(customChunks[0], "type");
  expect(firstCustomChunkType).toBe("data-context-id");
  const lastCustomChunkType = readString(customChunks[customChunks.length - 1], "type");
  expect(lastCustomChunkType).toBe("finish");
  expect(customChunks.some((chunk) => readString(chunk, "type") === "tool-output-available")).toBe(true);
  expect(customChunks.some((chunk) => readString(chunk, "type") === "tool-output-error")).toBe(false);
  const contextChunk = streamEvents.find((event) => event.type === "data-context-id");
  const streamContextId =
    readString(contextChunk, "id") ??
    readString(asRecord(contextChunk?.data) ?? undefined, "contextId");
  expect(streamContextId).toBeTruthy();

  const adminDb = getAdminDb();
  const deadline = Date.now() + 60_000;
  let executions: Record<string, unknown>[] = [];

  while (Date.now() < deadline) {
    const queryResult = await adminDb.query({
      thread_executions: {
        $: { where: { workflowRunId: runId }, limit: 50 },
      },
    });
    executions = readRows(queryResult, "thread_executions");
    if (executions.length > 0) break;
    await new Promise((r) => setTimeout(r, 750));
  }
  expect(executions.length).toBeGreaterThan(0);

  const execution = executions[0];
  expect(readString(execution, "status")).toBe("completed");

  const executionId = readString(execution, "id");
  expect(executionId).toBeTruthy();

  const verificationQuery = await adminDb.query({
    thread_steps: {
      $: { where: { executionId }, limit: 50 },
    },
    thread_items: {
      $: { where: { "context.id": streamContextId }, limit: 50 },
    },
  });
  const stepRows = readRows(verificationQuery, "thread_steps");
  const itemRows = readRows(verificationQuery, "thread_items");
  expect(stepRows.length).toBeGreaterThan(0);
  expect(stepRows.some((step) => readString(step, "status") === "completed")).toBe(true);
  expect(itemRows.length).toBeGreaterThan(0);
  const reaction = itemRows.find((item) => readString(item, "type") === "output_text");
  expect(reaction).toBeTruthy();
  if (!reaction) {
    throw new Error("Missing output_text reaction item for execution.");
  }
  expect(readString(reaction, "status")).toBe("completed");
  const reactionContent = asRecord(reaction.content);
  const reactionParts = Array.isArray(reactionContent?.parts)
    ? reactionContent.parts
    : [];
  const hasToolOutput = reactionParts.some((part) => {
    const row = asRecord(part);
    if (!row) return false;
    return row.type === "tool-echo" && row.state === "output-available";
  });
  expect(hasToolOutput).toBe(true);

  const customChunkTypes = customChunks
    .map((chunk) => readString(chunk, "type"))
    .filter((type): type is string => typeof type === "string");
  const reactionPartStates = reactionParts
    .map((part) => {
      const row = asRecord(part);
      return {
        type: readString(row ?? undefined, "type"),
        state: readString(row ?? undefined, "state"),
      };
    })
    .filter((part) => part.type || part.state);

  emitThreadE2EReport({
    test: "story smoke runs thread engine with AI SDK mocked model in workflow runtime",
    mode: "success",
    runId,
    streamContextId,
    executionId,
    executionStatus: readString(execution, "status"),
    streamPayloadCount: streamPayloads.length,
    customChunkTypes,
    customChunkTypesUnique: [...new Set(customChunkTypes)],
    stepCount: stepRows.length,
    itemCount: itemRows.length,
    reactionStatus: readString(reaction, "status"),
    reactionPartStates,
  });
});

test("story smoke emits tool-output-error chunk in workflow runtime", async ({ request }) => {
  test.setTimeout(180_000);

  const res = await request.post("/api/internal/workflow/story-smoke?mode=tool-error");
  expect(res.status()).toBe(200);
  expect(String(res.headers()["content-type"] ?? "")).toContain("text/event-stream");

  const runId = String(res.headers()["x-workflow-run-id"] ?? "");
  expect(runId).toBeTruthy();

  const streamPayloads: string[] = [];
  const streamEvents: Record<string, unknown>[] = [];
  const rawBody = await res.body();
  const text = rawBody.toString("utf8");
  const lines = text.split("\n");
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice(6).trim();
    if (!payload) continue;

    streamPayloads.push(payload);
    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      streamEvents.push(parsed);
    } catch {
      // Ignore non-JSON chunks
    }
  }

  expect(streamPayloads.length).toBeGreaterThan(0);
  expect(streamEvents.some((event) => event.type === "data-context-id")).toBe(true);
  expect(streamEvents.some((event) => event.type === "finish")).toBe(true);
  const allowedCustomChunkTypes = new Set<string>(THREAD_STREAM_CHUNK_TYPES as readonly string[]);
  const customChunks = streamEvents.filter((event) => {
    const type = readString(event, "type");
    return typeof type === "string" && allowedCustomChunkTypes.has(type);
  });
  expect(customChunks.length).toBeGreaterThan(0);
  const firstCustomChunkType = readString(customChunks[0], "type");
  expect(firstCustomChunkType).toBe("data-context-id");
  const lastCustomChunkType = readString(customChunks[customChunks.length - 1], "type");
  expect(lastCustomChunkType).toBe("finish");
  expect(customChunks.some((chunk) => readString(chunk, "type") === "tool-output-error")).toBe(true);
  expect(customChunks.some((chunk) => readString(chunk, "type") === "tool-output-available")).toBe(false);
  const contextChunk = streamEvents.find((event) => event.type === "data-context-id");
  const streamContextId =
    readString(contextChunk, "id") ??
    readString(asRecord(contextChunk?.data) ?? undefined, "contextId");
  expect(streamContextId).toBeTruthy();

  const adminDb = getAdminDb();
  const deadline = Date.now() + 60_000;
  let executions: Record<string, unknown>[] = [];

  while (Date.now() < deadline) {
    const queryResult = await adminDb.query({
      thread_executions: {
        $: { where: { workflowRunId: runId }, limit: 50 },
      },
    });
    executions = readRows(queryResult, "thread_executions");
    if (executions.length > 0) break;
    await new Promise((r) => setTimeout(r, 750));
  }
  expect(executions.length).toBeGreaterThan(0);

  const execution = executions[0];
  expect(readString(execution, "status")).toBe("completed");

  const executionId = readString(execution, "id");
  expect(executionId).toBeTruthy();

  const verificationQuery = await adminDb.query({
    thread_steps: {
      $: { where: { executionId }, limit: 50 },
    },
    thread_items: {
      $: { where: { "context.id": streamContextId }, limit: 50 },
    },
  });
  const stepRows = readRows(verificationQuery, "thread_steps");
  const itemRows = readRows(verificationQuery, "thread_items");
  expect(stepRows.length).toBeGreaterThan(0);
  expect(stepRows.some((step) => readString(step, "status") === "completed")).toBe(true);
  const hasPersistedToolError = stepRows.some((step) => {
    const raw = step.toolExecutionResults;
    const text = typeof raw === "string" ? raw : JSON.stringify(raw);
    return text.includes("echo_failed");
  });
  expect(hasPersistedToolError).toBe(true);
  expect(itemRows.length).toBeGreaterThan(0);
  const reaction = itemRows.find((item) => readString(item, "type") === "output_text");
  expect(reaction).toBeTruthy();
  if (!reaction) {
    throw new Error("Missing output_text reaction item for execution.");
  }
  expect(readString(reaction, "status")).toBe("completed");
  const reactionContent = asRecord(reaction.content);
  const reactionParts = Array.isArray(reactionContent?.parts)
    ? reactionContent.parts
    : [];
  const hasToolErrorOutput = reactionParts.some((part) => {
    const row = asRecord(part);
    if (!row) return false;
    return row.type === "tool-echo" && row.state === "output-error";
  });
  expect(hasToolErrorOutput).toBe(true);

  const customChunkTypes = customChunks
    .map((chunk) => readString(chunk, "type"))
    .filter((type): type is string => typeof type === "string");
  const reactionPartStates = reactionParts
    .map((part) => {
      const row = asRecord(part);
      return {
        type: readString(row ?? undefined, "type"),
        state: readString(row ?? undefined, "state"),
      };
    })
    .filter((part) => part.type || part.state);

  emitThreadE2EReport({
    test: "story smoke emits tool-output-error chunk in workflow runtime",
    mode: "tool-error",
    runId,
    streamContextId,
    executionId,
    executionStatus: readString(execution, "status"),
    streamPayloadCount: streamPayloads.length,
    customChunkTypes,
    customChunkTypesUnique: [...new Set(customChunkTypes)],
    stepCount: stepRows.length,
    itemCount: itemRows.length,
    hasPersistedToolError,
    reactionStatus: readString(reaction, "status"),
    reactionPartStates,
  });
});
