type AnyRecord = Record<string, unknown>;

export type CodexBridgeConfig = {
  appServerUrl: string;
  repoPath: string;
  providerContextId?: string;
  model?: string;
  approvalPolicy?: string;
  mode?: "local" | "remote" | "sandbox";
  sandboxPolicy?: Record<string, unknown>;
};

type CodexBridgeTurnResult = {
  providerContextId: string;
  turnId: string;
  assistantText: string;
  reasoningText?: string;
  diff?: string;
  usage?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

type RunCodexTurnArgs = {
  config: CodexBridgeConfig;
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

function truncate(value: string, max = 240): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

async function readJsonResponseBody(response: Response): Promise<AnyRecord> {
  const raw = await response.text().catch(() => "");
  if (!raw.trim()) {
    throw new Error("HTTP provider returned an empty JSON body.");
  }

  try {
    return asRecord(JSON.parse(raw));
  } catch (error) {
    throw new Error(
      `HTTP provider returned invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }. body=${truncate(raw)}`,
    );
  }
}

export async function runCodexTurn(args: RunCodexTurnArgs): Promise<CodexBridgeTurnResult> {
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
      runtime: { source: "registry.examples.codex" },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`HTTP provider failed (${response.status}): ${body || response.statusText}`);
  }

  const payload = await readJsonResponseBody(response);
  const stream = asArray<AnyRecord>(payload.stream);
  for (const chunk of stream) {
    await args.emitChunk(chunk);
  }

  return {
    providerContextId:
      asString(payload.contextId) ||
      asString(args.config.providerContextId) ||
      randomId("context"),
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
