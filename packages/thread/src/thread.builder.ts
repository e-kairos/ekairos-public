import type { Tool } from "ai"

import type { ThreadEnvironment } from "./thread.config.js"
import {
  Thread,
  type ThreadModelInit,
  type ThreadOptions,
  type ThreadTool,
  type ShouldContinue,
  type ThreadShouldContinueArgs,
  type ThreadReactParams,
} from "./thread.engine.js"
import type { ThreadReactor } from "./thread.reactor.js"
import type { ThreadItem, StoredContext } from "./thread.store.js"
import { registerThread, type ThreadKey } from "./thread.registry.js"

export interface ThreadConfig<
  Context,
  Env extends ThreadEnvironment = ThreadEnvironment,
> {
  context: (context: StoredContext<Context>, env: Env) => Promise<Context> | Context
  /**
   * Event expansion stage (first-class; executed by the engine on every loop iteration).
   *
   * Runs inside the Thread loop after events are loaded from the store and before
   * they are converted into model messages.
   *
   * This is the intended place to do "document expansion" (turn file references
   * into text parts) using LlamaCloud/Reducto/etc.
   *
   * If you do not provide an implementation, the default is an identity transform
   * (events pass through unchanged).
   *
   * If you do I/O here, implement it as a `"use-step"` function.
   */
  expandEvents?: (
    events: ThreadItem[],
    context: StoredContext<Context>,
    env: Env,
  ) => Promise<ThreadItem[]> | ThreadItem[]
  /**
   * Thread-first "system" message for the model for this Thread run.
   */
  narrative: (
    context: StoredContext<Context>,
    env: Env,
  ) => Promise<string> | string
  /**
   * Actions available to the model (aka "tools" in AI SDK terminology).
   */
  actions: (
    context: StoredContext<Context>,
    env: Env,
  ) => Promise<Record<string, ThreadTool>> | Record<string, ThreadTool>
  /**
   * @deprecated Use `actions()` instead.
   */
  tools?: (
    context: StoredContext<Context>,
    env: Env,
  ) => Promise<Record<string, ThreadTool>> | Record<string, ThreadTool>
  /**
   * Model configuration (DurableAgent-style).
   *
   * - `string`: AI Gateway model id, resolved in the LLM step (e.g. `"openai/gpt-5.1-thinking"`).
   * - `() => Promise<model>`: model factory. For Workflow compatibility, provide a `"use-step"` function
   *   so it can be serialized by reference.
   * - `(context, env) => ...`: dynamic selection based on current context/env (runs in workflow context).
   */
  model?:
    | ThreadModelInit
    | ((context: StoredContext<Context>, env: Env) => ThreadModelInit)
  reactor?: ThreadReactor<Context, Env>
  /**
   * Called after each streamed model "reaction" and subsequent tool executions.
   *
   * Use this to decide whether the Thread loop should continue.
   *
   * - `true`  => continue looping
   * - `false` => finalize the Thread run
   */
  shouldContinue?: (
    args: ThreadShouldContinueArgs<Context, Env>,
  ) => Promise<ShouldContinue> | ShouldContinue
  opts?: ThreadOptions<Context, Env>
}

export type ThreadInstance<
  Context,
  Env extends ThreadEnvironment = ThreadEnvironment,
> = Thread<Context, Env> & {
  readonly __config: ThreadConfig<Context, Env>
}

function isDynamicModelSelector<Context, Env extends ThreadEnvironment>(
  model: ThreadConfig<Context, Env>["model"],
): model is (context: StoredContext<Context>, env: Env) => ThreadModelInit {
  return typeof model === "function" && model.length >= 1
}

export function thread<
  Context,
  Env extends ThreadEnvironment = ThreadEnvironment,
>(config: ThreadConfig<Context, Env>): ThreadInstance<Context, Env> {
  class FunctionalThread extends Thread<Context, Env> {
    public readonly __config = config

    constructor() {
      super(config.opts, config.reactor)
    }

    protected async initialize(context: StoredContext<Context>, env: Env) {
      return config.context(context, env)
    }

    protected async expandEvents(
      events: ThreadItem[],
      context: StoredContext<Context>,
      env: Env,
    ) {
      if (config.expandEvents) return config.expandEvents(events, context, env)
      return super.expandEvents(events, context, env)
    }

    protected async buildSystemPrompt(context: StoredContext<Context>, env: Env) {
      if (config.narrative) return config.narrative(context, env)
      throw new Error("Thread config is missing narrative()")
    }

    protected async buildTools(context: StoredContext<Context>, env: Env) {
      // Back-compat: accept `tools` in old configs.
      if (config.actions) return config.actions(context, env)
      if (config.tools) return config.tools(context, env)
      throw new Error("Thread config is missing actions()")
    }

    protected getModel(context: StoredContext<Context>, env: Env) {
      if (isDynamicModelSelector(config.model)) return config.model(context, env)
      return config.model ?? super.getModel(context, env)
    }

    protected async shouldContinue(args: ThreadShouldContinueArgs<Context, Env>) {
      if (config.shouldContinue) return config.shouldContinue(args)
      return true
    }
  }

  const instance = new FunctionalThread()
  return Object.assign(instance, { __config: config })
}

type AnyContextInitializer<Env extends ThreadEnvironment> = (
  context: StoredContext<any>,
  env: Env,
) => Promise<any> | any

type InferContextFromInitializer<I extends AnyContextInitializer<any>> = Awaited<
  ReturnType<I>
>

type BuilderSystemPrompt<Context, Env extends ThreadEnvironment> = (
  context: StoredContext<Context>,
  env: Env,
) => Promise<string> | string

type BuilderTools<Context, Env extends ThreadEnvironment> = (
  context: StoredContext<Context>,
  env: Env,
) => Promise<Record<string, ThreadTool>> | Record<string, ThreadTool>

type BuilderExpandEvents<Context, Env extends ThreadEnvironment> = (
  events: ThreadItem[],
  context: StoredContext<Context>,
  env: Env,
) => Promise<ThreadItem[]> | ThreadItem[]

type BuilderShouldContinue<Context, Env extends ThreadEnvironment> = (
  args: ThreadShouldContinueArgs<Context, Env>,
) => Promise<ShouldContinue> | ShouldContinue

type BuilderModel<Context, Env extends ThreadEnvironment> =
  | ThreadModelInit
  | ((context: StoredContext<Context>, env: Env) => ThreadModelInit)

export type RegistrableThreadBuilder = {
  key: ThreadKey
  register: () => void
}

type FluentThreadBuilder<Context, Env extends ThreadEnvironment> = {
  key: ThreadKey
  expandEvents(fn: BuilderExpandEvents<Context, Env>): FluentThreadBuilder<Context, Env>
  narrative(fn: BuilderSystemPrompt<Context, Env>): FluentThreadBuilder<Context, Env>
  /**
   * "System" facade (AI SDK terminology).
   */
  system(fn: BuilderSystemPrompt<Context, Env>): FluentThreadBuilder<Context, Env>
  actions(fn: BuilderTools<Context, Env>): FluentThreadBuilder<Context, Env>
  /**
   * @deprecated Use `actions()` instead.
   */
  tools(fn: BuilderTools<Context, Env>): FluentThreadBuilder<Context, Env>
  model(model: BuilderModel<Context, Env>): FluentThreadBuilder<Context, Env>
  reactor(reactor: ThreadReactor<Context, Env>): FluentThreadBuilder<Context, Env>
  /**
   * Stop/continue hook (DurableAgent-like stop condition).
   */
  shouldContinue(fn: BuilderShouldContinue<Context, Env>): FluentThreadBuilder<Context, Env>
  opts(opts: ThreadOptions<Context, Env>): FluentThreadBuilder<Context, Env>
  /**
   * Convenience: react to an incoming event without requiring an explicit `.build()`.
   *
   * This still validates the config is complete (same as `.build()`), then delegates to the
   * underlying `Thread.react(...)`.
   */
  react(
    triggerEvent: ThreadItem,
    params: ThreadReactParams<Env>,
  ): ReturnType<Thread<Context, Env>["react"]>
  /**
   * @deprecated Use `react()` instead. Kept for backwards compatibility.
   */
  stream(
    triggerEvent: ThreadItem,
    params: ThreadReactParams<Env>,
  ): ReturnType<Thread<Context, Env>["react"]>
  /**
   * Registers this Thread definition in the global registry under `key`.
   *
   * This is intended to be called at module load / boot time so durable workflows
   * can resume and still resolve the Thread by key without requiring an endpoint
   * to call `.build()` again.
   */
  register(): void
  config(): ThreadConfig<Context, Env>
  build(): ThreadInstance<Context, Env>
}

type CreateThreadEntry<Env extends ThreadEnvironment> = {
  context<Initializer extends AnyContextInitializer<Env>>(
    initializer: Initializer,
  ): FluentThreadBuilder<InferContextFromInitializer<Initializer>, Env>
  initialize<Initializer extends AnyContextInitializer<Env>>(
    initializer: Initializer,
  ): FluentThreadBuilder<InferContextFromInitializer<Initializer>, Env>
}

function assertConfigComplete<Context, Env extends ThreadEnvironment>(
  config: Partial<ThreadConfig<Context, Env>>,
): asserts config is ThreadConfig<Context, Env> {
  if (!config.context) {
    throw new Error("createThread: you must define context() before building the Thread.")
  }
  if (!config.narrative) {
    throw new Error("createThread: you must define narrative() before building the Thread.")
  }
  if (!config.actions && !config.tools) {
    throw new Error("createThread: you must define actions() before building the Thread.")
  }
}

export function createThread<Env extends ThreadEnvironment = ThreadEnvironment>(
  key: ThreadKey,
): CreateThreadEntry<Env>

export function createThread<Env extends ThreadEnvironment = ThreadEnvironment>(
  key: ThreadKey,
): CreateThreadEntry<Env> {
  const initializeBuilder = <Initializer extends AnyContextInitializer<Env>>(
    initializer: Initializer,
  ) => {
    type Context = InferContextFromInitializer<Initializer>

    const typedInitializer: ThreadConfig<Context, Env>["context"] = (ctx, env) =>
      initializer(ctx as StoredContext<Context>, env)

    const fluentState: Partial<ThreadConfig<Context, Env>> = {
      context: typedInitializer,
    }

    let cached: ThreadInstance<Context, Env> | null = null

    const builder: FluentThreadBuilder<Context, Env> = {
      key,
                  expandEvents(fn) {
                    fluentState.expandEvents = fn
                    return builder
                  },
      narrative(narrative) {
        fluentState.narrative = narrative
        return builder
      },
      system(system) {
        // Facade alias.
        fluentState.narrative = system
        return builder
      },
      actions(actionsFactory) {
        fluentState.actions = actionsFactory
        return builder
      },
      tools(toolsFactory) {
        // Back-compat alias.
        fluentState.actions = toolsFactory
        return builder
      },
      model(model) {
        fluentState.model = model as any
        return builder
      },
      reactor(reactor) {
        fluentState.reactor = reactor
        return builder
      },
      shouldContinue(fn) {
        fluentState.shouldContinue = fn as any
        return builder
      },
      opts(options) {
        fluentState.opts = options
        return builder
      },
      react(triggerEvent, params) {
        assertConfigComplete(fluentState)
        if (!cached) {
          const config = fluentState as ThreadConfig<Context, Env>
          cached = thread(config)
        }
        return cached.react(triggerEvent, params)
      },
      stream(triggerEvent, params) {
        return builder.react(triggerEvent, params)
      },
      register() {
        assertConfigComplete(fluentState)
        const config = fluentState as ThreadConfig<Context, Env>
        registerThread(key, () => thread(config) as any)
      },
      config() {
        assertConfigComplete(fluentState)
        return fluentState
      },
      build() {
        assertConfigComplete(fluentState)
        const config = fluentState as ThreadConfig<Context, Env>
        return thread(config)
      },
    }

    return builder
  }

  return {
    context: initializeBuilder,
    initialize: initializeBuilder,
  }
}



