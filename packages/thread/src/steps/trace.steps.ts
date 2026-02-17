import "../polyfills/dom-events.js";
import type { ThreadEnvironment } from "../thread.config.js";
import { lookup } from "@instantdb/admin";

function requireBaseUrl(): string {
  const baseUrl =
    process.env.EKAIROS_CORE_BASE_URL ||
    process.env.EKAIROS_TRACES_BASE_URL ||
    process.env.EKAIROS_BASE_URL;
  if (!baseUrl) {
    throw new Error("[thread/trace] Missing EKAIROS_CORE_BASE_URL (or EKAIROS_TRACES_BASE_URL)");
  }
  return baseUrl.replace(/\/$/, "");
}

function requireToken(): string {
  // Preferred: Clerk org API key (opaque token) for ekairos-core.
  const apiKey = process.env.EKAIROS_CLERK_API_KEY;
  if (apiKey) return apiKey;

  throw new Error("[thread/trace] Missing EKAIROS_CLERK_API_KEY");
}

type JwtCache = { token: string; expMs: number };
let jwtCache: JwtCache | null = null;

function parseJwtExpMs(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8"),
    );
    const exp = typeof payload?.exp === "number" ? payload.exp : null;
    return exp ? exp * 1000 : null;
  } catch {
    return null;
  }
}

async function getTraceAuthHeader(baseUrl: string, projectId: string): Promise<string> {
  const apiKey = requireToken();
  const now = Date.now();
  if (jwtCache && jwtCache.expMs - 60_000 > now) {
    return `Bearer ${jwtCache.token}`;
  }

  try {
    const res = await fetch(`${baseUrl}/api/thread/traces/auth`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ projectId }),
    });
    if (res.ok) {
      const json = (await res.json()) as any;
      const token = typeof json?.token === "string" ? json.token : "";
      const expMs = parseJwtExpMs(token) ?? now + 60 * 60 * 1000;
      if (token) {
        jwtCache = { token, expMs };
        return `Bearer ${token}`;
      }
    }
  } catch {
    // fall back to API key below
  }

  return `Bearer ${apiKey}`;
}

export type ThreadTraceEventWrite = {
  workflowRunId: string;
  eventId: string;
  eventKind: string;
  seq?: number;
  eventAt?: string;
  contextKey?: string;
  spanId?: string;
  parentSpanId?: string;
  contextId?: string;
  executionId?: string;
  stepId?: string;
  contextEventId?: string;
  toolCallId?: string;
  partKey?: string;
  partIdx?: number;
  isDeleted?: boolean;

  // Compute metering (LLM usage)
  aiProvider?: string;
  aiModel?: string;
  promptTokens?: number;
  promptTokensCached?: number;
  promptTokensUncached?: number;
  completionTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
  cacheCostUsd?: number;
  computeCostUsd?: number;
  costUsd?: number;

  payload?: unknown;
  testId?: string;
};

async function readProjectId(): Promise<string> {
  const { getRuntimeProjectId } = await import("@ekairos/domain/runtime");
  const fromConfig = String(getRuntimeProjectId() || "").trim();
  if (fromConfig) return fromConfig;
  const fallback =
    typeof process !== "undefined" && process.env
      ? String(process.env.EKAIROS_PROJECT_ID || "").trim()
      : "";
  return fallback;
}

export async function writeThreadTraceEvents(params: {
  env: ThreadEnvironment;
  events: ThreadTraceEventWrite[];
}) {
  if (!params.events?.length) return;

  const envTrace = (params.env as any)?.traces as
    | { baseUrl?: string; apiKey?: string; projectId?: string; strict?: boolean }
    | undefined;

  // Tracing must NEVER break workflows by default.
  // Use EKAIROS_TRACES_STRICT=1 if you want to fail hard.
  const strict = envTrace?.strict === true || process.env.EKAIROS_TRACES_STRICT === "1";
  // 1) Local trace persistence (InstantDB source of truth).
  try {
    const { getThreadRuntime } = await import("@ekairos/thread/runtime");
    const runtime = await getThreadRuntime(params.env);
    const db: any = (runtime as any)?.db;
    if (db) {
      const now = new Date();
      const orgId =
        typeof (params.env as any)?.orgId === "string"
          ? String((params.env as any).orgId)
          : "";
      const projectId = await readProjectId();

      const byRun = new Map<string, ThreadTraceEventWrite[]>();
      for (const ev of params.events) {
        const runId = String(ev.workflowRunId || "");
        if (!runId) continue;
        if (!byRun.has(runId)) byRun.set(runId, []);
        byRun.get(runId)!.push(ev);
      }

      const seqByRun = new Map<string, number>();
      const existingCountByRun = new Map<string, number>();
      for (const [runId] of byRun) {
        let existingCount = 0;
        try {
          const q = await db.query({
            thread_trace_runs: {
              $: { where: { workflowRunId: runId }, limit: 1 },
            },
          });
          const row = q?.thread_trace_runs?.[0];
          existingCount = Number(row?.eventsCount ?? 0) || 0;
        } catch {
          // ignore
        }
        existingCountByRun.set(runId, existingCount);
        seqByRun.set(runId, existingCount);
      }

      const txs: any[] = [];
      const spanTxs: any[] = [];
      for (const ev of params.events) {
        const runId = String(ev.workflowRunId || "");
        if (!runId) continue;
        const key = `${runId}:${String(ev.eventId || "")}`;
        if (!key.includes(":")) continue;
        const eventAt =
          typeof ev.eventAt === "string" && ev.eventAt
            ? new Date(ev.eventAt)
            : undefined;

        let seq = Number.isFinite(Number(ev.seq)) ? Number(ev.seq) : undefined;
        if (typeof seq !== "number") {
          const current = seqByRun.get(runId) ?? 0;
          const next = current + 1;
          seqByRun.set(runId, next);
          seq = next;
        }
        ev.seq = seq;

        txs.push(
          db.tx.thread_trace_events[lookup("key", key)].update({
            key,
            workflowRunId: runId,
            seq,
            eventId: String(ev.eventId || ""),
            eventKind: String(ev.eventKind || ""),
            eventAt: eventAt ?? undefined,
            ingestedAt: now,
            orgId: orgId || undefined,
            projectId: projectId || undefined,
            contextKey: ev.contextKey,
            spanId: ev.spanId,
            parentSpanId: ev.parentSpanId,
            contextId: ev.contextId,
            executionId: ev.executionId,
            stepId: ev.stepId,
            contextEventId: ev.contextEventId,
            toolCallId: ev.toolCallId,
            partKey: ev.partKey,
            partIdx: ev.partIdx,
            isDeleted: ev.isDeleted === true,
            aiProvider: ev.aiProvider,
            aiModel: ev.aiModel,
            promptTokens: ev.promptTokens,
            promptTokensCached: ev.promptTokensCached,
            promptTokensUncached: ev.promptTokensUncached,
            completionTokens: ev.completionTokens,
            totalTokens: ev.totalTokens,
            latencyMs: ev.latencyMs,
            cacheCostUsd: ev.cacheCostUsd,
            computeCostUsd: ev.computeCostUsd,
            costUsd: ev.costUsd,
            payload: ev.payload,
          }),
        );

        if (ev.eventKind === "thread.step" || ev.eventKind === "workflow.step") {
          const spanId = String(ev.stepId || ev.eventId || key);
          spanTxs.push(
            db.tx.thread_trace_spans[lookup("spanId", spanId)].update({
              spanId,
              parentSpanId: ev.parentSpanId,
              workflowRunId: runId,
              executionId: ev.executionId,
              stepId: ev.stepId,
              kind: ev.eventKind,
              name: ev.eventKind,
              status: "completed",
              startedAt: eventAt ?? now,
              endedAt: eventAt ?? now,
              durationMs: 0,
              payload: ev.payload,
            }),
          );
        }
      }

      if (txs.length) {
        await db.transact(txs);
      }
      if (spanTxs.length) {
        await db.transact(spanTxs);
      }
      for (const [runId, events] of byRun) {
        const eventDates = events
          .map((e) =>
            typeof e.eventAt === "string" && e.eventAt
              ? new Date(e.eventAt)
              : now,
          )
          .filter((d) => !Number.isNaN(d.getTime()));

        const firstEventAt = eventDates.length
          ? new Date(Math.min(...eventDates.map((d) => d.getTime())))
          : now;
        const lastEventAt = eventDates.length
          ? new Date(Math.max(...eventDates.map((d) => d.getTime())))
          : now;

        const existingCount = existingCountByRun.get(runId) ?? 0;

        await db.transact([
          db.tx.thread_trace_runs[lookup("workflowRunId", runId)].update({
            workflowRunId: runId,
            orgId: orgId || undefined,
            projectId: projectId || undefined,
            firstEventAt,
            lastEventAt,
            lastIngestedAt: now,
            eventsCount: existingCount + events.length,
          }),
        ]);
      }
    }
  } catch (e) {
    if (strict) throw e;
  }

  let baseUrl = "";
  try {
    baseUrl = envTrace?.baseUrl ? String(envTrace.baseUrl).replace(/\/$/, "") : requireBaseUrl();
  } catch (e) {
    if (strict) throw e;
    return;
  }

  const projectId = envTrace?.projectId ? String(envTrace.projectId).trim() : await readProjectId();
  if (!projectId) {
    if (strict) throw new Error("[thread/trace] Missing projectId (ekairosConfig or EKAIROS_PROJECT_ID)");
    return;
  }

  const authHeader = envTrace?.apiKey
    ? `Bearer ${String(envTrace.apiKey).trim()}`
    : await getTraceAuthHeader(baseUrl, projectId);
  const res = await fetch(`${baseUrl}/api/thread/traces/ingest`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: authHeader,
    },
    body: JSON.stringify({ projectId, events: params.events }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (strict) {
      throw new Error(`[thread/trace] ekairos-core ingest failed (${res.status}): ${text}`);
    }
    if (process.env.PLAYWRIGHT_TEST === "1") {
      // eslint-disable-next-line no-console
      console.warn(`[thread/trace] ingest failed (${res.status}): ${text}`);
    }
    return;
  }
}


