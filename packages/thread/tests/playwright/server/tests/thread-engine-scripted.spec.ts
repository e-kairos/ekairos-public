import { test, expect } from "@playwright/test";
import { init } from "@instantdb/admin";
import { domain } from "@ekairos/domain";
import { threadDomain, THREAD_STREAM_CHUNK_TYPES } from "@ekairos/thread";
import { config as dotenvConfig } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readdirSync, statSync } from "node:fs";

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

test("story smoke runs thread engine with scripted reactor in workflow runtime", async ({ request }) => {
  test.setTimeout(180_000);
  const startedAt = Date.now();

  const res = await request.post("/api/internal/workflow/story-smoke?mode=scripted");
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
  expect(
    streamEvents.some((event) => {
      const type = readString(event, "type");
      return type === "data-context.created" || type === "data-context.resolved";
    }),
  ).toBe(true);
  expect(streamEvents.some((event) => readString(event, "type") === "data-step.created")).toBe(true);
  expect(streamEvents.some((event) => readString(event, "type") === "data-step.completed")).toBe(
    true,
  );
  expect(streamEvents.some((event) => readString(event, "type") === "data-item.completed")).toBe(
    true,
  );
  expect(streamEvents.some((event) => event.type === "finish")).toBe(true);

  const allowedCustomChunkTypes = new Set<string>(THREAD_STREAM_CHUNK_TYPES as readonly string[]);
  const customChunkTypes = streamEvents
    .map((event) => {
      if (readString(event, "type") !== "data-chunk.emitted") return null;
      const data = asRecord(event.data);
      const chunkType = data ? readString(data, "chunkType") : null;
      return chunkType && allowedCustomChunkTypes.has(chunkType) ? chunkType : null;
    })
    .filter((type): type is string => Boolean(type));

  expect(customChunkTypes.includes("chunk.error")).toBe(false);

  const contextChunk = streamEvents.find((event) => {
    const type = readString(event, "type");
    return type === "data-context.created" || type === "data-context.resolved";
  });
  const streamContextId = readString(asRecord(contextChunk?.data) ?? undefined, "contextId");
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
      $: { where: { "execution.id": executionId }, limit: 50 },
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

  const reaction = itemRows.find((item) => readString(item, "type") === "output");
  expect(reaction).toBeTruthy();
  if (!reaction) {
    throw new Error("Missing output reaction item for execution.");
  }

  expect(readString(reaction, "status")).toBe("completed");
  const reactionContent = asRecord(reaction.content);
  const reactionParts = Array.isArray(reactionContent?.parts) ? reactionContent.parts : [];
  const hasToolOutput = reactionParts.some((part) => {
    const row = asRecord(part);
    if (!row) return false;
    return row.type === "tool-echo" && row.state === "output-available";
  });
  expect(hasToolOutput).toBe(true);

  const recentWorkflowArtifacts = getRecentWorkflowRunArtifacts(startedAt);
  expect(recentWorkflowArtifacts.count).toBeGreaterThan(0);

  emitThreadE2EReport({
    test: "story smoke runs thread engine with scripted reactor in workflow runtime",
    mode: "scripted",
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
    workflowRunArtifactsCount: recentWorkflowArtifacts.count,
    workflowRunArtifacts: recentWorkflowArtifacts.files,
  });
});
