import { NextResponse } from "next/server";
import {
  createContext,
  INPUT_TEXT_ITEM_TYPE,
  WEB_CHANNEL,
  type ContextItem,
} from "@ekairos/events";
import {
  readPersistedContextStepStream,
  resolveContextExecutionStreamPointer,
  type ContextEnvironment,
} from "@ekairos/events/runtime";
import {
  createCodexReactor,
  type CodexConfig,
} from "@ekairos/openai-reactor";
import appDomain from "@/lib/domain";
import { resolveDemoTenantCredentials } from "@/lib/demo/tenant.service";
import {
  deriveLlmFromAssistantEvent,
  asRecord,
  asString,
  buildProviderPersistenceAudit,
  getCommandExecutionPartsFromStreamTrace,
  getCommandExecutionParts,
  resolveTurnMetadata,
  summarizeTrace,
} from "@/lib/examples/reactors/codex/shared";
import { runCodexTurn } from "@/lib/examples/reactors/codex/app-server-bridge";
import type {
  LiveReactorShowcaseRunResponse,
  ReactorShowcaseEntitiesResponse,
} from "@/lib/examples/reactors/types";
import { resolveRegistryRuntime } from "@/runtime";

export const runtime = "nodejs";

type CodexShowcaseRequestBody = {
  prompt?: string;
  appId?: string;
  adminToken?: string;
  contextId?: string;
  triggerEventId?: string;
  providerContextId?: string;
  model?: string;
  repoPath?: string;
  approvalPolicy?: string;
};

type CodexShowcaseEnv = ContextEnvironment & {
  instant: {
    appId: string;
    adminToken: string;
  };
  appServerUrl: string;
  repoPath: string;
  providerContextId?: string;
  model?: string;
  approvalPolicy?: string;
};

type EntityRow = Record<string, unknown>;

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const text = asString(value).trim();
  if (!text) return new Date().toISOString();
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

function makeId(prefix: string): string {
  const maybeUuid = globalThis.crypto?.randomUUID?.();
  if (maybeUuid) return `${prefix}:${maybeUuid}`;
  return `${prefix}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

function makeUuid(): string {
  const maybeUuid = globalThis.crypto?.randomUUID?.();
  if (maybeUuid) return maybeUuid;
  return "00000000-0000-4000-8000-000000000000";
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim(),
  );
}

function buildTriggerEvent(prompt: string, triggerEventId?: string): ContextItem {
  return {
    id: asString(triggerEventId).trim() || makeUuid(),
    type: INPUT_TEXT_ITEM_TYPE,
    channel: WEB_CHANNEL,
    createdAt: new Date().toISOString(),
    status: "stored",
    content: {
      parts: [{ type: "text", text: prompt }],
    },
  };
}

function normalizeContextItem(value: unknown, fallback: ContextItem): ContextItem {
  const row = asRecord(value);
  const content = asRecord(row.content);
  const parts = Array.isArray(content.parts)
    ? content.parts
    : Array.isArray(fallback.content?.parts)
      ? fallback.content.parts
      : [];

  return {
    id: asString(row.id) || fallback.id || makeId("item"),
    type: (asString(row.type) || fallback.type) as ContextItem["type"],
    channel: (asString(row.channel) || fallback.channel || WEB_CHANNEL) as ContextItem["channel"],
    createdAt: toIso(row.createdAt || fallback.createdAt),
    status: (asString(row.status) || fallback.status || "stored") as ContextItem["status"],
    content: {
      ...fallback.content,
      ...content,
      parts,
    },
  };
}

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

const codexShowcaseContext = createContext<CodexShowcaseEnv>("registry.examples.codex")
  .context((stored, env) => ({
    ...(stored.content ?? {}),
    source: "registry.examples.codex",
    appId: env.instant.appId,
  }))
  .narrative(() => "Codex live showcase for the Ekairos registry examples surface.")
  .actions(() => ({}))
  .reactor(
    createCodexReactor<Record<string, unknown>, CodexConfig, CodexShowcaseEnv>({
      includeReasoningPart: true,
      includeStreamTraceInOutput: true,
      includeRawProviderChunksInOutput: false,
      resolveConfig: async ({ env }) => ({
        appServerUrl: env.appServerUrl,
        repoPath: env.repoPath,
        providerContextId: env.providerContextId,
        model: env.model,
        approvalPolicy: env.approvalPolicy as CodexConfig["approvalPolicy"],
      }),
      executeTurn: async ({ config, instruction, emitChunk }) =>
        await runCodexTurn({ config, instruction, emitChunk }),
    }),
  )
  .model((_, env) => env.model || "codex")
  .shouldContinue(() => false)
  .build();

async function resolveCredentials(body: CodexShowcaseRequestBody) {
  const appId = asString(body.appId).trim();
  if (!appId) {
    throw new Error("appId is required. Initialize tenant first.");
  }

  const providedAdminToken = asString(body.adminToken).trim();
  if (providedAdminToken) {
    return {
      appId,
      adminToken: providedAdminToken,
      title: "registry-showcase-explicit",
    };
  }

  return await resolveDemoTenantCredentials({ appId });
}

function resolveAppServerUrl() {
  const raw =
    asString(process.env.CODEX_APP_SERVER_URL).trim() ||
    asString(process.env.CODEX_REACTOR_REAL_URL).trim();
  if (raw.startsWith("ws://") || raw.startsWith("wss://")) {
    return "http://127.0.0.1:4500/turn";
  }
  return raw || "http://127.0.0.1:4500/turn";
}

async function readJsonRequestBody<T>(request: Request, label: string): Promise<T> {
  const raw = await request.text().catch(() => "");
  if (!raw.trim()) {
    throw new Error(`${label} request body is empty.`);
  }

  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(
      `${label} request body is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function handleCodexShowcaseRunRequest(request: Request) {
  try {
    const body = await readJsonRequestBody<CodexShowcaseRequestBody>(
      request,
      "registry.examples.codex.run",
    );
    const prompt = asString(body.prompt).trim();
    if (!prompt) {
      return NextResponse.json<LiveReactorShowcaseRunResponse>(
        { ok: false, error: "prompt is required." },
        { status: 400 },
      );
    }

    const credentials = await resolveCredentials(body);
    const model =
      asString(body.model).trim() ||
      asString(process.env.CODEX_MODEL).trim() ||
      "";
    const approvalPolicy =
      asString(body.approvalPolicy).trim() ||
      asString(process.env.CODEX_APPROVAL_POLICY).trim() ||
      "never";
    const repoPath =
      asString(body.repoPath).trim() ||
      asString(process.env.CODEX_REPO_PATH).trim() ||
      process.cwd();
    const rawContextId = asString(body.contextId).trim();
    const contextId = rawContextId && isUuid(rawContextId) ? rawContextId : undefined;
    const providerContextId = asString(body.providerContextId).trim() || undefined;
    const triggerEvent = buildTriggerEvent(prompt, body.triggerEventId);

    const reaction = await codexShowcaseContext.react(triggerEvent, {
      env: {
        instant: {
          appId: credentials.appId,
          adminToken: credentials.adminToken,
        },
        appServerUrl: resolveAppServerUrl(),
        repoPath,
        providerContextId,
        model: model || undefined,
        approvalPolicy,
      },
      context: contextId ? { id: contextId } : null,
      options: {
        maxIterations: 1,
        maxModelSteps: 1,
      },
    });

    const runtime = await resolveRegistryRuntime(
      {
        instant: {
          appId: credentials.appId,
          adminToken: credentials.adminToken,
        },
      },
      appDomain,
    );
    const runtimeDb: any = runtime.db;

    const [triggerSnapshot, assistantSnapshot] = await Promise.all([
      runtime.db.query({
        event_items: {
          $: {
            where: { id: reaction.trigger.id as any },
            limit: 1,
          },
        },
      }),
      runtime.db.query({
        event_items: {
          $: {
            where: { id: reaction.reaction.id as any },
            limit: 1,
          },
        },
      }),
    ]);

    const triggerRow = Array.isArray((triggerSnapshot as any).event_items)
      ? ((triggerSnapshot as any).event_items[0] as Record<string, unknown> | null)
      : null;
    const assistantRow = Array.isArray((assistantSnapshot as any).event_items)
      ? ((assistantSnapshot as any).event_items[0] as Record<string, unknown> | null)
      : null;

    const normalizedTrigger = normalizeContextItem(triggerRow, reaction.trigger);
    const normalizedAssistant = normalizeContextItem(assistantRow, reaction.reaction);
    const streamPointer = await resolveContextExecutionStreamPointer({
      db: runtime.db,
      contextId: reaction.context.id,
    });
    const persistedTrace =
      streamPointer && (streamPointer.clientId || streamPointer.streamId)
        ? await readPersistedContextStepStream({
            db: runtime.db,
            clientId: streamPointer.clientId ?? undefined,
            streamId: streamPointer.streamId ?? undefined,
          })
        : { chunks: [], byteOffset: 0 };
    const traceChunks = persistedTrace.chunks as Array<Record<string, unknown>>;
    const llm = deriveLlmFromAssistantEvent({
      assistantEvent: normalizedAssistant,
      requestedModel: model || null,
    });
    const turnMetadata = resolveTurnMetadata(normalizedAssistant, llm);
    const commandExecutions = getCommandExecutionParts(normalizedAssistant);

    return NextResponse.json<LiveReactorShowcaseRunResponse>({
      ok: true,
      data: {
        appId: credentials.appId,
        contextId: reaction.context.id,
        stream: streamPointer
          ? {
              executionId: streamPointer.executionId,
              source: streamPointer.source,
              clientId: streamPointer.clientId,
              streamId: streamPointer.streamId,
            }
          : {
              executionId: reaction.execution.id,
              source: "none",
              clientId: null,
              streamId: null,
            },
        triggerEvent: normalizedTrigger as any,
        assistantEvent: normalizedAssistant as any,
        llm,
        trace: {
          events: traceChunks,
          chunks: traceChunks,
          summary: summarizeTrace({
            events: traceChunks,
            chunks: traceChunks,
            streamTrace: turnMetadata.streamTrace,
          }),
        },
        metadata: {
          providerContextId: turnMetadata.providerContextId,
          turnId: turnMetadata.turnId,
          diff: turnMetadata.diff,
          tokenUsage: turnMetadata.tokenUsage,
          streamTrace: turnMetadata.streamTrace,
        },
        commandExecutions:
          commandExecutions.length > 0
            ? commandExecutions
            : getCommandExecutionPartsFromStreamTrace({ chunks: traceChunks }),
        audit: buildProviderPersistenceAudit({
          assistantEvent: normalizedAssistant,
          chunks: traceChunks,
          streamTrace: turnMetadata.streamTrace,
          turnId: turnMetadata.turnId,
          rawProviderEvents: asRecord(asRecord(turnMetadata.metadata).response).stream,
        }),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[registry][examples.codex.run] failed", {
      error: message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json<LiveReactorShowcaseRunResponse>(
      { ok: false, error: message },
      { status: 500 },
    );
  }
}

export async function handleCodexShowcaseEntitiesRequest(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const appId = asString(searchParams.get("appId")).trim();
    const contextId = asString(searchParams.get("contextId")).trim();
    const adminToken = request.headers.get("x-ekairos-admin-token");

    if (!appId) {
      return NextResponse.json<ReactorShowcaseEntitiesResponse>(
        { ok: false, error: "appId is required." },
        { status: 400 },
      );
    }
    if (!contextId) {
      return NextResponse.json<ReactorShowcaseEntitiesResponse>(
        { ok: false, error: "contextId is required." },
        { status: 400 },
      );
    }

    const credentials = asString(adminToken).trim()
      ? {
          appId,
          adminToken: asString(adminToken).trim(),
          title: "registry-showcase-explicit",
        }
      : await resolveDemoTenantCredentials({ appId });

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
      event_contexts: {
        $: { where: { id: contextId as any }, limit: 1 },
      },
    });

    const context = Array.isArray(base.event_contexts) ? base.event_contexts[0] : null;
    if (!context) {
      return NextResponse.json<ReactorShowcaseEntitiesResponse>({
        ok: true,
        data: {
          appId,
          contextId,
          context: null,
          latestExecutionAt: null,
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
      event_executions: {
        $: {
          where: { "context.id": contextId as any },
          limit: 50,
        },
      },
      event_items: {
        $: {
          where: { "context.id": contextId as any },
          order: { createdAt: "asc" },
          limit: 200,
        },
      },
      event_steps: {
        $: {
          order: { createdAt: "asc" },
          limit: 500,
        },
        execution: {},
      },
      event_parts: {
        $: {
          order: { idx: "asc" },
          limit: 1000,
        },
        step: {},
      },
    });

    const executionRows = Array.isArray(query.event_executions) ? query.event_executions : [];
    executionRows.sort((a: EntityRow, b: EntityRow) => {
      const aMs = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
      const bMs = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
      return bMs - aMs;
    });
    const executionIds = new Set(executionRows.map((row: EntityRow) => row.id));

    const itemRows = Array.isArray(query.event_items) ? query.event_items : [];
    const stepRowsAll = Array.isArray(query.event_steps) ? query.event_steps : [];
    const stepRows = stepRowsAll.filter((row: any) =>
      executionIds.has((row.execution?.id as string) ?? ""),
    );
    const stepIds = new Set(stepRows.map((row: any) => row.id));
    const partRowsAll = Array.isArray(query.event_parts) ? query.event_parts : [];
    const partRows = partRowsAll.filter((row: any) =>
      stepIds.has((row.step?.id as string) ?? ""),
    );

    const formattedExecutions = executionRows.map((row: EntityRow) =>
      pickEntity(row, [
        "id",
        "status",
        "workflowRunId",
        "activeStreamId",
        "activeStreamClientId",
        "lastStreamId",
        "lastStreamClientId",
        "createdAt",
        "updatedAt",
      ]),
    );
    const formattedItems = itemRows.map((row: EntityRow) =>
      pickEntity(row, ["id", "type", "status", "channel", "createdAt", "content"]),
    );
    const formattedSteps = stepRows.map((row: any) => ({
      ...pickEntity(row, [
        "id",
        "status",
        "iteration",
        "kind",
        "streamId",
        "streamClientId",
        "streamStartedAt",
        "streamFinishedAt",
        "streamAbortReason",
        "createdAt",
        "updatedAt",
      ]),
      executionId: (row.execution?.id as string) ?? null,
    }));
    const formattedParts = partRows.map((row: any) => ({
      ...pickEntity(row, ["id", "key", "idx", "type", "part", "updatedAt"]),
      stepId: (row.step?.id as string) ?? null,
    }));

    const latestExecution = formattedExecutions[0] as Record<string, unknown> | undefined;
    const latestExecutionAt = latestExecution ? formatDate(latestExecution.createdAt) : null;

    return NextResponse.json<ReactorShowcaseEntitiesResponse>({
      ok: true,
      data: {
        appId,
        contextId,
        context: pickEntity(context, ["id", "key", "status", "createdAt", "updatedAt", "content"]),
        latestExecutionAt,
        counts: {
          executions: formattedExecutions.length,
          items: formattedItems.length,
          steps: formattedSteps.length,
          parts: formattedParts.length,
        },
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
    return NextResponse.json<ReactorShowcaseEntitiesResponse>(
      { ok: false, error: message },
      { status: 500 },
    );
  }
}
