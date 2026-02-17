"use client"

import React, { useEffect, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { Prompt } from "@/components/ekairos/prompt/prompt"
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message"
import type { RegistryItem } from "@/lib/registry-types"

const InteractiveChatDemo = () => {
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([
    { role: "assistant", content: "Hello! I'm a simulated AI agent. How can I help you today?" }
  ])
  const [input, setInput] = useState("")
  const [isTyping, setIsTyping] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, isTyping])

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return

    const userMsg = input
    setMessages(prev => [...prev, { role: "user", content: userMsg }])
    setInput("")
    setIsTyping(true)

    setTimeout(() => {
      setMessages(prev => [
        ...prev,
        {
          role: "assistant",
          content: `I received your message: "${userMsg}". This is a simulated response to demonstrate the chat interface.`
        }
      ])
      setIsTyping(false)
    }, 1500)
  }

  return (
    <div className="w-full max-w-md mx-auto h-[500px] flex flex-col border rounded-xl bg-background shadow-sm overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-muted/5" ref={scrollRef}>
        {messages.map((msg, i) => (
          <Message key={i} from={msg.role}>
            <MessageContent
              variant={msg.role === "user" ? "contained" : "flat"}
              className={msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-transparent px-0 py-0"}
            >
              <MessageResponse>{msg.content}</MessageResponse>
            </MessageContent>
          </Message>
        ))}
        {isTyping && (
          <Message from="assistant">
            <MessageContent variant="flat" className="bg-transparent px-0 py-0">
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="size-3 animate-spin" />
                Pensando...
              </div>
            </MessageContent>
          </Message>
        )}
      </div>
      <div className="p-4 border-t bg-background">
        <Prompt
          value={input}
          onChange={setInput}
          onSubmit={handleSend}
          status={isTyping ? "streaming" : "idle"}
          placeholder="Say hello..."
        />
      </div>
    </div>
  )
}

export const messageRegistryItem: RegistryItem = {
  id: "message",
  registryName: "message",
  title: "Message",
  subtitle: "Core chat bubble component supporting user and assistant variants. Try sending a message!",
  category: "core",
  props: [
    { name: "from", type: "'user' | 'assistant'", default: "required", description: "Determines the alignment and styling base of the message." },
    { name: "children", type: "ReactNode", default: "-", description: "The content of the message, usually MessageContent." }
  ],
  code: `<Message from="user">
  <MessageContent variant="contained" className="bg-primary text-primary-foreground">
    <MessageResponse>Hello, I need help.</MessageResponse>
  </MessageContent>
</Message>

<Message from="assistant">
  <MessageContent variant="flat">
    <MessageResponse>How can I help you today?</MessageResponse>
  </MessageContent>
</Message>`,
  render: () => <InteractiveChatDemo />
}


