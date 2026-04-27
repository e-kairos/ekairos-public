import { describe, expect, it } from "vitest"
import { z } from "zod"

import { action } from "../context.action"
import {
  contextEnginePartSchema,
  createContextPartSchema,
  normalizePartsForPersistence,
  parseContextPart,
} from "../context.parts"

describe("context parts", () => {
  const actions = {
    createMessage: action({
      input: z.object({
        text: z.string(),
      }),
      output: z.object({
        messageId: z.string(),
      }),
      execute: async (input) => ({
        messageId: input.text,
      }),
    }),
    "command.execute": action({
      input: z.object({
        command: z.string(),
        cwd: z.string().optional(),
      }),
      output: z.object({
        exitCode: z.number(),
        output: z.string(),
      }),
      execute: async () => ({
        exitCode: 0,
        output: "ok",
      }),
    }),
  } as const

  it("validates engine-owned message, reasoning, and source parts", () => {
    expect(
      contextEnginePartSchema.parse({
        type: "message",
        content: { text: "hello" },
      }),
    ).toEqual({
      type: "message",
      content: { text: "hello" },
    })

    expect(
      contextEnginePartSchema.parse({
        type: "reasoning",
        content: { text: "thinking", state: "done" },
      }),
    ).toEqual({
      type: "reasoning",
      content: { text: "thinking", state: "done" },
    })

    expect(
      contextEnginePartSchema.parse({
        type: "source",
        content: {
          sources: [
            {
              type: "source-url",
              sourceId: "src_1",
              url: "https://example.com",
            },
          ],
        },
      }),
    ).toEqual({
      type: "source",
      content: {
        sources: [
          {
            type: "source-url",
            sourceId: "src_1",
            url: "https://example.com",
          },
        ],
      },
    })
  })

  it("validates action parts against the supplied action schemas", () => {
    const schema = createContextPartSchema(actions)

    expect(
      schema.parse({
        type: "action",
        content: {
          status: "started",
          actionName: "createMessage",
          actionCallId: "call_1",
          input: {
            text: "hello",
          },
        },
      }),
    ).toEqual({
      type: "action",
      content: {
        status: "started",
        actionName: "createMessage",
        actionCallId: "call_1",
        input: {
          text: "hello",
        },
      },
    })

    expect(
      schema.parse({
        type: "action",
        content: {
          status: "completed",
          actionName: "command.execute",
          actionCallId: "call_2",
          output: {
            exitCode: 0,
            output: "ok",
          },
        },
      }),
    ).toEqual({
      type: "action",
      content: {
        status: "completed",
        actionName: "command.execute",
        actionCallId: "call_2",
        output: {
          exitCode: 0,
          output: "ok",
        },
      },
    })
  })

  it("rejects actions that are not part of the available action set", () => {
    const schema = createContextPartSchema(actions)

    expect(() =>
      schema.parse({
        type: "action",
        content: {
          status: "started",
          actionName: "missing",
          actionCallId: "call_1",
          input: {},
        },
      }),
    ).toThrow()
  })

  it("rejects action inputs and outputs that do not match their action schemas", () => {
    const schema = createContextPartSchema(actions)

    expect(() =>
      schema.parse({
        type: "action",
        content: {
          status: "started",
          actionName: "createMessage",
          actionCallId: "call_1",
          input: {
            text: 123,
          },
        },
      }),
    ).toThrow()

    expect(() =>
      schema.parse({
        type: "action",
        content: {
          status: "completed",
          actionName: "command.execute",
          actionCallId: "call_2",
          output: {
            exitCode: "0",
            output: "ok",
          },
        },
      }),
    ).toThrow()
  })

  it("normalizes provider UI parts into the semantic part contract", () => {
    expect(
      normalizePartsForPersistence([
        { type: "text", text: "hello" },
        {
          type: "tool-createMessage",
          toolCallId: "call_1",
          state: "output-available",
          input: { text: "hello" },
          output: { messageId: "msg_1" },
        },
      ]),
    ).toEqual([
      {
        type: "message",
        content: {
          text: "hello",
        },
      },
      {
        type: "action",
        content: {
          status: "started",
          actionName: "createMessage",
          actionCallId: "call_1",
          input: {
            text: "hello",
          },
        },
      },
      {
        type: "action",
        content: {
          status: "completed",
          actionName: "createMessage",
          actionCallId: "call_1",
          output: {
            messageId: "msg_1",
          },
        },
      },
    ])
  })

  it("parses a typed context part", () => {
    const part = parseContextPart(actions, {
      type: "action",
      content: {
        status: "completed",
        actionName: "createMessage",
        actionCallId: "call_1",
        output: {
          messageId: "msg_1",
        },
      },
    })

    expect(part.type).toBe("action")
  })
})
