"use client"

import { useCallback, Suspense } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import Agent from "@/components/ekairos/agent/Agent"
import { AgentHistory } from "@/components/ekairos/agent/agent-history"
import { AgentNewChat } from "@/components/ekairos/agent/agent-new-chat"
import { init } from "@instantdb/react"

const db = init({ appId: process.env.NEXT_PUBLIC_INSTANT_APP_ID! })

function InteractiveFullAgentDemoContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  
  const { data } = db.useQuery({
    thread_contexts: {}
  })

  const history = (data?.thread_contexts || [])
    .sort((a: any, b: any) => {
      const dateA = new Date(a.createdAt || 0).getTime()
      const dateB = new Date(b.createdAt || 0).getTime()
      return dateB - dateA
    })
    .map((ctx: any) => ({
      id: ctx.id,
      title: ctx.title || "Nuevo Chat",
      createdAt: ctx.createdAt
    }))
  
  const handleContextUpdate = useCallback((contextId: string) => {
    // Update URL with contextId for shareable links
    const params = new URLSearchParams(window.location.search)
    if (contextId && contextId.length > 0) {
      params.set("contextId", contextId)
    } else {
      params.delete("contextId")
    }
    const paramsString = params.toString()
    let nextUrl = window.location.pathname
    if (paramsString.length > 0) {
      nextUrl = nextUrl + "?" + paramsString
    }
    window.history.replaceState({}, "", nextUrl)
    
    console.log("[Full Agent Demo] Context updated:", contextId)
  }, [])

  const handleNewChat = useCallback(() => {
    const params = new URLSearchParams(window.location.search)
    params.delete("contextId")
    const paramsString = params.toString()
    let nextUrl = window.location.pathname
    if (paramsString.length > 0) {
      nextUrl = nextUrl + "?" + paramsString
    }
    window.history.replaceState({}, "", nextUrl)
  }, [])

  const initialContextId = searchParams.get("contextId") || undefined

  const handleDeleteChat = useCallback(async (contextId: string) => {
    await db.transact(
      db.tx.thread_contexts[contextId].delete()
    )
    if (initialContextId === contextId) {
      handleNewChat()
    }
  }, [initialContextId, handleNewChat])

  return (
    <div className="h-[600px] w-full rounded-2xl border bg-background overflow-hidden shadow-2xl flex flex-col relative ring-1 ring-border mx-auto max-w-3xl">
      <div className="h-12 border-b bg-muted/50 flex items-center px-4 justify-between">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-red-400/80"></div>
          <div className="h-3 w-3 rounded-full bg-yellow-400/80"></div>
          <div className="h-3 w-3 rounded-full bg-green-400/80"></div>
          <span className="ml-4 text-xs font-medium text-muted-foreground">Ekairos Agent Preview</span>
        </div>
        <div className="flex items-center gap-2">
          <AgentNewChat onNewChat={handleNewChat} label="Nuevo" className="h-7 text-xs px-2" />
          <AgentHistory 
            history={history} 
            selectedContextId={initialContextId} 
            onHistorySelect={handleContextUpdate} 
            onDeleteChat={handleDeleteChat} 
          />
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <Agent
          apiUrl="/api/agents/demo"
          onContextUpdate={handleContextUpdate}
          toolComponents={{}}
          initialContextId={initialContextId}
          classNames={{
            container: "h-full",
            scrollArea: "h-full",
          }}
        />
      </div>
    </div>
  )
}

const InteractiveFullAgentDemo = () => {
  return (
    <Suspense 
      fallback={
        <div className="h-[600px] w-full rounded-2xl border bg-background flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-sm text-muted-foreground">Loading Agent...</p>
          </div>
        </div>
      }
    >
      <InteractiveFullAgentDemoContent />
    </Suspense>
  )
}

export const fullAgentRegistryItem: RegistryItem = {
  id: "full-agent",
  registryName: "full-agent",
  title: "Full Agent Layout",
  subtitle: "A complete composition of all components working together.",
  category: "template",
  props: [],
  code: `"use client"

import { useCallback, Suspense } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import Agent from "@/components/ekairos/agent/Agent"
import { AgentHistory } from "@/components/ekairos/agent/agent-history"
import { AgentNewChat } from "@/components/ekairos/agent/agent-new-chat"
import { init } from "@instantdb/react"

const db = init({ appId: process.env.NEXT_PUBLIC_INSTANT_APP_ID! })

function FullAgentLayoutContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  
  const { data } = db.useQuery({
    thread_contexts: {}
  })

  const history = (data?.thread_contexts || [])
    .sort((a: any, b: any) => {
      const dateA = new Date(a.createdAt || 0).getTime()
      const dateB = new Date(b.createdAt || 0).getTime()
      return dateB - dateA
    })
    .map((ctx: any) => ({
      id: ctx.id,
      title: ctx.title || "Nuevo Chat",
      createdAt: ctx.createdAt
    }))
  
  const handleContextUpdate = useCallback((contextId: string) => {
    // Update URL with contextId for shareable links
    const params = new URLSearchParams(window.location.search)
    if (contextId && contextId.length > 0) {
      params.set("contextId", contextId)
    } else {
      params.delete("contextId")
    }
    const paramsString = params.toString()
    let nextUrl = window.location.pathname
    if (paramsString.length > 0) {
      nextUrl = nextUrl + "?" + paramsString
    }
    router.replace(nextUrl)
  }, [router])

  const handleNewChat = useCallback(() => {
    const params = new URLSearchParams(window.location.search)
    params.delete("contextId")
    const paramsString = params.toString()
    let nextUrl = window.location.pathname
    if (paramsString.length > 0) {
      nextUrl = nextUrl + "?" + paramsString
    }
    router.replace(nextUrl)
  }, [router])

  const initialContextId = searchParams.get("contextId") || undefined

  const handleDeleteChat = useCallback(async (contextId: string) => {
    await db.transact(
      db.tx.thread_contexts[contextId].delete()
    )
    if (initialContextId === contextId) {
      handleNewChat()
    }
  }, [initialContextId, handleNewChat])

  return (
    <div className="h-[600px] w-full rounded-2xl border bg-background overflow-hidden shadow-2xl flex flex-col relative ring-1 ring-border mx-auto max-w-3xl">
      <div className="h-12 border-b bg-muted/50 flex items-center px-4 justify-between">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-red-400/80"></div>
          <div className="h-3 w-3 rounded-full bg-yellow-400/80"></div>
          <div className="h-3 w-3 rounded-full bg-green-400/80"></div>
          <span className="ml-4 text-xs font-medium text-muted-foreground">
            Ekairos Agent Preview
          </span>
        </div>
        <div className="flex items-center gap-2">
          <AgentNewChat onNewChat={handleNewChat} label="Nuevo" className="h-7 text-xs px-2" />
          <AgentHistory 
            history={history} 
            selectedContextId={initialContextId} 
            onHistorySelect={handleContextUpdate} 
            onDeleteChat={handleDeleteChat} 
          />
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <Agent
          apiUrl="/api/agents/demo"
          onContextUpdate={handleContextUpdate}
          toolComponents={{}}
          initialContextId={initialContextId}
          classNames={{
            container: "h-full",
            scrollArea: "h-full",
          }}
        />
      </div>
    </div>
  )
}

export function FullAgentLayout() {
  return (
    <Suspense 
      fallback={
        <div className="h-[600px] w-full rounded-2xl border bg-background flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-sm text-muted-foreground">Loading Agent...</p>
          </div>
        </div>
      }
    >
      <FullAgentLayoutContent />
    </Suspense>
  )
}`,
  render: () => <InteractiveFullAgentDemo />
}


