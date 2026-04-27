import { z } from "zod"

import {
  action,
  defineAction,
  type ContextActionInput,
  type ContextActionOutput,
  type ContextToolExecuteContext,
} from "../index.js"

const createMessage = defineAction({
  description: "Create a message.",
  input: z.object({
    text: z.string(),
    visibility: z.enum(["public", "private"]).default("public"),
  }),
  output: z.object({
    messageId: z.string(),
  }),
  execute: async ({ input, executionId }) => {
    input.text satisfies string
    input.visibility satisfies "public" | "private"
    executionId satisfies string

    return {
      messageId: `msg_${input.text.length}`,
    }
  },
})

createMessage.inputSchema satisfies typeof createMessage.input
createMessage.outputSchema satisfies typeof createMessage.output

const validInput = {
  text: "hello",
  visibility: "private",
} satisfies ContextActionInput<typeof createMessage>

validInput.text satisfies string

const validOutput = {
  messageId: "msg_1",
} satisfies ContextActionOutput<typeof createMessage>

validOutput.messageId satisfies string

action({
  input: z.object({
    count: z.number(),
  }),
  output: z.object({
    doubled: z.number(),
  }),
  execute: (input, context: ContextToolExecuteContext) => {
    input.count satisfies number
    context.toolCallId satisfies string

    return {
      doubled: input.count * 2,
    }
  },
})

defineAction({
  input: z.object({
    text: z.string(),
  }),
  output: z.object({
    messageId: z.string(),
  }),
  // @ts-expect-error execute must return the declared output shape.
  execute: async () => ({
    wrong: true,
  }),
})

defineAction({
  input: z.object({
    text: z.string(),
  }),
  output: z.object({
    messageId: z.string(),
  }),
  execute: async ({ input }) => {
    // @ts-expect-error execute input comes from the declared input schema.
    input.missing

    return {
      messageId: input.text,
    }
  },
})

defineAction({
  input: z.object({}).strict(),
  output: z.object({ ok: z.boolean() }),
  execute: async (params) => {
    // @ts-expect-error context actions receive scoped runtime, not env.
    params.env

    return { ok: true }
  },
})

// @ts-expect-error action input type is derived from the input schema.
const invalidInput = {
  text: 123,
} satisfies ContextActionInput<typeof createMessage>

invalidInput satisfies never

// @ts-expect-error action output type is derived from the output schema.
const invalidOutput = {
  id: "msg_1",
} satisfies ContextActionOutput<typeof createMessage>

invalidOutput satisfies never
