async function createSmokeModelForTool(toolName: string, modelId: string) {
  const { simulateReadableStream } = await import("ai");
  const { MockLanguageModelV2 } = await import("ai/test");

  return new MockLanguageModelV2({
    provider: "story-smoke",
    modelId,
    doGenerate: async () => ({
      content: [
        {
          type: "tool-call",
          toolCallId: "smoke-tool-call",
          toolName,
          input: JSON.stringify({ message: "ping" }),
        },
      ],
      finishReason: "tool-calls",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      warnings: [],
    }),
    doStream: async () => ({
      stream: simulateReadableStream({
        initialDelayInMs: null,
        chunkDelayInMs: null,
        chunks: [
          { type: "stream-start", warnings: [] },
          {
            type: "tool-call",
            toolCallId: "smoke-tool-call",
            toolName,
            input: JSON.stringify({ message: "ping" }),
          },
          {
            type: "finish",
            finishReason: "tool-calls",
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          },
        ],
      }),
    }),
  });
}

export async function createSmokeSuccessModel() {
  "use step";
  return createSmokeModelForTool("echo", "story-smoke-success");
}

export async function createSmokeToolErrorModel() {
  "use step";
  return createSmokeModelForTool("echo", "story-smoke-tool-error");
}
