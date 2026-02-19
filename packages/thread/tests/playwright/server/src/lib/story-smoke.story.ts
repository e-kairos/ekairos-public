import { createThread } from "@ekairos/thread";
import { tool } from "ai";
import { z } from "zod";
import {
  createSmokeSuccessModel,
  createSmokeToolErrorModel,
} from "./story-smoke.model";

export type SmokeContext = { lastMessage?: string };

type StorySmokeMode = "success" | "tool-error";

function createStorySmoke(mode: StorySmokeMode) {
  const storyKey = mode === "tool-error" ? "story.smoke.tool-error" : "story.smoke";
  const model = mode === "tool-error" ? createSmokeToolErrorModel : createSmokeSuccessModel;
  return createThread(storyKey)
    .context((ctx) => {
      const existing = (ctx.content ?? {}) as Partial<SmokeContext>;
      return { ...existing };
    })
    .narrative(() => "Story smoke deterministic workflow.")
    .actions(() => ({
      echo: tool({
        description: "Return the input payload as a simple echo response.",
        inputSchema: z.object({
          message: z.string(),
        }),
        execute: async ({ message }) => {
          if (mode === "tool-error") {
            throw new Error("echo_failed");
          }
          return { ok: true, message };
        },
      }),
    }))
    .model(model)
    .shouldContinue(() => false)
    .build();
}

export const storySmoke = createStorySmoke("success");
export const storySmokeToolError = createStorySmoke("tool-error");
