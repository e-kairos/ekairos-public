import type { CodexConfig, CodexTurnResult } from "@ekairos/openai-reactor";

type AnyRecord = Record<string, unknown>;

type RunCodexTurnArgs = {
  config: CodexConfig;
  instruction: string;
  emitChunk: (providerChunk: unknown) => Promise<void>;
};

function asRecord(value: unknown): AnyRecord {
  return value && typeof value === "object" ? (value as AnyRecord) : {};
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

function randomId(prefix: string): string {
  const id = globalThis.crypto?.randomUUID?.();
  if (id) return `${prefix}:${id}`;
  return `${prefix}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

export async function runCodexTurn(args: RunCodexTurnArgs): Promise<CodexTurnResult> {
  const url = asString(args.config.appServerUrl).trim();
  if (!url) {
    throw new Error("Codex app server URL is missing.");
  }
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    throw new Error(
      `Unsupported Codex app server URL (${url}). Use an HTTP bridge endpoint like http://127.0.0.1:4310/turn.`,
    );
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      instruction: args.instruction,
      config: args.config,
      runtime: { source: "registry.codex-demo" },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`HTTP provider failed (${response.status}): ${body || response.statusText}`);
  }

  const payload = asRecord(await response.json());
  const stream = asArray<AnyRecord>(payload.stream);
  for (const chunk of stream) {
    await args.emitChunk(chunk);
  }

  return {
    threadId: asString(payload.threadId) || asString(args.config.threadId) || randomId("thread"),
    turnId: asString(payload.turnId) || randomId("turn"),
    assistantText: asString(payload.assistantText) || asString(payload.text) || "",
    reasoningText: asString(payload.reasoningText) || asString(payload.reasoning),
    diff: asString(payload.diff),
    usage: asRecord(payload.usage),
    metadata: {
      provider: "codex-http",
      response: payload,
    },
  };
}

