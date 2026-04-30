import type { ContextItem } from "@ekairos/events"

import { executeOpenAIResponsesReactionStep } from "../index.js"

function inputItem(id: string, text: string): ContextItem {
  return {
    id,
    type: "input",
    channel: "web",
    createdAt: new Date("2026-04-30T00:00:00.000Z").toISOString(),
    status: "stored",
    content: {
      parts: [{ type: "text", text }],
    },
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {}
  return value as Record<string, unknown>
}

function resultSummary(result: Awaited<ReturnType<typeof executeOpenAIResponsesReactionStep>>) {
  const parts = Array.isArray(result.assistantEvent.content.parts)
    ? result.assistantEvent.content.parts
    : []
  const text = parts
    .map((part) => String(asRecord(asRecord(part).content).text ?? ""))
    .filter(Boolean)
    .join("\n")
  const state = asRecord(result.reactor?.state)
  const transport = asRecord(asRecord(result.llm?.rawProviderMetadata).transport)
  return {
    text,
    actionRequests: result.actionRequests.length,
    reactorKind: result.reactor?.kind,
    connectionMode: state.connectionMode,
    stateTransportMode: asRecord(state.lastMetrics).connectionMode,
    llmTransportMode: transport.connectionMode,
    reusedConnection: transport.reusedConnection,
    usedPreviousResponseId: state.usedPreviousResponseId,
    responseId: state.responseId,
  }
}

export async function resetOpenAIResponsesTransportStep() {
  "use step"

  const { closeOpenAIResponsesWebSocketConnections } = await import("../responses.websocket.js")
  closeOpenAIResponsesWebSocketConnections()
}

export async function openAIResponsesReactorWorkflowSmoke(
  webSocketUrl: string,
  options?: { resetTransportBetweenSteps?: boolean },
) {
  "use workflow"

  const firstInput = inputItem("workflow-input-1", "Say COLD.")
  const first = await executeOpenAIResponsesReactionStep({
    config: {
      model: "gpt-5.2",
      webSocketUrl,
      providerName: "openai-responses-workflow-test",
      reuseHotConnection: true,
    },
    systemPrompt: "Be concise.",
    events: [firstInput],
    triggerEvent: firstInput,
    eventId: "workflow-output-1",
    executionId: "workflow-exec",
    contextId: "workflow-ctx",
    stepId: "workflow-step-1",
    iteration: 0,
    maxModelSteps: 1,
    actionSpecs: {},
    silent: false,
  })

  if (options?.resetTransportBetweenSteps) {
    await resetOpenAIResponsesTransportStep()
  }

  const secondInput = inputItem("workflow-input-2", "Say HOT.")
  const second = await executeOpenAIResponsesReactionStep({
    config: {
      model: "gpt-5.2",
      webSocketUrl,
      providerName: "openai-responses-workflow-test",
      reuseHotConnection: true,
    },
    systemPrompt: "Be concise.",
    events: [firstInput, secondInput],
    triggerEvent: secondInput,
    eventId: "workflow-output-2",
    executionId: "workflow-exec",
    contextId: "workflow-ctx",
    stepId: "workflow-step-2",
    iteration: 1,
    maxModelSteps: 1,
    actionSpecs: {},
    previousReactorState: asRecord(first.reactor?.state),
    silent: false,
  })

  const { getWorkflowMetadata } = await import("workflow")
  return {
    workflowRunId: String(getWorkflowMetadata?.()?.workflowRunId ?? ""),
    first: resultSummary(first),
    second: resultSummary(second),
  }
}
