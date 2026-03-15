import {
  runContextReactionDirect,
  type ContextDurableWorkflowPayload,
} from "@ekairos/events";
import { getWritable } from "workflow";
import {
  storySmoke,
  storySmokeScripted,
  storySmokeToolError,
} from "./story-smoke.story";
import { getWorkflowMetadata } from "workflow";

type SmokeEnv = { mode: "success" | "tool-error" | "scripted" };

function roundMs(value: number) {
  return Math.max(0, Math.round(value));
}

function createStageTimer() {
  const startedAt = Date.now();
  const stageTimingsMs: Record<string, number> = {};
  let currentStage: string | undefined;

  return {
    async measure<T>(name: string, run: () => Promise<T> | T): Promise<T> {
      const previousStage = currentStage;
      currentStage = name;
      const stageStartedAt = Date.now();
      try {
        return await run();
      } finally {
        stageTimingsMs[name] = roundMs(Date.now() - stageStartedAt);
        currentStage = previousStage;
      }
    },
    add(name: string, value: number) {
      stageTimingsMs[name] = roundMs((stageTimingsMs[name] ?? 0) + value);
    },
    getCurrentStage() {
      return currentStage;
    },
    snapshot() {
      return {
        totalMs: roundMs(Date.now() - startedAt),
        stageTimingsMs: { ...stageTimingsMs },
      };
    },
  };
}

export async function contextEngineDurableWorkflow(
  payload: ContextDurableWorkflowPayload<SmokeEnv>,
) {
  "use workflow";

  const context =
    payload.contextKey === "story.smoke.scripted"
      ? storySmokeScripted
      : payload.contextKey === "story.smoke.tool-error"
        ? storySmokeToolError
        : payload.contextKey === "story.smoke"
          ? storySmoke
          : null;

  if (!context) {
    throw new Error(`Unknown context key "${payload.contextKey}" for durable workflow`);
  }

  const benchmark = createStageTimer();
  const result = await runContextReactionDirect(context, payload.triggerEvent, {
    env: payload.env,
    context: payload.context ?? null,
    durable: false,
    __benchmark: benchmark,
    options: {
      ...(payload.options ?? {}),
      writable: getWritable(),
    },
    __bootstrap: payload.bootstrap,
  });
  // eslint-disable-next-line no-console
  console.log(
    `[context-workflow-benchmark] ${JSON.stringify({
      workflowRunId: String(getWorkflowMetadata()?.workflowRunId ?? ""),
      contextKey: payload.contextKey,
      executionId: payload.bootstrap.execution.id,
      ...benchmark.snapshot(),
    })}`,
  );
  return result;
}
