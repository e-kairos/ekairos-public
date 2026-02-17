import { NextRequest, NextResponse } from "next/server"
import { AgentService } from "@ekairos/thread"
import { getStory } from "@/lib/storyRegistry"

// Initialize the registry by importing it
import "@/lib/storyRegistry"

const agentService = new AgentService()

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { storyKey, context } = body

    if (!storyKey) {
      return NextResponse.json({ error: "Missing storyKey" }, { status: 400 })
    }

    // Verify story exists in registry
    const story = getStory(storyKey)
    if (!story) {
        // If not in registry, we might allow it if dynamic, but for now let's warn
        console.warn(`Story ${storyKey} not found in local registry. Proceeding anyway as context might be sufficient.`)
    }

    // Create/Init context in DB
    const storedContext = await agentService.createContext(
      { key: storyKey }, 
      undefined
    )

    // Update with initial context if provided
    if (context) {
      await agentService.updateContextContent({ id: storedContext.id }, context)
    }

    return NextResponse.json({ success: true, contextId: storedContext.id })
  } catch (error: any) {
    console.error("Register error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}


