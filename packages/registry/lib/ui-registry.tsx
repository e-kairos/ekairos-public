"use client"

import React, { useState, useEffect, useRef } from "react"
import { 
  BrainCircuitIcon, 
  Code2, 
  Sparkles,
  Loader2
} from "lucide-react"
import { Prompt } from "@/components/ekairos/prompt/prompt"
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message"
import { ChainOfThought, ChainOfThoughtContent, ChainOfThoughtHeader, ChainOfThoughtStep } from "@/components/ai-elements/chain-of-thought"
import { Terminal } from "lucide-react"

// --- TYPES & DEFINITIONS ---

export type PropDefinition = {
  name: string
  type: string
  default?: string
  description: string
}

export type RegistryItem = {
  id: string
  title: string
  subtitle: string
  category: "core" | "compound" | "template"
  props?: PropDefinition[]
  render: () => React.ReactNode
  code: string
  registryName: string // Name used in registry JSON (e.g., "message", "chain-of-thought")
}

// --- INTERACTIVE DEMO COMPONENTS ---

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
            <div key={i} className="opacity-90">{'>'} {log}</div>
          ))}
        </div>
      )}
    </div>
  )
}

const InteractiveChatDemo = () => {
  const [messages, setMessages] = useState<Array<{role: "user" | "assistant", content: string}>>([
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
      setMessages(prev => [...prev, { 
        role: "assistant", 
        content: `I received your message: "${userMsg}". This is a simulated response to demonstrate the chat interface.` 
      }])
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

const InteractiveCoTDemo = () => {
  const [step, setStep] = useState(0)
  const [isOpen, setIsOpen] = useState(true)

  const runSimulation = () => {
    setStep(0)
    setIsOpen(true)
    
    const interval = setInterval(() => {
      setStep(prev => {
        if (prev >= 3) {
          clearInterval(interval)
          return 3
        }
        return prev + 1
      })
    }, 1500)
  }

  return (
    <div className="w-full max-w-md mx-auto space-y-4">
      <div className="border p-4 rounded-lg bg-background shadow-sm">
        <ChainOfThought defaultOpen={isOpen}>
          <ChainOfThoughtHeader />
          <ChainOfThoughtContent>
            <ChainOfThoughtStep
              icon={BrainCircuitIcon}
              label="Analysis"
              status={step === 0 ? "active" : "complete"}
            >
              <div className="text-sm text-muted-foreground">
                {step === 0 ? "Analyzing input intent..." : "Intent identified: Query"}
              </div>
            </ChainOfThoughtStep>
            
            {step >= 1 && (
              <ChainOfThoughtStep
                icon={Code2}
                label="Retrieval"
                status={step === 1 ? "active" : "complete"}
              >
                <div className="text-sm text-muted-foreground">
                   {step === 1 ? "Fetching context from database..." : "Context retrieved (3 records)"}
                </div>
              </ChainOfThoughtStep>
            )}

            {step >= 2 && (
               <ChainOfThoughtStep
                icon={Sparkles}
                label="Generation"
                status={step === 2 ? "active" : "complete"}
              >
                <div className="text-sm text-muted-foreground">
                  {step === 2 ? "Drafting response..." : "Response generated"}
                </div>
              </ChainOfThoughtStep>
            )}
          </ChainOfThoughtContent>
        </ChainOfThought>
        
        {step === 3 && (
          <div className="mt-4 p-3 bg-muted/20 rounded text-sm animate-in fade-in slide-in-from-top-2">
            Analysis complete. Here is the result based on the reasoning steps above.
          </div>
        )}
      </div>

      <button 
        onClick={runSimulation}
        disabled={step > 0 && step < 3}
        className="w-full py-2 px-4 bg-primary/10 text-primary hover:bg-primary/20 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
      >
        {step > 0 && step < 3 ? "Reasoning..." : "Replay Simulation"}
      </button>
    </div>
  )
}

const InteractiveFullAgentDemo = () => {
    const [messages, setMessages] = useState<Array<{role: "user" | "assistant", content: React.ReactNode}>>([
        { role: "user", content: "Show me the latest active tenders." },
        { role: "assistant", content: (
            <>
                <p>Here are the active tenders I found for you:</p>
                <div className="mt-4 grid gap-2">
                    <div className="p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors cursor-pointer flex items-center gap-3">
                        <div className="h-10 w-10 rounded bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-xs">T-01</div>
                        <div>
                        <div className="text-sm font-medium">IT Infrastructure Upgrade</div>
                        <div className="text-xs text-muted-foreground">Closing in 2 days • $450k Budget</div>
                        </div>
                    </div>
                </div>
            </>
        )}
    ])
    const [input, setInput] = useState("")

    const handleSend = (e: React.FormEvent) => {
        e.preventDefault()
        if(!input.trim()) return
        setMessages(prev => [...prev, { role: "user", content: input }])
        setInput("")
    }

    return (
      <div className="h-[600px] w-full rounded-2xl border bg-background overflow-hidden shadow-2xl flex flex-col relative ring-1 ring-border mx-auto max-w-3xl">
        <div className="h-12 border-b bg-muted/50 flex items-center px-4 gap-2">
          <div className="h-3 w-3 rounded-full bg-red-400/80"></div>
          <div className="h-3 w-3 rounded-full bg-yellow-400/80"></div>
          <div className="h-3 w-3 rounded-full bg-green-400/80"></div>
          <span className="ml-4 text-xs font-medium text-muted-foreground">Agent Preview</span>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-background">
          {messages.map((msg, i) => {
            const content = typeof msg.content === "string" ? <MessageResponse>{msg.content}</MessageResponse> : msg.content

            return (
              <Message key={i} from={msg.role}>
                <MessageContent 
                    variant={msg.role === "user" ? "contained" : "flat"} 
                    className={msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-transparent px-0 py-0"}
                >
                  {content}
                </MessageContent>
              </Message>
            )
          })}
        </div>

        <div className="relative z-10">
           <div className="absolute bottom-full left-0 right-0 h-12 bg-gradient-to-t from-background to-transparent pointer-events-none"></div>
           <div className="p-4 bg-background pb-6">
              <Prompt 
                value={input} 
                onChange={setInput} 
                onSubmit={handleSend}
                status="idle"
                placeholder="Type a message..."
              />
           </div>
        </div>
      </div>
    )
}

// --- REGISTRY DATA ---

export const registryData: RegistryItem[] = [
  {
    id: "message",
    registryName: "message",
    title: "Message",
    subtitle: "Core chat bubble component supporting user and assistant variants. Try sending a message!",
    category: "core",
    props: [
      { name: "from", type: "'user' | 'assistant'", default: "required", description: "Determines the alignment and styling base of the message." },
      { name: "children", type: "ReactNode", default: "-", description: "The content of the message, usually MessageContent." },
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
  },
  {
    id: "chain-of-thought",
    registryName: "chain-of-thought",
    title: "Chain of Thought",
    subtitle: "Collapsible component to visualize AI reasoning steps.",
    category: "compound",
    props: [
      { name: "defaultOpen", type: "boolean", default: "false", description: "Whether the thought process is visible initially." },
      { name: "status", type: "'pending' | 'active' | 'complete'", default: "complete", description: "State of the specific reasoning step." },
    ],
    code: `<ChainOfThought defaultOpen={true}>
  <ChainOfThoughtHeader />
  <ChainOfThoughtContent>
    <ChainOfThoughtStep
      icon={BrainCircuitIcon}
      label="Reasoning"
      status="active"
    >
      Analyzing user request intent...
    </ChainOfThoughtStep>
  </ChainOfThoughtContent>
</ChainOfThought>`,
    render: () => <InteractiveCoTDemo />
  },
  {
    id: "prompt",
    registryName: "prompt",
    title: "Prompt Input",
    subtitle: "The main input area for user interaction with file support.",
    category: "core",
    props: [
      { name: "value", type: "string", default: "", description: "Current text value." },
      { name: "onChange", type: "(value: string) => void", default: "-", description: "Handler for text changes." },
      { name: "status", type: "'idle' | 'streaming'", default: "'idle'", description: "Visual state of the submit button." },
      { name: "attachments", type: "Attachment[]", default: "[]", description: "List of files attached to the prompt." },
    ],
    code: `<Prompt 
  value={inputValue} 
  onChange={setInputValue} 
  onSubmit={handleSubmit}
  status="idle"
  attachments={[]}
/>`,
    render: () => <InteractivePromptDemo />
  },
  {
    id: "full-agent",
    registryName: "full-agent",
    title: "Full Agent Layout",
    subtitle: "A complete composition of all components working together.",
    category: "template",
    props: [],
    code: `import { useState } from "react"
import { Message, MessageContent } from "@/components/ai-elements/message"
import { MessageResponse } from "@/components/ai-elements/message"
import { Prompt } from "@/components/ekairos/prompt/prompt"

export function FullAgentLayout() {
  const [messages, setMessages] = useState<Array<{
    role: "user" | "assistant"
    content: React.ReactNode
  }>>([
    { 
      role: "user", 
      content: "Show me the latest active tenders." 
    },
    { 
      role: "assistant", 
      content: (
        <>
          <p>Here are the active tenders I found for you:</p>
          <div className="mt-4 grid gap-2">
            <div className="p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors cursor-pointer flex items-center gap-3">
              <div className="h-10 w-10 rounded bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-xs">
                T-01
              </div>
              <div>
                <div className="text-sm font-medium">IT Infrastructure Upgrade</div>
                <div className="text-xs text-muted-foreground">Closing in 2 days • $450k Budget</div>
              </div>
            </div>
          </div>
        </>
      )
    }
  ])
  const [input, setInput] = useState("")

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return
    setMessages(prev => [...prev, { role: "user", content: input }])
    setInput("")
  }

  return (
    <div className="h-[600px] w-full rounded-2xl border bg-background overflow-hidden shadow-2xl flex flex-col relative ring-1 ring-border mx-auto max-w-3xl">
      <div className="h-12 border-b bg-muted/50 flex items-center px-4 gap-2">
        <div className="h-3 w-3 rounded-full bg-red-400/80"></div>
        <div className="h-3 w-3 rounded-full bg-yellow-400/80"></div>
        <div className="h-3 w-3 rounded-full bg-green-400/80"></div>
        <span className="ml-4 text-xs font-medium text-muted-foreground">
          Agent Preview
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-background">
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
      </div>

      <div className="relative z-10">
        <div className="absolute bottom-full left-0 right-0 h-12 bg-gradient-to-t from-background to-transparent pointer-events-none"></div>
        <div className="p-4 bg-background pb-6">
          <Prompt 
            value={input} 
            onChange={setInput} 
            onSubmit={handleSend}
            status="idle"
            placeholder="Type a message..."
          />
        </div>
      </div>
    </div>
  )
}`,
    render: () => <InteractiveFullAgentDemo />
  }
]

