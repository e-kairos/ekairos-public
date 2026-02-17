"use client"

import React, { useState } from "react"
import { Terminal } from "lucide-react"
import { Prompt } from "@/components/ekairos/prompt/prompt"
import type { RegistryItem } from "@/lib/registry-types"

const InteractivePromptDemo = () => {
  const [value, setValue] = useState("")
  const [status, setStatus] = useState<"idle" | "streaming">("idle")
  const [logs, setLogs] = useState<string[]>([])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!value.trim()) return

    const msg = `Sent: "${value}"`
    setLogs(prev => [msg, ...prev].slice(0, 3))
    setStatus("streaming")

    setTimeout(() => {
      setStatus("idle")
      setValue("")
      setLogs(prev => ["Completed", ...prev].slice(0, 3))
    }, 1500)
  }

  return (
    <div className="w-full max-w-2xl space-y-6">
      <div className="p-6 bg-muted/10 rounded-xl border">
        <Prompt
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          status={status}
          placeholder="Type something and hit Enter..."
        />
      </div>

      {logs.length > 0 && (
        <div className="p-4 bg-black/90 text-green-400 font-mono text-xs rounded-lg border border-green-900/50 shadow-inner">
          <div className="flex items-center gap-2 mb-2 text-muted-foreground border-b border-green-900/30 pb-1">
            <Terminal className="size-3" />
            <span>Event Log</span>
          </div>
          {logs.map((log, i) => (
            <div key={i} className="opacity-90">{">"} {log}</div>
          ))}
        </div>
      )}
    </div>
  )
}

export const promptRegistryItem: RegistryItem = {
  id: "prompt",
  registryName: "prompt",
  title: "Prompt Input",
  subtitle: "The main input area for user interaction with file support.",
  category: "core",
  props: [
    { name: "value", type: "string", default: "", description: "Current text value." },
    { name: "onChange", type: "(value: string) => void", default: "-", description: "Handler for text changes." },
    { name: "status", type: "'idle' | 'streaming'", default: "'idle'", description: "Visual state of the submit button." },
    { name: "attachments", type: "Attachment[]", default: "[]", description: "List of files attached to the prompt." }
  ],
  code: `<Prompt
  value={inputValue}
  onChange={setInputValue}
  onSubmit={handleSubmit}
  status="idle"
  attachments={[]}
/>`,
  render: () => <InteractivePromptDemo />
}


