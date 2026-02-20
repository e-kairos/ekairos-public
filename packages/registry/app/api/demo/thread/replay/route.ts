import { id } from "@instantdb/admin";
import { NextResponse } from "next/server";
import appDomain from "@/lib/domain";
import { DEMO_CONTEXT_KEY, DEMO_THREAD_KEY } from "@/lib/demo/constants";
import { resolveDemoTenantCredentials } from "@/lib/demo/tenant.service";
import { resolveRegistryRuntime } from "@/runtime";

type ThreadContentPart = Record<string, unknown>;
type ThreadContent = {
  parts?: ThreadContentPart[];
};

type ThreadEventPayload = {
  id: string;
  type: string;
  channel?: string;
  createdAt?: string;
  status?: string;
  content?: ThreadContent;
};

type ReplayAction = "start" | "event" | "finish" | "reset";

type ReplayRequestBody = {
  appId?: string;
  runId?: string;
  action?: ReplayAction;
  sequence?: number;
  event?: ThreadEventPayload;
};

const executionByRun = new Map<string, string>();

function toDate(input?: string): Date {
  if (!input) return new Date();
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return new Date();
  return parsed;
}

function isOutputStreaming(event?: ThreadEventPayload): boolean {
  const parts = Array.isArray(event?.content?.parts) ? event?.content?.parts : [];
  return parts.some((part) => String(part?.state ?? "") === "output-streaming");
}

function isOutputCompleted(event?: ThreadEventPayload): boolean {
  const parts = Array.isArray(event?.content?.parts) ? event?.content?.parts : [];
  const hasOutputAvailable = parts.some(
    (part) => String(part?.state ?? "") === "output-available",
  );
  return hasOutputAvailable || String(event?.status ?? "") === "completed";
}

function resolveItemType(event?: ThreadEventPayload): "input" | "output" {
  if (String(event?.type ?? "").startsWith("user.")) return "input";
  return "output";
}

function resolveItemStatus(event?: ThreadEventPayload): "stored" | "pending" | "completed" {
  const itemType = resolveItemType(event);
  if (itemType === "input") return "completed";
  if (isOutputStreaming(event)) return "pending";
  if (isOutputCompleted(event)) return "completed";
  return "stored";
}

async function ensureDemoContext(params: {
  appId: string;
}) {
  const credentials = await resolveDemoTenantCredentials({ appId: params.appId });
  const runtime = await resolveRegistryRuntime(
    {
      instant: {
        appId: credentials.appId,
        adminToken: credentials.adminToken,
      },
    },
    appDomain,
  );

  const lookup = await runtime.db.query({
    thread_threads: {
      $: { where: { key: DEMO_THREAD_KEY }, limit: 1 },
    },
    thread_contexts: {
      $: { where: { key: DEMO_CONTEXT_KEY }, limit: 1 },
    },
  });

  const existingThread = Array.isArray(lookup.thread_threads)
    ? lookup.thread_threads[0]
    : null;
  const existingContext = Array.isArray(lookup.thread_contexts)
    ? lookup.thread_contexts[0]
    : null;
  const threadId = existingThread?.id ?? id();
  const contextId = existingContext?.id ?? id();

  if (!existingThread || !existingContext) {
    const now = new Date();
    await runtime.db.transact([
      runtime.db.tx.thread_threads[threadId].update({
        createdAt: now,
        updatedAt: now,
        key: DEMO_THREAD_KEY,
        name: "Registry demo thread",
        status: "idle",
      }),
      runtime.db.tx.thread_contexts[contextId]
        .update({
          createdAt: now,
          updatedAt: now,
          key: DEMO_CONTEXT_KEY,
          status: "open",
          content: {
            source: "registry.demo",
          },
        })
        .link({ thread: threadId }),
    ]);
  }

  return {
    runtime,
    threadId,
    contextId,
  };
}

async function resolveExecutionId(params: {
  appId: string;
  runId: string;
  runtime: Awaited<ReturnType<typeof ensureDemoContext>>["runtime"];
}): Promise<string | null> {
  const cacheKey = `${params.appId}:${params.runId}`;
  const cached = executionByRun.get(cacheKey);
  if (cached) return cached;

  const existing = await params.runtime.db.query({
    thread_executions: {
      $: {
        where: { workflowRunId: params.runId },
        limit: 1,
      },
    },
  });
  const row = Array.isArray(existing.thread_executions)
    ? existing.thread_executions[0]
    : null;
  if (!row?.id) return null;
  executionByRun.set(cacheKey, row.id);
  return row.id;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ReplayRequestBody;
    const appId = String(body?.appId ?? "").trim();
    const action = body?.action;

    if (!appId) {
      return NextResponse.json(
        { ok: false, error: "appId is required." },
        { status: 400 },
      );
    }
    if (!action) {
      return NextResponse.json(
        { ok: false, error: "action is required." },
        { status: 400 },
      );
    }

    const { runtime, threadId, contextId } = await ensureDemoContext({ appId });
    const now = new Date();

    if (action === "reset") {
      const executionRows = await runtime.db.query({
        thread_executions: {
          $: { where: { "context.id": contextId }, limit: 500 },
        },
        thread_items: {
          $: { where: { "context.id": contextId }, limit: 500 },
        },
        thread_steps: {
          $: { limit: 1000 },
          execution: {},
        },
        thread_parts: {
          $: { limit: 2000 },
          step: {},
        },
      });

      const executionIds = new Set(
        (Array.isArray(executionRows.thread_executions) ? executionRows.thread_executions : [])
          .map((row) => row.id)
          .filter(Boolean),
      );
      const itemIds = (Array.isArray(executionRows.thread_items) ? executionRows.thread_items : [])
        .map((row) => row.id)
        .filter(Boolean);
      const stepIds = (Array.isArray(executionRows.thread_steps) ? executionRows.thread_steps : [])
        .filter((step) => executionIds.has((step.execution?.id as string) ?? ""))
        .map((step) => step.id)
        .filter(Boolean);
      const partIds = (Array.isArray(executionRows.thread_parts) ? executionRows.thread_parts : [])
        .filter((part) => stepIds.includes((part.step?.id as string) ?? ""))
        .map((part) => part.id)
        .filter(Boolean);

      const tx = [];
      for (const partId of partIds) tx.push(runtime.db.tx.thread_parts[partId].delete());
      for (const stepId of stepIds) tx.push(runtime.db.tx.thread_steps[stepId].delete());
      for (const itemId of itemIds) tx.push(runtime.db.tx.thread_items[itemId].delete());
      for (const executionId of executionIds)
        tx.push(runtime.db.tx.thread_executions[executionId].delete());

      tx.push(
        runtime.db.tx.thread_threads[threadId].update({
          updatedAt: now,
          status: "idle",
        }),
      );

      if (tx.length > 0) {
        await runtime.db.transact(tx);
      }

      for (const key of executionByRun.keys()) {
        if (key.startsWith(`${appId}:`)) {
          executionByRun.delete(key);
        }
      }

      return NextResponse.json({
        ok: true,
        data: {
          action,
          appId,
          threadId,
          contextId,
          deleted: {
            items: itemIds.length,
            steps: stepIds.length,
            parts: partIds.length,
            executions: executionIds.size,
          },
        },
      });
    }

    const runId = String(body?.runId ?? "").trim();
    if (!runId) {
      return NextResponse.json(
        { ok: false, error: "runId is required for this action." },
        { status: 400 },
      );
    }

    const cacheKey = `${appId}:${runId}`;

    if (action === "start") {
      const executionId = id();
      executionByRun.set(cacheKey, executionId);
      await runtime.db.transact([
        runtime.db.tx.thread_threads[threadId].update({
          updatedAt: now,
          status: "streaming",
        }),
        runtime.db.tx.thread_contexts[contextId]
          .update({
            updatedAt: now,
            status: "open",
            content: {
              source: "registry.demo",
              runId,
            },
          })
          .link({ thread: threadId, currentExecution: executionId }),
        runtime.db.tx.thread_executions[executionId]
          .update({
            createdAt: now,
            updatedAt: now,
            status: "executing",
            workflowRunId: runId,
          })
          .link({ thread: threadId, context: contextId }),
      ]);

      return NextResponse.json({
        ok: true,
        data: {
          action,
          appId,
          runId,
          executionId,
          threadId,
          contextId,
        },
      });
    }

    const executionId =
      (await resolveExecutionId({ appId, runId, runtime })) ?? id();
    executionByRun.set(cacheKey, executionId);

    if (action === "event") {
      const sequence = Number.isFinite(body?.sequence) ? Number(body.sequence) : 0;
      const event = body?.event;
      if (!event || !event.id) {
        return NextResponse.json(
          { ok: false, error: "event payload is required." },
          { status: 400 },
        );
      }

      const itemId = id();
      const stepId = id();
      const createdAt = toDate(event.createdAt);
      const itemStatus = resolveItemStatus(event);
      const stepStatus = itemStatus === "pending" ? "running" : "completed";
      const parts = Array.isArray(event.content?.parts) ? event.content.parts : [];

      const tx = [
        runtime.db.tx.thread_items[itemId]
          .update({
            channel: String(event.channel ?? "web"),
            createdAt: createdAt,
            type: resolveItemType(event),
            content: event.content ?? { parts: [] },
            status: itemStatus,
          })
          .link({ thread: threadId, context: contextId, execution: executionId }),
        runtime.db.tx.thread_steps[stepId]
          .update({
            createdAt: createdAt,
            updatedAt: now,
            status: stepStatus,
            iteration: sequence,
            kind: "message",
          })
          .link({ execution: executionId }),
      ];

      for (let idx = 0; idx < parts.length; idx += 1) {
        tx.push(
          runtime.db.tx.thread_parts[id()]
            .update({
              key: `${stepId}:${idx}`,
              stepId: stepId,
              idx,
              type: String(parts[idx]?.type ?? "unknown"),
              part: parts[idx] ?? {},
              updatedAt: now,
            })
            .link({ step: stepId }),
        );
      }

      await runtime.db.transact(tx);

      return NextResponse.json({
        ok: true,
        data: {
          action,
          appId,
          runId,
          executionId,
          itemId,
          stepId,
          sequence,
          itemStatus,
          stepStatus,
          partCount: parts.length,
        },
      });
    }

    if (action === "finish") {
      const runningSteps = await runtime.db.query({
        thread_steps: {
          $: {
            where: {
              "execution.id": executionId,
              status: "running",
            },
            limit: 200,
          },
        },
      });

      const tx = [];
      const rows = Array.isArray(runningSteps.thread_steps) ? runningSteps.thread_steps : [];
      for (const step of rows) {
        tx.push(
          runtime.db.tx.thread_steps[step.id].update({
            updatedAt: now,
            status: "completed",
          }),
        );
      }
      tx.push(
        runtime.db.tx.thread_executions[executionId].update({
          updatedAt: now,
          status: "completed",
        }),
      );
      tx.push(
        runtime.db.tx.thread_threads[threadId].update({
          updatedAt: now,
          status: "idle",
        }),
      );
      tx.push(
        runtime.db.tx.thread_contexts[contextId]
          .update({
            updatedAt: now,
            status: "open",
          })
          .link({ currentExecution: executionId }),
      );

      await runtime.db.transact(tx);
      executionByRun.delete(cacheKey);

      return NextResponse.json({
        ok: true,
        data: {
          action,
          appId,
          runId,
          executionId,
          completedRunningSteps: rows.length,
        },
      });
    }

    return NextResponse.json(
      { ok: false, error: `Unsupported action: ${String(action)}` },
      { status: 400 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 },
    );
  }
}
