import { NextRequest, NextResponse } from "next/server"
import { AgentService, INPUT_TEXT_ITEM_TYPE, WEB_CHANNEL } from "@ekairos/thread"
import { getStory } from "@/lib/storyRegistry"
import { createUIMessageStreamResponse } from "ai"
import { nanoid } from "nanoid"

const agentService = new AgentService()

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { storyKey, messages } = body

    if (!storyKey || !messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 })
    }

    const lastMessage = messages[messages.length - 1]
    if (!lastMessage) {
      return NextResponse.json({ error: "No messages" }, { status: 400 })
    }

    // Get context by key
    const context = await agentService.getContext({ key: storyKey })
    if (!context) {
      return NextResponse.json({ error: "Context not found for storyKey. Register it first." }, { status: 404 })
    }

    // Save user event
    const userEvent = await agentService.saveEvent(
      { id: context.id },
      {
        id: nanoid(), 
        type: INPUT_TEXT_ITEM_TYPE,
        channel: WEB_CHANNEL,
        status: "pending",
        createdAt: new Date().toISOString(),
        content: {
          parts: [{ type: "text", text: lastMessage.parts?.[0]?.text || lastMessage.content || "" }]
        }
      } as any 
    )

    const agent = getStory(storyKey)
    if (!agent) {
         return NextResponse.json({ error: `Story Agent ${storyKey} not found in registry.` }, { status: 404 })
    }

    const result = await agent.progressStream(userEvent, { id: context.id })
    return createUIMessageStreamResponse({ stream: result.stream })

  } catch (error: any) {
    console.error("React error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

