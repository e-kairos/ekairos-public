import { NextResponse } from "next/server";
import appDomain from "@/lib/domain";
import { DEMO_CONTEXT_KEY, DEMO_THREAD_KEY } from "@/lib/demo/constants";
import { resolveDemoTenantCredentials } from "@/lib/demo/tenant.service";
import { resolveRegistryRuntime } from "@/runtime";

type EntityRow = Record<string, unknown>;

function formatDate(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return null;
}

function pickEntity(row: EntityRow, fields: string[]) {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (field in row) {
      const value = row[field];
      out[field] = value instanceof Date ? value.toISOString() : value;
    }
  }
  return out;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const appId = String(searchParams.get("appId") ?? "").trim();

    if (!appId) {
      return NextResponse.json(
        { ok: false, error: "appId is required." },
        { status: 400 },
      );
    }

    const credentials = await resolveDemoTenantCredentials({ appId });
    const runtime = await resolveRegistryRuntime(
      {
        instant: {
          appId: credentials.appId,
          adminToken: credentials.adminToken,
        },
      },
      appDomain,
    );

    const base = await runtime.db.query({
      thread_threads: {
        $: { where: { key: DEMO_THREAD_KEY }, limit: 1 },
      },
      thread_contexts: {
        $: { where: { key: DEMO_CONTEXT_KEY }, limit: 1 },
      },
    });

    const thread = Array.isArray(base.thread_threads) ? base.thread_threads[0] : null;
    const context = Array.isArray(base.thread_contexts) ? base.thread_contexts[0] : null;
    const threadId = thread?.id ?? null;
    const contextId = context?.id ?? null;

    if (!threadId || !contextId) {
      return NextResponse.json({
        ok: true,
        data: {
          appId,
          threadId,
          contextId,
          thread: thread ? pickEntity(thread, ["id", "key", "name", "status", "createdAt", "updatedAt"]) : null,
          context: context
            ? pickEntity(context, ["id", "key", "status", "createdAt", "updatedAt", "content"])
            : null,
          counts: {
            executions: 0,
            items: 0,
            steps: 0,
            parts: 0,
          },
          entities: {
            executions: [],
            items: [],
            steps: [],
            parts: [],
          },
        },
      });
    }

    const query = await runtime.db.query({
      thread_executions: {
        $: {
          where: { "context.id": contextId },
          limit: 50,
        },
      },
      thread_items: {
        $: {
          where: { "context.id": contextId },
          order: { createdAt: "asc" },
          limit: 200,
        },
      },
      thread_steps: {
        $: {
          order: { createdAt: "asc" },
          limit: 500,
        },
        execution: {},
      },
      thread_parts: {
        $: {
          order: { idx: "asc" },
          limit: 1000,
        },
        step: {},
      },
    });

    const executionRows = Array.isArray(query.thread_executions) ? query.thread_executions : [];
    executionRows.sort((a, b) => {
      const aMs = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
      const bMs = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
      return bMs - aMs;
    });
    const executionIds = new Set(executionRows.map((row) => row.id));

    const itemRows = Array.isArray(query.thread_items) ? query.thread_items : [];
    const stepRowsAll = Array.isArray(query.thread_steps) ? query.thread_steps : [];
    const stepRows = stepRowsAll.filter((row) =>
      executionIds.has((row.execution?.id as string) ?? ""),
    );
    const stepIds = new Set(stepRows.map((row) => row.id));
    const partRowsAll = Array.isArray(query.thread_parts) ? query.thread_parts : [];
    const partRows = partRowsAll.filter((row) => stepIds.has((row.step?.id as string) ?? ""));

    const formattedExecutions = executionRows.map((row) =>
      pickEntity(row, ["id", "status", "workflowRunId", "createdAt", "updatedAt"]),
    );
    const formattedItems = itemRows.map((row) =>
      pickEntity(row, ["id", "type", "status", "channel", "createdAt", "content"]),
    );
    const formattedSteps = stepRows.map((row) => ({
      ...pickEntity(row, ["id", "status", "iteration", "kind", "createdAt", "updatedAt"]),
      executionId: (row.execution?.id as string) ?? null,
    }));
    const formattedParts = partRows.map((row) => ({
      ...pickEntity(row, ["id", "key", "idx", "type", "part", "updatedAt"]),
      stepId: (row.step?.id as string) ?? null,
    }));

    const latestExecution = formattedExecutions[0] as Record<string, unknown> | undefined;
    const latestExecutionAt = latestExecution
      ? formatDate(latestExecution.createdAt)
      : null;

    return NextResponse.json({
      ok: true,
      data: {
        appId,
        threadId,
        contextId,
        thread: pickEntity(thread, ["id", "key", "name", "status", "createdAt", "updatedAt"]),
        context: pickEntity(context, ["id", "key", "status", "createdAt", "updatedAt", "content"]),
        counts: {
          executions: formattedExecutions.length,
          items: formattedItems.length,
          steps: formattedSteps.length,
          parts: formattedParts.length,
        },
        latestExecutionAt,
        entities: {
          executions: formattedExecutions,
          items: formattedItems,
          steps: formattedSteps,
          parts: formattedParts,
        },
      },
    });
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
