import { i } from "@instantdb/core"
import { domain, EkairosRuntime } from "@ekairos/domain"
import { z } from "zod"

import {
  defineAction,
  createContext,
  eventsDomain,
  type ContextItem,
  type ContextToolExecuteContext,
} from "../index"

type Env = {
  actorId: string
}

type Db = {
  runtimeCall: number
}

const trigger: ContextItem = {
  id: "trigger_1",
  type: "input",
  channel: "web",
  createdAt: new Date().toISOString(),
  content: {
    parts: [{ type: "text", text: "hello" }],
  },
}

// given: a business domain required by the context engine story.
const workspaceDomain = domain("context-runtime-workspace").schema({
  entities: {
    context_runtime_workspace_items: i.entity({
      title: i.string(),
    }),
  },
  links: {},
  rooms: {},
})

// given: another domain with the same schema shape but a different domain name.
const sameSchemaDifferentDomain = domain("context-runtime-other-workspace").schema({
  entities: {
    context_runtime_workspace_items: i.entity({
      title: i.string(),
    }),
  },
  links: {},
  rooms: {},
})

// given: an app runtime root that explicitly includes both the Events
// infrastructure domain and the business domain.
const compatibleAppDomain = domain("context-runtime-compatible-app")
  .includes(eventsDomain)
  .includes(workspaceDomain)
  .schema({ entities: {}, links: {}, rooms: {} })

// given: a parent domain that includes the required business domain
// transitively. Passing this runtime to a context that asks for the child
// domain must be accepted.
const parentBusinessDomain = domain("context-runtime-parent-business")
  .includes(workspaceDomain)
  .schema({
    entities: {
      context_runtime_parent_items: i.entity({
        title: i.string(),
      }),
    },
    links: {},
    rooms: {},
  })

const transitiveCompatibleAppDomain = domain("context-runtime-transitive-app")
  .includes(eventsDomain)
  .includes(parentBusinessDomain)
  .schema({ entities: {}, links: {}, rooms: {} })

const eventsOnlyDomain = domain("context-runtime-events-only-app")
  .includes(eventsDomain)
  .schema({ entities: {}, links: {}, rooms: {} })

const businessOnlyDomain = domain("context-runtime-business-only-app")
  .includes(workspaceDomain)
  .schema({ entities: {}, links: {}, rooms: {} })

const wrongBusinessDomain = domain("context-runtime-wrong-business-app")
  .includes(eventsDomain)
  .includes(sameSchemaDifferentDomain)
  .schema({ entities: {}, links: {}, rooms: {} })

class CompatibleRuntime extends EkairosRuntime<Env, typeof compatibleAppDomain, Db> {
  protected getDomain() {
    return compatibleAppDomain
  }

  protected resolveDb() {
    return { runtimeCall: 1 }
  }
}

class TransitiveCompatibleRuntime extends EkairosRuntime<
  Env,
  typeof transitiveCompatibleAppDomain,
  Db
> {
  protected getDomain() {
    return transitiveCompatibleAppDomain
  }

  protected resolveDb() {
    return { runtimeCall: 2 }
  }
}

class EventsOnlyRuntime extends EkairosRuntime<Env, typeof eventsOnlyDomain, Db> {
  protected getDomain() {
    return eventsOnlyDomain
  }

  protected resolveDb() {
    return { runtimeCall: 3 }
  }
}

class BusinessOnlyRuntime extends EkairosRuntime<Env, typeof businessOnlyDomain, Db> {
  protected getDomain() {
    return businessOnlyDomain
  }

  protected resolveDb() {
    return { runtimeCall: 4 }
  }
}

class WrongBusinessRuntime extends EkairosRuntime<Env, typeof wrongBusinessDomain, Db> {
  protected getDomain() {
    return wrongBusinessDomain
  }

  protected resolveDb() {
    return { runtimeCall: 5 }
  }
}

const compatibleRuntime = new CompatibleRuntime({ actorId: "actor_1" })
const transitiveRuntime = new TransitiveCompatibleRuntime({ actorId: "actor_2" })
const eventsOnlyRuntime = new EventsOnlyRuntime({ actorId: "actor_3" })
const businessOnlyRuntime = new BusinessOnlyRuntime({ actorId: "actor_4" })
const wrongBusinessRuntime = new WrongBusinessRuntime({ actorId: "actor_5" })

const workspaceActionInputSchema = z.object({}).strict()
const workspaceActionOutputSchema = z.object({ ok: z.literal(true) }).strict()

async function executeWorkspaceAction({
  runtime,
}: ContextToolExecuteContext<
    { actorId: string },
    Env,
    typeof workspaceDomain,
    CompatibleRuntime
  > & { input: Record<string, never> }) {
  // when: action code uses the runtime scoped to the declared business domain.
  const scoped = await runtime.use(workspaceDomain)

  // then: the scoped domain exposes domain services without leaking env.
  scoped.db satisfies Db
  // @ts-expect-error scoped runtime handles must not expose env.
  scoped.env
  return { ok: true as const }
}

const workspaceContext = createContext<Env, typeof workspaceDomain>(
  workspaceDomain,
  "context.runtime.workspace",
)
  .context((stored, env) => ({
    actorId: String(env.actorId),
    content: stored.content,
  }))
  .narrative(() => "Runtime domain type test.")
  .actions(() => ({
    inspect_workspace: defineAction({
      input: workspaceActionInputSchema,
      output: workspaceActionOutputSchema,
      execute: executeWorkspaceAction,
    }),
  }))
  .build()

// when: the runtime root includes eventsDomain and the required business domain.
workspaceContext.react(trigger, {
  runtime: compatibleRuntime,
  durable: false,
})

// then: transitive domain inclusion is also accepted, because the parent
// business domain contains the requested child domain.
workspaceContext.react(trigger, {
  runtime: transitiveRuntime,
  durable: false,
})

// then: a runtime with only eventsDomain is rejected because it cannot satisfy
// the business domain declared by createContext(...).
workspaceContext.react(trigger, {
  // @ts-expect-error runtime root domain must include workspaceDomain
  runtime: eventsOnlyRuntime,
  durable: false,
})

// then: a runtime with only the business domain is rejected because the Context
// Engine also needs eventsDomain for persistence.
workspaceContext.react(trigger, {
  // @ts-expect-error runtime root domain must include eventsDomain
  runtime: businessOnlyRuntime,
  durable: false,
})

// then: matching schema alone is rejected when the domain name differs.
workspaceContext.react(trigger, {
  // @ts-expect-error runtime compatibility is domain name plus schema, not schema only
  runtime: wrongBusinessRuntime,
  durable: false,
})

const eventsContext = createContext<Env>("context.runtime.events-only")
  .context((stored, env) => ({
    actorId: env.actorId,
    content: stored.content,
  }))
  .narrative(() => "Events-only runtime type test.")
  .actions(() => ({}))
  .build()

// then: the key-only overload remains an events-domain context.
eventsContext.react(trigger, {
  runtime: eventsOnlyRuntime,
  durable: false,
})

const inferredDomainContext = createContext(
  workspaceDomain,
  "context.runtime.workspace.inferred",
)
  .context((stored) => ({
    content: stored.content,
  }))
  .narrative(() => "Inferred domain runtime type test.")
  .actions(() => ({}))
  .build()

// then: createContext(domain, key) infers the required domain even without
// explicit type arguments.
inferredDomainContext.react(trigger, {
  runtime: compatibleRuntime,
  durable: false,
})

inferredDomainContext.react(trigger, {
  // @ts-expect-error inferred domain still requires workspaceDomain
  runtime: eventsOnlyRuntime,
  durable: false,
})
