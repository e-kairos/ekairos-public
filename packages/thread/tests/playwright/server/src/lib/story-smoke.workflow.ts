import { storySmoke, storySmokeToolError } from "./story-smoke.story";
import type { ContextEvent } from "@ekairos/thread";
import { getWritable } from "workflow";

export type StorySmokeWorkflowMode = "success" | "tool-error";

export async function storySmokeWorkflow(mode: StorySmokeWorkflowMode = "success") {
  "use workflow";

  const triggerEvent: ContextEvent = {
    id: crypto.randomUUID(),
    type: "input_text",
    channel: "web",
    createdAt: new Date().toISOString(),
    content: {
      parts: [{ type: "text", text: "ping" }],
    },
  };

  const thread = mode === "tool-error" ? storySmokeToolError : storySmoke;

  return await thread.react(triggerEvent, {
    env: { mode },
    context: null,
    options: {
      maxIterations: 1,
      maxModelSteps: 1,
      writable: getWritable(),
    },
  });
}
