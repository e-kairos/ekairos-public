import { NextRequest, NextResponse } from "next/server";

import "@/runtime";
import {
  getCurrentPreviewRuntimeAppId,
  invalidatePreviewRuntimeApp,
  resolveRuntime,
} from "@/runtime";

type AdminDb = {
  query: (query: unknown) => Promise<unknown>;
  transact: (txs: unknown[]) => Promise<unknown>;
  tx: Record<string, Record<string, { create: (payload: unknown) => unknown; update?: (payload: unknown) => unknown; link: (payload: unknown) => unknown }>>;
};

const CONTEXT_RUNTIME_APP_COOKIE = "ek_context_elements_app_id";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function boolParam(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function makeId(): string {
  return typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildFallbackSnapshot(params: {
  contextKey: string;
  orgId?: string;
  reason: string;
}) {
  const now = Date.now();
  const contextId = makeId();
  const contextId = makeId();
  const userItemId = makeId();
  const assistantItemId = makeId();

  return {
    context: {
      id: contextId,
      key: params.contextKey,
      status: "streaming",
      createdAt: new Date(now - 8_000).toISOString(),
      updatedAt: new Date(now).toISOString(),
    },
    context: {
      id: contextId,
      status: "streaming",
      content: {
        title: "Fallback preview context",
        mode: "fallback",
        orgId: params.orgId ?? "org_preview",
      },
      createdAt: new Date(now - 7_000).toISOString(),
      updatedAt: new Date(now).toISOString(),
    },
    items: [
      {
        id: userItemId,
        type: "input_text",
        channel: "web",
        createdAt: new Date(now - 6_000).toISOString(),
        content: {
          parts: [
            { type: "text", text: `Preview request for context "${params.contextKey}"` },
          ],
        },
      },
      {
        id: assistantItemId,
        type: "output_text",
        channel: "web",
        createdAt: new Date(now - 2_000).toISOString(),
        content: {
          parts: [
            {
              type: "text",
              text: "Runtime fallback is active. Configure Instant credentials to use fully persisted preview data.",
            },
            {
              type: "tool-call",
              toolCallId: `fallback-tool-${makeId()}`,
              toolName: "codex",
              input: { instruction: "Validate preview configuration." },
            },
          ],
        },
      },
    ],
    meta: {
      source: "fallback",
      reason: params.reason,
      fallback: true,
    },
  };
}

async function seedContextDemoData(db: AdminDb, contextKey: string) {
  const now = new Date();
  const oneSecond = 1_000;
  const contextId = makeId();
  const contextId = makeId();
  const userItemId = makeId();
  const assistantItemId = makeId();
  const executionId = makeId();
  const stepId = makeId();
  const partTextId = makeId();
  const partToolId = makeId();

  const userParts = [
    {
      type: "text",
      text: `Explain what ${contextKey} is and propose next actions.`,
    },
  ];

  const assistantParts = [
    {
      type: "text",
      text: "Analyzing current context context and preparing execution plan.",
    },
    {
      type: "tool-call",
      toolCallId: `tool-${makeId()}`,
      toolName: "codex",
      input: { instruction: "Inspect repository and suggest a patch plan." },
    },
    {
      type: "text",
      text: "Plan ready. Waiting for execution confirmation.",
    },
  ];

  await db.transact([
    db.tx.context_contexts[contextId].create({
      key: contextKey,
      name: `Preview ${contextKey}`,
      status: "streaming",
      createdAt: new Date(now.getTime() - oneSecond * 12),
      updatedAt: new Date(now.getTime() - oneSecond * 2),
    }),
    db.tx.context_contexts[contextId].create({
      status: "streaming",
      content: {
        title: "Registry preview context",
        mode: "preview",
        model: "openai/gpt-5.2",
      },
      createdAt: new Date(now.getTime() - oneSecond * 10),
      updatedAt: new Date(now.getTime() - oneSecond * 2),
    }),
    db.tx.context_contexts[contextId].link({ context: contextId }),
    db.tx.context_items[userItemId].create({
      channel: "web",
      type: "input_text",
      status: "completed",
      content: { parts: userParts },
      createdAt: new Date(now.getTime() - oneSecond * 9),
    }),
    db.tx.context_items[userItemId].link({ context: contextId }),
    db.tx.context_items[userItemId].link({ context: contextId }),
    db.tx.context_items[assistantItemId].create({
      channel: "web",
      type: "output_text",
      status: "completed",
      content: { parts: assistantParts },
      createdAt: new Date(now.getTime() - oneSecond * 5),
    }),
    db.tx.context_items[assistantItemId].link({ context: contextId }),
    db.tx.context_items[assistantItemId].link({ context: contextId }),
    db.tx.context_executions[executionId].create({
      status: "executing",
      createdAt: new Date(now.getTime() - oneSecond * 8),
      updatedAt: new Date(now.getTime() - oneSecond * 1),
      workflowRunId: `preview-run-${contextKey}`,
    }),
    db.tx.context_executions[executionId].link({ context: contextId }),
    db.tx.context_executions[executionId].link({ context: contextId }),
    db.tx.context_executions[executionId].link({ trigger: userItemId }),
    db.tx.context_executions[executionId].link({ reaction: assistantItemId }),
    db.tx.context_steps[stepId].create({
      createdAt: new Date(now.getTime() - oneSecond * 7),
      updatedAt: new Date(now.getTime() - oneSecond * 1),
      status: "completed",
      iteration: 1,
      executionId,
      triggerEventId: userItemId,
      reactionEventId: assistantItemId,
      eventId: assistantItemId,
      continueLoop: false,
      toolCalls: [{ toolName: "codex" }],
      toolExecutionResults: [{ success: true }],
    }),
    db.tx.context_steps[stepId].link({ execution: executionId }),
    db.tx.context_parts[partTextId].create({
      key: `${stepId}:0`,
      stepId,
      idx: 0,
      type: "text",
      part: assistantParts[0],
      updatedAt: new Date(now.getTime() - oneSecond * 1),
    }),
    db.tx.context_parts[partTextId].link({ step: stepId }),
    db.tx.context_parts[partToolId].create({
      key: `${stepId}:1`,
      stepId,
      idx: 1,
      type: "tool-call",
      part: assistantParts[1],
      updatedAt: new Date(now.getTime() - oneSecond * 1),
    }),
    db.tx.context_parts[partToolId].link({ step: stepId }),
  ]);
}

async function getContextRow(db: AdminDb, key: string) {
  const contextResultUnknown = await db.query({
    context_contexts: {
      $: { where: { key }, limit: 1 },
    },
  });
  const contextResult = asRecord(contextResultUnknown);
  const contextRows = asArray(contextResult?.context_contexts);
  return contextRows[0] ?? null;
}

async function getSnapshotForContext(params: {
  db: AdminDb;
  key: string;
  ensure: boolean;
}) {
  let contextRow = await getContextRow(params.db, params.key);
  if (!contextRow && params.ensure) {
    await seedContextDemoData(params.db, params.key);
    contextRow = await getContextRow(params.db, params.key);
  }
  if (!contextRow) return null;

  const contextId = asString(contextRow.id);
  const contextResultUnknown = await params.db.query({
    context_contexts: {
      $: { where: { context: contextId }, limit: 1 },
      items: {
        $: {
          order: { createdAt: "asc" },
          limit: 500,
        },
      },
    },
  });

  const contextResult = asRecord(contextResultUnknown);
  const contexts = asArray(contextResult?.context_contexts);
  const contextRow = contexts[0] ?? null;
  const items = contextRow ? asArray(contextRow.items) : [];

  return {
    context: {
      id: asString(contextRow.id),
      key: asString(contextRow.key) || params.key,
      status: asString(contextRow.status) || "open",
      createdAt: contextRow.createdAt ?? null,
      updatedAt: contextRow.updatedAt ?? null,
    },
    context: contextRow
      ? {
          id: asString(contextRow.id),
          status: asString(contextRow.status) || "open",
          content: contextRow.content ?? null,
          createdAt: contextRow.createdAt ?? null,
          updatedAt: contextRow.updatedAt ?? null,
        }
      : null,
    items,
  };
}

function applyRuntimeCookie(
  req: NextRequest,
  response: NextResponse,
  appId: string | null,
) {
  const incoming = req.cookies.get(CONTEXT_RUNTIME_APP_COOKIE)?.value?.trim() || "";
  const next = typeof appId === "string" ? appId.trim() : "";
  if (!next || next === incoming) return;

  response.cookies.set({
    name: CONTEXT_RUNTIME_APP_COOKIE,
    value: next,
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: 60 * 60 * 24 * 2,
  });
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ contextKey: string }> },
) {
  const { contextKey } = await context.params;
  const key = decodeURIComponent(contextKey || "").trim();
  if (!key) {
    return NextResponse.json(
      { error: { code: "context_key_required", message: "contextKey is required" } },
      { status: 400 },
    );
  }

  const orgId = req.nextUrl.searchParams.get("orgId")?.trim() || undefined;
  const ensure = boolParam(req.nextUrl.searchParams.get("ensure"));
  const cookieAppId =
    req.cookies.get(CONTEXT_RUNTIME_APP_COOKIE)?.value?.trim() || undefined;

  const runAttempt = async (params: { appId?: string; forceNewApp?: boolean }) => {
    const runtime = await resolveRuntime({
      orgId,
      appId: params.appId,
      forceNewApp: params.forceNewApp,
    });
    const db = runtime.db as unknown as AdminDb;
    return getSnapshotForContext({ db, key, ensure });
  };

  try {
    let snapshot = await runAttempt({ appId: cookieAppId });
    let resolvedAppId = getCurrentPreviewRuntimeAppId();

    if (!snapshot && cookieAppId) {
      // Context missing on this app can happen when app was rotated/deleted externally.
      invalidatePreviewRuntimeApp(cookieAppId);
      snapshot = await runAttempt({ forceNewApp: true });
      resolvedAppId = getCurrentPreviewRuntimeAppId();
    }

    if (!snapshot) {
      return NextResponse.json(
        { error: { code: "context_not_found", message: `Context "${key}" not found` } },
        { status: 404 },
      );
    }

    const response = NextResponse.json({
      ...snapshot,
      meta: {
        source: "instantdb",
        fallback: false,
      },
    });
    applyRuntimeCookie(req, response, resolvedAppId);
    return response;
  } catch (error) {
    const firstReason =
      error instanceof Error ? error.message : String(error ?? "runtime_error");

    try {
      if (cookieAppId) invalidatePreviewRuntimeApp(cookieAppId);
      const snapshot = await runAttempt({ forceNewApp: true });
      if (snapshot) {
        const response = NextResponse.json({
          ...snapshot,
          meta: {
            source: "instantdb",
            fallback: false,
            recovered: true,
            previousError: firstReason,
          },
        });
        applyRuntimeCookie(req, response, getCurrentPreviewRuntimeAppId());
        return response;
      }
    } catch (secondError) {
      const secondReason =
        secondError instanceof Error
          ? secondError.message
          : String(secondError ?? "runtime_retry_error");
      const fallback = buildFallbackSnapshot({
        contextKey: key,
        orgId,
        reason: `${firstReason} | retry: ${secondReason}`,
      });
      return NextResponse.json(fallback, { status: 200 });
    }

    const fallback = buildFallbackSnapshot({
      contextKey: key,
      orgId,
      reason: firstReason,
    });
    return NextResponse.json(fallback, { status: 200 });
  }
}
