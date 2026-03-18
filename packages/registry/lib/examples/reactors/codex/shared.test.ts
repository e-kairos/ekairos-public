import { describe, expect, it } from "vitest";

import {
  buildCodexReplayAssistantEvent,
  getCommandExecutionPartsFromStreamTrace,
} from "./shared";

function createChunk(params: {
  sequence: number;
  chunkType: string;
  providerChunkType?: string;
  method: string;
  payload?: Record<string, unknown>;
}) {
  return {
    version: 1,
    at: new Date(`2026-03-15T10:00:${String(params.sequence).padStart(2, "0")}.000Z`).toISOString(),
    sequence: params.sequence,
    chunkType: params.chunkType,
    providerChunkType: params.providerChunkType || params.method,
    data: {
      method: params.method,
      params: params.payload ?? {},
    },
  };
}

describe("buildCodexReplayAssistantEvent", () => {
  it("reconstructs completed reasoning, assistant text, commands, and turn metadata from raw chunks", () => {
    const chunks = [
      createChunk({
        sequence: 1,
        chunkType: "chunk.start",
        method: "turn/started",
        payload: {
          threadId: "thr-completed",
          turn: { id: "turn-completed" },
        },
      }),
      createChunk({
        sequence: 2,
        chunkType: "chunk.reasoning_delta",
        method: "item/reasoning/textDelta",
        payload: { delta: "Inspecting files. " },
      }),
      createChunk({
        sequence: 3,
        chunkType: "chunk.reasoning_delta",
        method: "item/reasoning/textDelta",
        payload: { delta: "Summarizing results." },
      }),
      createChunk({
        sequence: 4,
        chunkType: "chunk.text_delta",
        method: "item/agentMessage/delta",
        payload: { itemId: "msg-1", delta: "Draft summary." },
      }),
      createChunk({
        sequence: 5,
        chunkType: "chunk.action_input_available",
        method: "item/started",
        payload: {
          item: {
            type: "commandExecution",
            id: "cmd-1",
            command: "pnpm typecheck",
            cwd: "/workspace",
          },
        },
      }),
      createChunk({
        sequence: 6,
        chunkType: "chunk.action_output_delta",
        method: "item/commandExecution/outputDelta",
        payload: { itemId: "cmd-1", delta: "checking..." },
      }),
      createChunk({
        sequence: 7,
        chunkType: "chunk.action_output_available",
        method: "item/completed",
        payload: {
          item: {
            type: "commandExecution",
            id: "cmd-1",
            aggregatedOutput: "checking...\nclean",
            status: "completed",
            exitCode: 0,
            durationMs: 42,
          },
        },
      }),
      createChunk({
        sequence: 8,
        chunkType: "chunk.text_end",
        method: "item/completed",
        payload: {
          item: {
            type: "agentMessage",
            id: "msg-1",
            text: "Final summary.",
          },
        },
      }),
      createChunk({
        sequence: 9,
        chunkType: "chunk.usage",
        method: "context/tokenUsage/updated",
        payload: {
          tokenUsage: {
            totalTokens: 33,
            inputTokens: 20,
            outputTokens: 13,
          },
        },
      }),
      createChunk({
        sequence: 10,
        chunkType: "chunk.finish",
        method: "turn/completed",
        payload: {
          turn: { id: "turn-completed", threadId: "thr-completed" },
        },
      }),
    ];

    const replay = buildCodexReplayAssistantEvent({
      eventId: "step-replay-completed",
      createdAt: "2026-03-15T10:00:00.000Z",
      chunks,
    });

    expect(replay.isCompleted).toBe(true);
    expect(replay.event.status).toBe("completed");
    expect(replay.metadata.providerContextId).toBe("thr-completed");
    expect(replay.metadata.turnId).toBe("turn-completed");
    expect(replay.trace.summary.chunkCount).toBe(chunks.length);

    const parts = replay.event.content.parts;
    expect(parts.map((part) => String(part.type))).toEqual(
      expect.arrayContaining([
        "reasoning",
        "text",
        "tool-commandExecution",
        "tool-turnMetadata",
      ]),
    );

    const reasoningPart = parts.find((part) => part.type === "reasoning");
    const textPart = parts.find((part) => part.type === "text");
    const commandPart = parts.find((part) => part.type === "tool-commandExecution");
    const metadataPart = parts.find((part) => part.type === "tool-turnMetadata");

    expect(reasoningPart?.text).toBe("Inspecting files. Summarizing results.");
    expect(textPart?.text).toBe("Final summary.");
    expect(commandPart?.output).toMatchObject({
      text: "checking...\nclean",
      status: "completed",
      exitCode: 0,
    });
    expect(metadataPart?.output).toMatchObject({
      providerContextId: "thr-completed",
      turnId: "turn-completed",
      tokenUsage: {
        totalTokens: 33,
        inputTokens: 20,
        outputTokens: 13,
      },
    });
  });

  it("keeps partial assistant and command output available while replay is still live", () => {
    const chunks = [
      createChunk({
        sequence: 1,
        chunkType: "chunk.start",
        method: "turn/started",
        payload: {
          threadId: "thr-live",
          turn: { id: "turn-live" },
        },
      }),
      createChunk({
        sequence: 2,
        chunkType: "chunk.reasoning_delta",
        method: "item/reasoning/textDelta",
        payload: { delta: "Looking around..." },
      }),
      createChunk({
        sequence: 3,
        chunkType: "chunk.text_delta",
        method: "item/agentMessage/delta",
        payload: { itemId: "msg-live", delta: "Still streaming" },
      }),
      createChunk({
        sequence: 4,
        chunkType: "chunk.action_input_available",
        method: "item/started",
        payload: {
          item: {
            type: "commandExecution",
            id: "cmd-live",
            command: "dir",
            cwd: "C:/repo",
          },
        },
      }),
      createChunk({
        sequence: 5,
        chunkType: "chunk.action_output_delta",
        method: "item/commandExecution/outputDelta",
        payload: { itemId: "cmd-live", delta: "README.md" },
      }),
    ];

    const replay = buildCodexReplayAssistantEvent({
      eventId: "step-replay-live",
      createdAt: "2026-03-15T10:01:00.000Z",
      chunks,
    });

    expect(replay.isCompleted).toBe(false);
    expect(replay.event.status).toBe("pending");

    const textPart = replay.event.content.parts.find((part) => part.type === "text");
    const commandPart = replay.event.content.parts.find(
      (part) => part.type === "tool-commandExecution",
    );

    expect(textPart?.text).toBe("Still streaming");
    expect(commandPart?.state).toBe("output-streaming");
    expect(commandPart?.output).toMatchObject({
      text: "README.md",
      status: "running",
    });
  });
});

describe("getCommandExecutionPartsFromStreamTrace", () => {
  it("returns an input-available command when output has not started yet", () => {
    const parts = getCommandExecutionPartsFromStreamTrace({
      chunks: [
        createChunk({
          sequence: 1,
          chunkType: "chunk.action_input_available",
          method: "item/started",
          payload: {
            item: {
              type: "commandExecution",
              id: "cmd-pending",
              command: "git status",
              cwd: "/workspace",
            },
          },
        }),
      ],
    });

    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      state: "input-available",
      input: {
        command: "git status",
        cwd: "/workspace",
      },
      output: {
        status: "pending",
      },
    });
  });
});
