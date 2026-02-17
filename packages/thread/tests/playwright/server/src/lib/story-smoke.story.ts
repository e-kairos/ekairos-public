import { createThread } from "@ekairos/thread";
import { tool, type LanguageModelV2, type LanguageModelV2StreamPart } from "ai";
import { z } from "zod";

export type SmokeEnv = { orgId: string };
export type SmokeContext = { orgId: string; lastMessage?: string };

function createSmokeModel(): LanguageModelV2 {
  return {
    specificationVersion: "v2",
    provider: "story-smoke",
    modelId: "story-smoke",
    supportedUrls: {},
    doGenerate: async () => ({
      content: [{ type: "text", text: "ok" }],
      finishReason: "stop",
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    }),
    doStream: async () => {
      const stream = new ReadableStream<LanguageModelV2StreamPart>({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({
            type: "tool-call",
            toolCallId: "smoke-tool-call",
            toolName: "echo",
            input: JSON.stringify({ message: "ping" }),
          });
          controller.enqueue({
            type: "finish",
            finishReason: "tool-calls",
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          });
          controller.close();
        },
      });

      return { stream };
    },
  };
}

export const storySmokeBuilder = createThread<SmokeEnv>("story.smoke")
  .context((ctx, env) => {
    const existing = (ctx.content ?? {}) as Partial<SmokeContext>;
    return { ...existing, orgId: env.orgId };
  })
  .narrative((_ctx, env) => `Story smoke for org ${env.orgId}.`)
  .actions(() => ({
    echo: tool({
      description: "Return the input payload as a simple echo response.",
      inputSchema: z.object({
        message: z.string(),
      }),
      execute: async ({ message }) => ({ ok: true, message }),
    }),
  }))
  .model(() => createSmokeModel())
  .shouldContinue(() => false);

export const storySmoke = storySmokeBuilder.build();
