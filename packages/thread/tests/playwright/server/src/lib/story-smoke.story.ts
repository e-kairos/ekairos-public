import { createThread, createScriptedReactor, didToolExecute } from "@ekairos/thread";
import { tool } from "ai";
import { z } from "zod";
import {
  createSmokeSuccessModel,
  createSmokeToolErrorModel,
} from "./story-smoke.model";

export type SmokeContext = { lastMessage?: string };

type StorySmokeMode = "success" | "tool-error" | "scripted";

function createStorySmoke(mode: StorySmokeMode) {
  if (mode === "scripted") {
    return createThread("story.smoke.scripted")
      .context((ctx) => {
        const existing = (ctx.content ?? {}) as Partial<SmokeContext>;
        return { ...existing };
      })
      .narrative(() => "Story smoke deterministic workflow (scripted reactor).")
      .actions(() => ({
        echo: tool({
          description: "Return the input payload as a simple echo response.",
          inputSchema: z.object({
            message: z.string(),
          }),
          execute: async ({ message }) => ({ ok: true, message }),
        }),
      }))
      .reactor(
        createScriptedReactor({
          steps: [
            {
              assistantEvent: {
                content: {
                  parts: [
                    { type: "text", text: "Scripted reactor requesting echo." },
                    {
                      type: "tool-echo",
                      toolCallId: "scripted-smoke-tool-call",
                      input: { message: "ping" },
                    },
                  ],
                },
              },
              actionRequests: [
                {
                  actionRef: "scripted-smoke-tool-call",
                  actionName: "echo",
                  input: { message: "ping" },
                },
              ],
              messagesForModel: [],
              llm: {
                provider: "scripted",
                model: "story-smoke-scripted",
                promptTokens: 0,
                completionTokens: 0,
                totalTokens: 0,
                latencyMs: 0,
              },
            },
          ],
        }),
      )
      .shouldContinue(({ reactionEvent }) => !didToolExecute(reactionEvent, "echo"))
      .build();
  }

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
export const storySmokeScripted = createStorySmoke("scripted");
