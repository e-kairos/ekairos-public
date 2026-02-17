import { UIMessage, createUIMessageStreamResponse } from "ai"
import { init } from "@instantdb/admin"
import { buildSimpleAgent } from "@/lib/agents/simple-agent"

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

const db = init({
  appId: process.env.NEXT_PUBLIC_INSTANT_APP_ID!,
  adminToken: process.env.INSTANT_APP_ADMIN_TOKEN!,
})

const { build: simpleAgent } = buildSimpleAgent(db)

export async function POST(req: Request) {
  const {
    messages,
    contextKey,
  }: {
    messages: UIMessage[]
    contextKey?: string
  } = await req.json()

  const event = createUserItemFromUIMessages(messages)

  try {
    const result = await simpleAgent.progressStream(
      event,
      contextKey ? { key: contextKey } : null
    )

    return createUIMessageStreamResponse({ stream: result.stream })
  } catch (error) {
    console.error(
      "[api/agents/simple] progressStream failed",
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





