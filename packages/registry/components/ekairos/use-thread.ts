"use client"

import React from "react"

type ThreadEvent = { id: string; role: "user" | "assistant"; parts: Array<any> }
type Thread = { key: string; events: ThreadEvent[] }

export function useThread({ threadId, url }: { threadId: string; url: string }) {
  const [events, setEvents] = React.useState<ThreadEvent[]>([])
  const [status, setStatus] = React.useState<"idle" | "streaming" | "submitted">("idle")
  const [input, setInput] = React.useState("")

  React.useEffect(() => {
    // no-op initial fetch for demo; could fetch existing thread here
  }, [threadId, url])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim()) {
      return
    }
    setStatus("submitted")
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: input }) })
      const thread: Thread = await res.json()
      setEvents(thread.events || [])
      setInput("")
    } finally {
      setStatus("idle")
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value)
  }

  return { events, status, input, handleInputChange, handleSubmit }
}



