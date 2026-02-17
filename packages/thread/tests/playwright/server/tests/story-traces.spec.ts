import { test, expect } from "@playwright/test";
import { init } from "@instantdb/admin";
import { domain } from "@ekairos/domain";
import { threadDomain } from "@ekairos/thread";
import { config as dotenvConfig } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const smokeDir = resolve(__dirname, "..");
const repoRoot = resolve(smokeDir, "..", "..", "..", "..", "..");

// Ensure the test process has Instant env (not just the Next server).
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
  const appDomain = domain("story-workflow-smoke-test")
    .includes(threadDomain)
    .schema({ entities: {}, links: {}, rooms: {} });
  return init({ appId, adminToken, schema: appDomain.toInstantSchema() } as any);
}

test("story smoke generates local trace events", async ({ request }) => {
  test.setTimeout(180_000);

  const res = await request.post("/api/internal/workflow/story-smoke", {
    data: { orgId: "test-org" },
  });
  const body = await res.json();

  expect(res.status()).toBe(200);
  const runId = String(body?.runId ?? "");
  expect(runId).toBeTruthy();

  const adminDb: any = getAdminDb();
  const deadline = Date.now() + 60_000;
  let events: any[] = [];
  while (Date.now() < deadline) {
    const q = await adminDb.query({
      thread_trace_events: {
        $: { where: { workflowRunId: runId }, limit: 2000 },
      },
    });
    events = (q?.thread_trace_events ?? []) as any[];
    if (events.length > 0) break;
    await new Promise((r) => setTimeout(r, 750));
  }

  console.log(`STORY_TRACE_EVENTS_COUNT=${events.length}`);
  console.log(`STORY_TRACE_EVENT_KINDS=${events.map((e) => String(e?.eventKind ?? e?.event_kind ?? "")).join(",")}`);

  expect(events.length).toBeGreaterThan(0);
});
