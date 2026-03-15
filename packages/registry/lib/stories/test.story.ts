import { context, type StoredContext } from "@ekairos/events"

interface TestContext {
  userId: string
  projectId: string
  message?: string
}

export const testStory = context<TestContext>({
  context: async (ctx: StoredContext<any>) => {
     // Merge existing content with defaults
     return {
        userId: ctx.content?.userId || "default-user",
        projectId: ctx.content?.projectId || "default-project",
        message: ctx.content?.message
     }
  },
  narrative: async (ctx: StoredContext<TestContext>) => {
    const content = ctx.content ?? {
      userId: "default-user",
      projectId: "default-project",
      message: undefined,
    }
    return `You are a test assistant running in the Registry.
    User: ${content.userId}
    Project: ${content.projectId}
    Message: ${content.message || "No message"}`
  },
  actions: (_ctx: StoredContext<TestContext>) => {
    return {}
  },
  model: "gpt-4o-mini"
})


