import { createThread } from "@ekairos/thread"
import { init } from "@instantdb/admin"
import { z } from "zod"
import { tool } from "ai"

export function buildDemoAgent(_db: ReturnType<typeof init>) {
  const demoAgentBuilder = createThread("registry.demo")
    .context(async (stored) => {
      const previous = stored.content
      return {
        userId: previous?.userId ?? "demo-user",
        session: previous?.session ?? "demo-session",
      }
    })
    .narrative(async ({ content }) => {
      return `You are a helpful demo assistant for the Ekairos Registry.
    
You help users understand and interact with the components showcased in the registry.
You can answer questions about components, provide examples, and guide users through the documentation.

Current session: ${content.session}`
    })
    .actions(async ({ content }) => {
      return {
        showComponent: tool({
          description: "Show information about a specific component",
          inputSchema: z.object({
            componentName: z.string().describe("The name of the component to show"),
          }),
          execute: async ({ componentName }) => {
            return { 
              success: true, 
              message: `Showing information about ${componentName}`,
              component: componentName
            }
          },
        }),
      }
    })
    .model("openai/gpt-5.1-thinking")

  return {
    config: demoAgentBuilder.config(),
    build: demoAgentBuilder.build(),
  }
}


