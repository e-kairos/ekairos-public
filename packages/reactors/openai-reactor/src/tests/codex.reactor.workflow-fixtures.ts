import {
  createContext,
  createContextStepStreamChunk,
  encodeContextStepStreamChunk,
  eventsDomain,
  runContextReactionDirect,
  type ContextDurableWorkflowPayload,
  type ContextItem,
} from "@ekairos/events"
import { EkairosRuntime } from "@ekairos/domain"
import { init } from "@instantdb/admin"
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde"

import {
  createCodexReactor,
  defaultMapCodexChunk,
  type CodexConfig,
  type CodexExecuteTurnArgs,
  type CodexMappedChunk,
  type CodexTurnResult,
} from "../index.js"

export type CodexWorkflowTestEnv = {
  appId: string
  adminToken: string
  appServerUrl: string
  repoPath: string
  providerContextId?: string
  model?: string
  approvalPolicy?: string
}

type CodexWorkflowContext = {
  repoPath?: string
  providerContextId?: string
  codexConfig?: Pick<
    CodexConfig,
    "appServerUrl" | "repoPath" | "providerContextId" | "model" | "approvalPolicy"
  >
}

export const TEST_CONTEXT_KEY = "codex.reactor.workflow.integration"
export const PROVIDER_CONTEXT_ID = "11111111-1111-4111-8111-111111111111"
export const TURN_ID = "turn-durable-001"
export const ASSISTANT_TEXT = "Durable Codex reactor OK."

const MESSAGE_ID = "msg-durable-001"
const COMMAND_ID = "cmd-durable-001"

export class CodexWorkflowTestRuntime extends EkairosRuntime<
  CodexWorkflowTestEnv,
  typeof eventsDomain,
  ReturnType<typeof init>
> {
  static [WORKFLOW_SERIALIZE](instance: CodexWorkflowTestRuntime) {
    return { env: instance.env }
  }

  static [WORKFLOW_DESERIALIZE](data: { env: CodexWorkflowTestEnv }) {
    return new CodexWorkflowTestRuntime(data.env)
  }

  protected getDomain() {
    return eventsDomain
  }

  protected async resolveDb(env: CodexWorkflowTestEnv) {
    return init({
      appId: env.appId,
      adminToken: env.adminToken,
      schema: eventsDomain.toInstantSchema(),
      useDateObjects: true,
    } as any)
  }
}

export function buildTriggerEvent(text = "Read README.md and summarize it."): ContextItem {
  return {
    id: globalThis.crypto.randomUUID(),
    type: "input",
    channel: "web",
    createdAt: new Date().toISOString(),
    status: "stored",
    content: {
      parts: [{ type: "text", text }],
    },
  }
}

export function buildCodexAppServerNotifications() {
  return [
    {
      method: "turn/started",
      params: {
        threadId: PROVIDER_CONTEXT_ID,
        turn: { id: TURN_ID, threadId: PROVIDER_CONTEXT_ID, status: "inProgress" },
      },
    },
    {
      method: "item/started",
      params: {
        threadId: PROVIDER_CONTEXT_ID,
        turnId: TURN_ID,
        item: { type: "agentMessage", id: MESSAGE_ID, text: "" },
      },
    },
    {
      method: "item/agentMessage/delta",
      params: {
        threadId: PROVIDER_CONTEXT_ID,
        turnId: TURN_ID,
        itemId: MESSAGE_ID,
        delta: "Durable Codex ",
      },
    },
    {
      method: "item/agentMessage/delta",
      params: {
        threadId: PROVIDER_CONTEXT_ID,
        turnId: TURN_ID,
        itemId: MESSAGE_ID,
        delta: "reactor OK.",
      },
    },
    {
      method: "item/completed",
      params: {
        threadId: PROVIDER_CONTEXT_ID,
        turnId: TURN_ID,
        item: { type: "agentMessage", id: MESSAGE_ID, text: ASSISTANT_TEXT },
      },
    },
    {
      method: "item/started",
      params: {
        threadId: PROVIDER_CONTEXT_ID,
        turnId: TURN_ID,
        item: {
          type: "commandExecution",
          id: COMMAND_ID,
          command: "git status --short",
          cwd: "/workspace/repo",
          commandActions: [],
        },
      },
    },
    {
      method: "item/commandExecution/outputDelta",
      params: {
        threadId: PROVIDER_CONTEXT_ID,
        turnId: TURN_ID,
        itemId: COMMAND_ID,
        delta: "clean\n",
      },
    },
    {
      method: "item/completed",
      params: {
        threadId: PROVIDER_CONTEXT_ID,
        turnId: TURN_ID,
        item: {
          type: "commandExecution",
          id: COMMAND_ID,
          command: "git status --short",
          cwd: "/workspace/repo",
          status: "completed",
          exitCode: 0,
          aggregatedOutput: "clean\n",
          durationMs: 12,
        },
      },
    },
    {
      method: "context/tokenUsage/updated",
      params: {
        threadId: PROVIDER_CONTEXT_ID,
        turnId: TURN_ID,
        tokenUsage: {
          inputTokens: 42,
          outputTokens: 11,
          totalTokens: 53,
        },
      },
    },
    {
      method: "turn/completed",
      params: {
        threadId: PROVIDER_CONTEXT_ID,
        turn: { id: TURN_ID, threadId: PROVIDER_CONTEXT_ID, status: "completed" },
      },
    },
  ]
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {}
  return value as Record<string, unknown>
}

function asString(value: unknown): string {
  if (typeof value === "string") return value
  if (value === null || value === undefined) return ""
  return String(value)
}

function toJsonSafe(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return undefined
  }
}

function countRecord(entries: Iterable<string>) {
  const counts: Record<string, number> = {}
  for (const entry of entries) {
    counts[entry] = (counts[entry] ?? 0) + 1
  }
  return counts
}

export async function executeMockCodexTurnStep(
  args: CodexExecuteTurnArgs<CodexWorkflowContext, CodexConfig, CodexWorkflowTestEnv>,
): Promise<CodexTurnResult> {
  "use step"

  const mappedChunks: CodexMappedChunk[] = []
  const providerChunks = buildCodexAppServerNotifications()
  const contextWriter = args.contextStepStream?.getWriter()
  const workflowWriter = args.writable?.getWriter()

  try {
    for (const providerChunk of providerChunks) {
      const mapped = defaultMapCodexChunk(providerChunk)
      if (!mapped || mapped.skip) continue
      const sequence = mappedChunks.length + 1
      const mappedChunk: CodexMappedChunk = {
        at: new Date().toISOString(),
        sequence,
        chunkType: mapped.chunkType,
        providerChunkType: mapped.providerChunkType,
        actionRef: mapped.actionRef,
        data: mapped.data,
        raw: mapped.raw ?? toJsonSafe(providerChunk),
      }
      mappedChunks.push(mappedChunk)

      const payload = {
        at: mappedChunk.at,
        sequence,
        chunkType: mappedChunk.chunkType,
        provider: "codex" as const,
        providerChunkType: mappedChunk.providerChunkType,
        actionRef: mappedChunk.actionRef,
        data: mappedChunk.data,
        raw: mappedChunk.raw,
      }

      await contextWriter?.write(
        encodeContextStepStreamChunk(createContextStepStreamChunk({
          ...payload,
          stepId: args.stepId,
        })),
      )
      await workflowWriter?.write({
        type: "data-chunk.emitted",
        data: {
          type: "chunk.emitted",
          contextId: args.contextId,
          executionId: args.executionId,
          stepId: args.stepId,
          itemId: args.eventId,
          ...payload,
        },
      } as any)
    }
  } finally {
    contextWriter?.releaseLock()
    workflowWriter?.releaseLock()
  }

  const chunkTypes = countRecord(mappedChunks.map((chunk) => chunk.chunkType))
  const providerChunkTypes = countRecord(
    mappedChunks.map((chunk) => asString(chunk.providerChunkType) || "unknown"),
  )

  return {
    providerContextId: args.config.providerContextId ?? PROVIDER_CONTEXT_ID,
    turnId: TURN_ID,
    assistantText: ASSISTANT_TEXT,
    reasoningText: "",
    diff: "",
    toolParts: [],
    usage: {
      inputTokens: 42,
      outputTokens: 11,
      totalTokens: 53,
    },
    metadata: {
      provider: "codex-app-server-mock",
      streamTrace: {
        totalChunks: mappedChunks.length,
        chunkTypes,
        providerChunkTypes,
        chunks: mappedChunks,
      },
      // Keep a provider-shaped completion payload available to callers without
      // requiring raw provider events to be duplicated in persisted parts.
      providerResponse: asRecord(
        asRecord(
          asRecord(providerChunks[providerChunks.length - 1]).params,
        ).turn,
      ),
    },
  }
}

export const codexWorkflowContext = createContext<CodexWorkflowTestEnv>(TEST_CONTEXT_KEY)
  .context((stored, env) => ({
    ...(stored.content ?? {}),
    repoPath: env.repoPath,
    providerContextId: env.providerContextId,
    codexConfig: {
      appServerUrl: env.appServerUrl,
      repoPath: env.repoPath,
      providerContextId: env.providerContextId,
      model: env.model ?? "codex-test",
      approvalPolicy: env.approvalPolicy ?? "never",
    },
  }))
  .narrative(() => "Durable Codex reactor workflow integration test.")
  .actions(() => ({}))
  .reactor(
    createCodexReactor<CodexWorkflowContext, CodexConfig, CodexWorkflowTestEnv>({
      includeReasoningPart: true,
      includeStreamTraceInOutput: true,
      includeRawProviderChunksInOutput: true,
      resolveConfig: async ({ context }) => {
        const config = asRecord(context.codexConfig)
        return {
          appServerUrl: asString(config.appServerUrl),
          repoPath: asString(config.repoPath),
          providerContextId: asString(config.providerContextId) || undefined,
          model: asString(config.model) || "codex-test",
          approvalPolicy: asString(config.approvalPolicy) || "never",
        }
      },
    }),
  )
  .shouldContinue(() => false)
  .build()

export async function codexReactorDurableWorkflow(
  payload: ContextDurableWorkflowPayload<CodexWorkflowTestEnv>,
) {
  "use workflow"

  if (payload.contextKey !== TEST_CONTEXT_KEY) {
    throw new Error(`Unknown context key "${payload.contextKey}" for Codex reactor workflow test`)
  }

  const { getWritable } = await import("workflow")
  return await runContextReactionDirect(codexWorkflowContext, payload.triggerEvent, {
    runtime: payload.runtime,
    context: payload.context ?? null,
    durable: false,
    options: {
      ...(payload.options ?? {}),
      writable: getWritable(),
    },
    __bootstrap: payload.bootstrap,
  })
}
