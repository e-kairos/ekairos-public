import { StoryActionSpec } from "./story"

export type StoryRuntimeAction = {
  name: string
  implementationKey: string
  execute: (args: any & { contextId?: string }) => Promise<any>
}

export type StoryRuntimeCallbacks = {
  onToolCallExecuted?: (executionEvent: {
    toolCall: { toolCallId: string; toolName: string; args: any }
    success: boolean
    message?: string
    result?: any
    contextId: string
  }) => void | Promise<void>
  evaluateToolCalls?: (toolCalls: any[]) => Promise<{ success: boolean; message?: string }>
  onEnd?: (lastEvent: any) => void | { end?: boolean } | Promise<void | { end?: boolean }>
}

export type StoryRuntime = {
  key: string
  narrative: string
  actions: Record<string, StoryRuntimeAction>
  callbacks?: StoryRuntimeCallbacks
}

export type StoryDescriptor = {
  key: string
  narrative: string
  actions: Array<Pick<StoryActionSpec, "name" | "description" | "inputSchema" | "finalize" | "implementationKey">>
  options?: any
}

const GLOBAL_STORY_ENGINE_SYMBOL = Symbol.for("PULZAR_STORY_ENGINE")

type EngineState = {
  stories: Map<string, StoryRuntime>
}

function getGlobalEngine(): EngineState {
  const g = globalThis as any
  if (!g[GLOBAL_STORY_ENGINE_SYMBOL]) {
    g[GLOBAL_STORY_ENGINE_SYMBOL] = { stories: new Map<string, StoryRuntime>() }
  }
  return g[GLOBAL_STORY_ENGINE_SYMBOL] as EngineState
}

export const engine = {
  register(story: { key: string; narrative: string; actions: StoryActionSpec[]; callbacks?: StoryRuntimeCallbacks; options?: any }) {
    const runtimeActions: Record<string, StoryRuntimeAction> = {}
    for (const a of story.actions) {
      if (typeof (a as any).execute === "function") {
        runtimeActions[a.implementationKey || a.name] = {
          name: a.name,
          implementationKey: a.implementationKey || a.name,
          execute: ((a as any).execute) as (args: any) => Promise<any>,
        }
      }
    }
    const runtime: StoryRuntime = {
      key: story.key,
      narrative: story.narrative,
      actions: runtimeActions,
      callbacks: story.callbacks,
    }
    getGlobalEngine().stories.set(story.key, runtime)
    return {
      story: (key: string): StoryDescriptor => {
        const rt = getGlobalEngine().stories.get(key)
        if (!rt) throw new Error(`Story not registered: ${key}`)
        const actions = story.actions.map((a) => ({
          name: a.name,
          description: a.description,
          inputSchema: a.inputSchema,
          finalize: a.finalize,
          implementationKey: a.implementationKey,
        }))
        return { key: story.key, narrative: story.narrative, actions, options: story.options }
      }
    }
  },
  get(key: string): StoryRuntime | undefined {
    return getGlobalEngine().stories.get(key)
  }
}


