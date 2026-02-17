import { createThread } from "@ekairos/thread"
import { init } from "@instantdb/admin"
import { z } from "zod"
import { tool } from "ai"

export function buildSimpleAgent(_db: ReturnType<typeof init>) {
  const simpleAgentBuilder = createThread("registry.simple")
    .context(async (stored) => {
      const previous = stored.content
      return {
        userId: previous?.userId ?? "test-user",
        topic: previous?.topic ?? "general",
      }
    })
    .narrative(async ({ content }) => {
      const { topic } = content
      return `You are a helpful assistant for testing purposes. 
    Current topic: ${topic}.`
    })
    .actions(async ({ content }) => {
      const { topic } = content

      return {
        setTopic: tool({
          description: `Set the conversation topic (current: ${topic})`,
          inputSchema: z.object({
            topic: z.string().describe("The topic to set for the conversation"),
          }),
          execute: async ({ topic }) => {
            return { success: true, message: `Topic set to ${topic}` }
          },
        }),
      }
    })
    .model("gpt-4o-mini")

  return {
    config: simpleAgentBuilder.config(),
    build: simpleAgentBuilder.build(),
  }
}





