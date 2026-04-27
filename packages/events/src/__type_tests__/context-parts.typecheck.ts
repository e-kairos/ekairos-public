import { z } from "zod"

import {
  action,
  type ContextActionPart,
  type ContextEnginePart,
  type ContextPart,
} from "../index.js"

const createMessage = action({
  input: z.object({
    text: z.string(),
  }),
  output: z.object({
    messageId: z.string(),
  }),
  execute: async (input) => ({
    messageId: input.text,
  }),
})

const commandExecute = action({
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
})

const actions = {
  createMessage,
  "command.execute": commandExecute,
} as const

type Part = ContextPart<typeof actions>

const messagePart = {
  type: "message",
  content: {
    text: "hello",
  },
  reactorMetadata: {
    reactorKind: "codex",
    executionId: "turn_1",
  },
} satisfies Part

messagePart satisfies ContextEnginePart

const reasoningPart = {
  type: "reasoning",
  content: {
    text: "thinking",
    state: "done",
  },
} satisfies Part

reasoningPart satisfies ContextEnginePart

const sourcePart = {
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
} satisfies Part

sourcePart satisfies ContextEnginePart

const createMessageStartedPart = {
  type: "action",
  content: {
    status: "started",
    actionName: "createMessage",
    actionCallId: "call_1",
    input: {
      text: "hello",
    },
  },
} satisfies Part

createMessageStartedPart satisfies ContextActionPart<typeof actions>

const createMessageCompletedPart = {
  type: "action",
  content: {
    status: "completed",
    actionName: "createMessage",
    actionCallId: "call_1",
    output: {
      messageId: "msg_1",
    },
  },
} satisfies Part

createMessageCompletedPart satisfies ContextActionPart<typeof actions>

const commandCompletedPart = {
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
} satisfies Part

commandCompletedPart satisfies ContextActionPart<typeof actions>

const failedPart = {
  type: "action",
  content: {
    status: "failed",
    actionName: "createMessage",
    actionCallId: "call_1",
    error: {
      message: "failed",
    },
  },
} satisfies Part

failedPart satisfies ContextActionPart<typeof actions>

// @ts-expect-error actionName must come from the available actions.
const unknownActionPart = {
  type: "action",
  content: {
    status: "started",
    actionName: "missing",
    actionCallId: "call_3",
    input: {},
  },
} satisfies Part

unknownActionPart satisfies never

// @ts-expect-error action input must match the selected action input schema.
const invalidActionInputPart = {
  type: "action",
  content: {
    status: "started",
    actionName: "createMessage",
    actionCallId: "call_4",
    input: {
      text: 123,
    },
  },
} satisfies Part

invalidActionInputPart satisfies never

// @ts-expect-error action output must match the selected action output schema.
const invalidActionOutputPart = {
  type: "action",
  content: {
    status: "completed",
    actionName: "command.execute",
    actionCallId: "call_5",
    output: {
      messageId: "wrong",
    },
  },
} satisfies Part

invalidActionOutputPart satisfies never

// @ts-expect-error message parts cannot carry action content.
const invalidMessagePart = {
  type: "message",
  content: {
    output: {
      messageId: "wrong",
    },
  },
} satisfies Part

invalidMessagePart satisfies never

// @ts-expect-error reactorMetadata requires reactorKind when present.
const invalidMetadataPart = {
  type: "message",
  content: {
    text: "hello",
  },
  reactorMetadata: {
    executionId: "turn_1",
  },
} satisfies Part

invalidMetadataPart satisfies never
