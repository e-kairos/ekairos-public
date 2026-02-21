import { NextResponse } from "next/server";
import {
  createCodexReactor,
  type CodexConfig,
} from "@ekairos/openai-reactor";
import {
  createThread,
  INPUT_TEXT_ITEM_TYPE,
  WEB_CHANNEL,
  type ThreadItem,
} from "@ekairos/thread";
import type { ThreadEnvironment } from "@ekairos/thread/runtime";
import appDomain from "@/lib/domain";
import { runCodexTurn } from "@/lib/codex-demo/codex-app-server";
import { resolveDemoTenantCredentials } from "@/lib/demo/tenant.service";
import { resolveRegistryRuntime } from "@/runtime";

export const runtime = "nodejs";

type RequestBody = {
  prompt?: string;
  appId?: string;
  adminToken?: string;
  contextId?: string;
  providerThreadId?: string;
  model?: string;
  repoPath?: string;
  approvalPolicy?: string;
};

type DemoEnv = ThreadEnvironment & {
  instant: {
    appId: string;
    adminToken: string;
  };
  appServerUrl: string;
  repoPath: string;
  threadId?: string;
  model?: string;
  approvalPolicy?: string;
};

type AnyRecord = Record<string, unknown>;

function asRecord(value: unknown): AnyRecord {
  return value && typeof value === "object" ? (value as AnyRecord) : {};
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

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

function buildTriggerEvent(prompt: string): ThreadItem {
  return {
    id: makeUuid(),
    type: INPUT_TEXT_ITEM_TYPE,
    channel: WEB_CHANNEL,
    createdAt: new Date().toISOString(),
    status: "stored",
    content: {
      parts: [{ type: "text", text: prompt }],
    },
  };
}

function collectWritableChunks() {
  const streamEvents: AnyRecord[] = [];
  const chunks: AnyRecord[] = [];
  const writable = new WritableStream<unknown>({
    write(value) {
      const row = asRecord(value);
      const type = asString(row.type);
      if (!type.startsWith("data-")) return;
      const event = asRecord(row.data);
      if (!asString(event.type)) return;
      streamEvents.push(event);
      if (asString(event.type) === "chunk.emitted") {
        chunks.push(event);
      }
    },
  });
  return { writable, streamEvents, chunks };
}

function normalizeThreadItem(value: unknown, fallbackType: string): ThreadItem {
  const row = asRecord(value);
  const content = asRecord(row.content);
  const parts = Array.isArray(content.parts) ? content.parts : [];
  return {
    id: asString(row.id) || makeId("item"),
    type: (asString(row.type) || fallbackType) as ThreadItem["type"],
    channel: (asString(row.channel) || WEB_CHANNEL) as ThreadItem["channel"],
    createdAt: toIso(row.createdAt),
    status: (asString(row.status) || "stored") as ThreadItem["status"],
    content: {
      ...content,
      parts,
    },
  };
}

function extractProviderThreadId(event: ThreadItem): string {
  const parts = Array.isArray(event.content?.parts) ? event.content.parts : [];
  const codexPart = parts.find((part) => asString(asRecord(part).type) === "codex-event");
  const output = asRecord(asRecord(codexPart).output);
  return asString(output.threadId);
}

const codexDemoThread = createThread<DemoEnv>("registry.codex-demo")
  .context((stored, env) => ({
    ...(stored.content ?? {}),
    source: "registry.codex-demo",
    appId: env.instant.appId,
  }))
  .narrative(() => "Codex live thread demo for Ekairos registry.")
  .actions(() => ({}))
  .reactor(
    createCodexReactor<Record<string, unknown>, CodexConfig, DemoEnv>({
      includeReasoningPart: true,
      includeStreamTraceInOutput: true,
      includeRawProviderChunksInOutput: false,
      resolveConfig: async ({ env }) => ({
        appServerUrl: env.appServerUrl,
        repoPath: env.repoPath,
        threadId: env.threadId,
        model: env.model,
        approvalPolicy: env.approvalPolicy as CodexConfig["approvalPolicy"],
      }),
      executeTurn: async ({ config, instruction, emitChunk }) =>
        await runCodexTurn({ config, instruction, emitChunk }),
    }),
  )
  .model((_, env) => env.model || "openai/gpt-5.2-codex")
  .shouldContinue(() => false)
  .build();

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody;
    const prompt = asString(body.prompt).trim();
    if (!prompt) {
      return NextResponse.json(
        { ok: false, error: "prompt is required." },
        { status: 400 },
      );
    }

    const appId = asString(body.appId).trim();
    if (!appId) {
      return NextResponse.json(
        { ok: false, error: "appId is required. Initialize tenant first." },
        { status: 400 },
      );
    }

    const providedAdminToken = asString(body.adminToken).trim();
    const credentials = providedAdminToken
      ? {
          appId,
          adminToken: providedAdminToken,
          title: "registry-demo-explicit",
        }
      : await resolveDemoTenantCredentials({ appId });
    const rawAppServerUrl = asString(process.env.CODEX_APP_SERVER_URL).trim();
    const appServerUrl =
      rawAppServerUrl.startsWith("ws://") || rawAppServerUrl.startsWith("wss://")
        ? "http://127.0.0.1:4310/turn"
        : rawAppServerUrl || "http://127.0.0.1:4310/turn";
    const repoPath =
      asString(body.repoPath).trim() ||
      asString(process.env.CODEX_REPO_PATH).trim() ||
      process.cwd();
    const model =
      asString(body.model).trim() ||
      asString(process.env.CODEX_MODEL).trim() ||
      "openai/gpt-5.2-codex";
    const approvalPolicy =
      asString(body.approvalPolicy).trim() ||
      asString(process.env.CODEX_APPROVAL_POLICY).trim() ||
      "never";
    const rawContextId = asString(body.contextId).trim();
    const contextId = rawContextId && isUuid(rawContextId) ? rawContextId : undefined;
    const providerThreadId = asString(body.providerThreadId).trim() || undefined;

    const triggerEvent = buildTriggerEvent(prompt);
    const { writable, streamEvents, chunks } = collectWritableChunks();

    const reaction = await codexDemoThread.react(triggerEvent, {
      env: {
        instant: {
          appId: credentials.appId,
          adminToken: credentials.adminToken,
        },
        appServerUrl,
        repoPath,
        threadId: providerThreadId,
        model,
        approvalPolicy,
      },
      context: contextId ? { id: contextId } : null,
      options: {
        writable,
        maxIterations: 1,
        maxModelSteps: 1,
        preventClose: true,
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

    const triggerSnapshot = await runtime.db.query({
      thread_items: {
        $: {
          where: {
            id: reaction.triggerEventId,
          },
          limit: 1,
        },
      },
    });
    const assistantSnapshot = await runtime.db.query({
      thread_items: {
        $: {
          where: {
            id: reaction.reactionEventId,
          },
          limit: 1,
        },
      },
    });

    const triggerRow = Array.isArray(triggerSnapshot.thread_items)
      ? triggerSnapshot.thread_items[0]
      : null;
    const assistantRow = Array.isArray(assistantSnapshot.thread_items)
      ? assistantSnapshot.thread_items[0]
      : null;

    const normalizedTrigger = normalizeThreadItem(triggerRow ?? triggerEvent, INPUT_TEXT_ITEM_TYPE);
    const normalizedAssistant = normalizeThreadItem(assistantRow, "output");
    const mappedProviderThreadId =
      extractProviderThreadId(normalizedAssistant) ||
      providerThreadId ||
      null;

    return NextResponse.json({
      ok: true,
      data: {
        appId: credentials.appId,
        contextId: reaction.contextId,
        providerThreadId: mappedProviderThreadId,
        triggerEvent: normalizedTrigger,
        assistantEvent: normalizedAssistant,
        llm: null,
        events: streamEvents,
        chunks,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[registry][codex-demo.run] failed", {
      error: message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 },
    );
  }
}
