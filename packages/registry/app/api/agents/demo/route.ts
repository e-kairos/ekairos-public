import { UIMessage, createUIMessageStreamResponse } from "ai"
import { init } from "@instantdb/admin"
import { buildDemoAgent } from "@/lib/agents/demo-agent"

const db = init({
  appId: process.env.NEXT_PUBLIC_INSTANT_APP_ID!,
  adminToken: process.env.INSTANT_APP_ADMIN_TOKEN!,
})

const { build: demoAgent } = buildDemoAgent(db)

function createUserItemFromUIMessages(messages: UIMessage[]) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("Missing messages to create event")
  }

  const lastMessage = messages[messages.length - 1]

  return {
    id: lastMessage.id,
    type: "user.message",
    channel: "web",
    content: {
      parts: lastMessage.parts,
    },
    createdAt: new Date().toISOString(),
  }
}

export async function POST(req: Request) {
  const body = await req.json()
  
  const {
    messages,
    contextKey,
    reasoningLevel,
  }: {
    messages: UIMessage[]
    contextKey?: string
    reasoningLevel?: "off" | "low" | "medium" | "high"
  } = body

  // Debug: log received body to verify reasoningLevel is being sent
  console.log("[api/agents/demo] Received body:", JSON.stringify({ 
    hasMessages: !!messages, 
    messagesCount: messages?.length,
    contextKey, 
    reasoningLevel,
    bodyKeys: Object.keys(body),
    messagesPreview: messages?.slice(-3).map((m: any) => ({
      role: m.role,
      text: m.parts?.[0]?.text?.substring(0, 50) || 'no text'
    }))
  }, null, 2))

  const event = createUserItemFromUIMessages(messages)

  // Build contextIdentifier and options separately
  const contextIdentifier = contextKey ? { key: contextKey } : null
  
  // Build progressStream options
  const progressOptions: { reasoningEffort?: "low" | "medium" | "high" } = {}
  
  // Only include reasoningEffort if it's provided and not "off"
  if (reasoningLevel && reasoningLevel !== "off") {
    progressOptions.reasoningEffort = reasoningLevel as "low" | "medium" | "high"
  }

  console.log("[api/agents/demo] Calling progressStream with:", {
    contextIdentifier,
    progressOptions,
    hasReasoning: !!progressOptions.reasoningEffort
  })

  try {
    const result = await demoAgent.progressStream(
      event,
      contextIdentifier,
      Object.keys(progressOptions).length > 0 ? progressOptions : undefined as any
    )

    return createUIMessageStreamResponse({ stream: result.stream })
  } catch (error) {
    console.error(
      "[api/agents/demo] progressStream failed",
      JSON.stringify(error, null, 2)
    )

    return new Response(
      JSON.stringify({
        error: "Agent failed to respond",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    )
  }
}


