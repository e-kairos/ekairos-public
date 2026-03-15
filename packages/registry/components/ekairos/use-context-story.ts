"use client"

import React from "react"

type ContextEvent = { id: string; role: "user" | "assistant"; parts: Array<any> }
type Context = { key: string; events: ContextEvent[] }
type StoryEvent = { type: string; channel: string; parts?: Array<any> }

export function useStory({ key, url }: { key: string; url?: string }) {
  const [contextId, setContextId] = React.useState<string | undefined>(undefined)
  const [events, setEvents] = React.useState<ContextEvent[]>([])
  const [status, setStatus] = React.useState<"idle" | "streaming" | "submitted">("idle")
  const [input, setInput] = React.useState("")

  React.useEffect(() => {
    // no-op initial fetch for demo; could fetch existing context here
  }, [contextId, url, key])

  async function sendEvent(ev: StoryEvent) {
    const endpoint = typeof url === 'string' && url.length > 0 ? url : "/api/story"
    const body = { name: key, input: { contextId, event: ev } }
    const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    const json = await res.json().catch(() => ({} as any))
    const data = (json?.data || json)
    const context: Context | undefined = data?.context
    if (context?.key) { setContextId(context.key) }
    if (Array.isArray(context?.events)) { setEvents(context!.events) }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim()) { return }
    setStatus("submitted")
    try {
      const ev: StoryEvent = { type: "message.created", channel: "web", parts: [{ type: "text", text: input }] }
      await sendEvent(ev)
      setInput("")
    } finally {
      setStatus("idle")
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value)
  }

  return { contextId, events, status, input, handleInputChange, handleSubmit, sendEvent }
}





