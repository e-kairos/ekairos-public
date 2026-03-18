import type { Tool } from "ai"

import type { ContextEnvironment } from "./context.config.js"
import type { ContextSkillPackage } from "./context.skill.js"
import {
  ContextEngine,
  type ContextModelInit,
  type ContextOptions,
  type ContextTool,
  type ShouldContinue,
  type ContextShouldContinueArgs,
  type ContextReactParams,
} from "./context.engine.js"
import type { ContextReactor } from "./context.reactor.js"
import type { ContextItem, StoredContext } from "./context.store.js"
import { registerContext, type ContextKey } from "./context.registry.js"

export interface ContextConfig<
  Context,
  Env extends ContextEnvironment = ContextEnvironment,
> {
  context: (context: StoredContext<Context>, env: Env) => Promise<Context> | Context
  expandEvents?: (
    events: ContextItem[],
    context: StoredContext<Context>,
    env: Env,
  ) => Promise<ContextItem[]> | ContextItem[]
  narrative: (
    context: StoredContext<Context>,
    env: Env,
  ) => Promise<string> | string
  skills?: (
    context: StoredContext<Context>,
    env: Env,
  ) => Promise<ContextSkillPackage[]> | ContextSkillPackage[]
  actions: (
    context: StoredContext<Context>,
    env: Env,
  ) => Promise<Record<string, ContextTool>> | Record<string, ContextTool>
  /**
   * @deprecated Use `actions()` instead.
   */
  tools?: (
    context: StoredContext<Context>,
    env: Env,
  ) => Promise<Record<string, ContextTool>> | Record<string, ContextTool>
  model?:
    | ContextModelInit
    | ((context: StoredContext<Context>, env: Env) => ContextModelInit)
  reactor?: ContextReactor<Context, Env>
  shouldContinue?: (
    args: ContextShouldContinueArgs<Context, Env>,
  ) => Promise<ShouldContinue> | ShouldContinue
  opts?: ContextOptions<Context, Env>
}

export type ContextInstance<
  Context,
  Env extends ContextEnvironment = ContextEnvironment,
> = ContextEngine<Context, Env> & {
  readonly __config: ContextConfig<Context, Env>
  readonly __contextKey?: ContextKey
}

function isDynamicModelSelector<Context, Env extends ContextEnvironment>(
  model: ContextConfig<Context, Env>["model"],
): model is (context: StoredContext<Context>, env: Env) => ContextModelInit {
  return typeof model === "function" && model.length >= 1
}

export function context<
  Context,
  Env extends ContextEnvironment = ContextEnvironment,
>(config: ContextConfig<Context, Env>): ContextInstance<Context, Env> {
  class FunctionalContext extends ContextEngine<Context, Env> {
    public readonly __config = config

    constructor() {
      super(config.opts, config.reactor)
    }

    protected async initialize(contextValue: StoredContext<Context>, env: Env) {
      return config.context(contextValue, env)
    }

    protected async expandEvents(
      events: ContextItem[],
      contextValue: StoredContext<Context>,
      env: Env,
    ) {
      if (config.expandEvents) return config.expandEvents(events, contextValue, env)
      return super.expandEvents(events, contextValue, env)
    }

    protected async buildSystemPrompt(contextValue: StoredContext<Context>, env: Env) {
      if (config.narrative) return config.narrative(contextValue, env)
      throw new Error("Context config is missing narrative()")
    }

    protected async buildSkills(contextValue: StoredContext<Context>, env: Env) {
      if (config.skills) return config.skills(contextValue, env)
      return []
    }

    protected async buildTools(contextValue: StoredContext<Context>, env: Env) {
      if (config.actions) return config.actions(contextValue, env)
      if (config.tools) return config.tools(contextValue, env)
      throw new Error("Context config is missing actions()")
    }

    protected getModel(contextValue: StoredContext<Context>, env: Env) {
      if (isDynamicModelSelector(config.model)) return config.model(contextValue, env)
      return config.model ?? super.getModel(contextValue, env)
    }

    protected async shouldContinue(args: ContextShouldContinueArgs<Context, Env>) {
      if (config.shouldContinue) return config.shouldContinue(args)
      return true
    }
  }

  const instance = new FunctionalContext()
  return Object.assign(instance, { __config: config })
}

type AnyContextInitializer<Env extends ContextEnvironment> = (
  context: StoredContext<any>,
  env: Env,
) => Promise<any> | any

type InferContextFromInitializer<I extends AnyContextInitializer<any>> = Awaited<
  ReturnType<I>
>

type BuilderSystemPrompt<Context, Env extends ContextEnvironment> = (
  context: StoredContext<Context>,
  env: Env,
) => Promise<string> | string

type BuilderSkills<Context, Env extends ContextEnvironment> = (
  context: StoredContext<Context>,
  env: Env,
) => Promise<ContextSkillPackage[]> | ContextSkillPackage[]

type BuilderTools<Context, Env extends ContextEnvironment> = (
  context: StoredContext<Context>,
  env: Env,
) => Promise<Record<string, ContextTool>> | Record<string, ContextTool>

type BuilderExpandEvents<Context, Env extends ContextEnvironment> = (
  events: ContextItem[],
  context: StoredContext<Context>,
  env: Env,
) => Promise<ContextItem[]> | ContextItem[]

type BuilderShouldContinue<Context, Env extends ContextEnvironment> = (
  args: ContextShouldContinueArgs<Context, Env>,
) => Promise<ShouldContinue> | ShouldContinue

type BuilderModel<Context, Env extends ContextEnvironment> =
  | ContextModelInit
  | ((context: StoredContext<Context>, env: Env) => ContextModelInit)

export type RegistrableContextBuilder = {
  key: ContextKey
  register: () => void
}

type FluentContextBuilder<Context, Env extends ContextEnvironment> = {
  key: ContextKey
  expandEvents(fn: BuilderExpandEvents<Context, Env>): FluentContextBuilder<Context, Env>
  narrative(fn: BuilderSystemPrompt<Context, Env>): FluentContextBuilder<Context, Env>
  system(fn: BuilderSystemPrompt<Context, Env>): FluentContextBuilder<Context, Env>
  skills(fn: BuilderSkills<Context, Env>): FluentContextBuilder<Context, Env>
  actions(fn: BuilderTools<Context, Env>): FluentContextBuilder<Context, Env>
  tools(fn: BuilderTools<Context, Env>): FluentContextBuilder<Context, Env>
  model(model: BuilderModel<Context, Env>): FluentContextBuilder<Context, Env>
  reactor(reactor: ContextReactor<Context, Env>): FluentContextBuilder<Context, Env>
  shouldContinue(fn: BuilderShouldContinue<Context, Env>): FluentContextBuilder<Context, Env>
  opts(opts: ContextOptions<Context, Env>): FluentContextBuilder<Context, Env>
  react(
    triggerEvent: ContextItem,
    params: ContextReactParams<Env>,
  ): ReturnType<ContextEngine<Context, Env>["react"]>
  stream(
    triggerEvent: ContextItem,
    params: ContextReactParams<Env>,
  ): ReturnType<ContextEngine<Context, Env>["react"]>
  register(): void
  config(): ContextConfig<Context, Env>
  build(): ContextInstance<Context, Env>
}

type CreateContextEntry<Env extends ContextEnvironment> = {
  context<Initializer extends AnyContextInitializer<Env>>(
    initializer: Initializer,
  ): FluentContextBuilder<InferContextFromInitializer<Initializer>, Env>
  initialize<Initializer extends AnyContextInitializer<Env>>(
    initializer: Initializer,
  ): FluentContextBuilder<InferContextFromInitializer<Initializer>, Env>
}

function assertConfigComplete<Context, Env extends ContextEnvironment>(
  config: Partial<ContextConfig<Context, Env>>,
): asserts config is ContextConfig<Context, Env> {
  if (!config.context) {
    throw new Error("createContext: you must define context() before building the Context.")
  }
  if (!config.narrative) {
    throw new Error("createContext: you must define narrative() before building the Context.")
  }
  if (!config.actions && !config.tools) {
    throw new Error("createContext: you must define actions() before building the Context.")
  }
}

export function createContext<Env extends ContextEnvironment = ContextEnvironment>(
  key: ContextKey,
): CreateContextEntry<Env>

export function createContext<Env extends ContextEnvironment = ContextEnvironment>(
  key: ContextKey,
): CreateContextEntry<Env> {
  const initializeBuilder = <Initializer extends AnyContextInitializer<Env>>(
    initializer: Initializer,
  ) => {
    type Context = InferContextFromInitializer<Initializer>

    const typedInitializer: ContextConfig<Context, Env>["context"] = (ctx, env) =>
      initializer(ctx as StoredContext<Context>, env)

    const fluentState: Partial<ContextConfig<Context, Env>> = {
      context: typedInitializer,
    }

    let cached: ContextInstance<Context, Env> | null = null

    const getOrBuild = () => {
      assertConfigComplete(fluentState)
      if (!cached) {
        const config = fluentState as ContextConfig<Context, Env>
        cached = Object.assign(context(config), { __contextKey: key })
        registerContext(key, () => cached as ContextInstance<Context, Env>)
      }
      return cached
    }

    const builder: FluentContextBuilder<Context, Env> = {
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
        fluentState.narrative = system
        return builder
      },
      skills(skillsFactory) {
        fluentState.skills = skillsFactory
        return builder
      },
      actions(actionsFactory) {
        fluentState.actions = actionsFactory
        return builder
      },
      tools(toolsFactory) {
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
        return getOrBuild().react(triggerEvent, params)
      },
      stream(triggerEvent, params) {
        return builder.react(triggerEvent, params)
      },
      register() {
        getOrBuild()
      },
      config() {
        assertConfigComplete(fluentState)
        return fluentState
      },
      build() {
        return getOrBuild()
      },
    }

    return builder
  }

  return {
    context: initializeBuilder,
    initialize: initializeBuilder,
  }
}
