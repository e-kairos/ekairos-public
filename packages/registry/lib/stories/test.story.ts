import { thread, type StoredContext } from "@ekairos/thread"

interface TestContext {
  userId: string
  projectId: string
  message?: string
}

export const testStory = thread<TestContext>({
  context: async (ctx: StoredContext<any>) => {
     // Merge existing content with defaults
     return {
        userId: ctx.content?.userId || "default-user",
        projectId: ctx.content?.projectId || "default-project",
        message: ctx.content?.message
     }
  },
  narrative: async (ctx: StoredContext<TestContext>) => {
    return `You are a test assistant running in the Registry.
    User: ${ctx.content.userId}
    Project: ${ctx.content.projectId}
    Message: ${ctx.content.message || "No message"}`
  },
  actions: (_ctx: StoredContext<TestContext>) => {
    return {}
  },
  model: "gpt-4o-mini"
})


