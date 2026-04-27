import { i } from "@instantdb/core"
import { domain } from "@ekairos/domain"
import { EkairosRuntime } from "@ekairos/domain/runtime"

import { sandboxDomain } from "../actions"
import { Sandbox } from "../sandbox"

type Env = Record<string, unknown>

const appDomain = domain("sandbox-runtime-app")
  .includes(sandboxDomain)
  .schema({ entities: {}, links: {}, rooms: {} })

const unrelatedDomain = domain("unrelated-runtime-app").schema({
  entities: {
    unrelated_items: i.entity({
      title: i.string(),
    }),
  },
  links: {},
  rooms: {},
})

class SandboxAppRuntime extends EkairosRuntime<
  Env,
  typeof appDomain,
  { runtimeCall: number }
> {
  protected getDomain() {
    return appDomain
  }

  protected resolveDb() {
    return { runtimeCall: 1 }
  }
}

class UnrelatedRuntime extends EkairosRuntime<
  Env,
  typeof unrelatedDomain,
  { runtimeCall: number }
> {
  protected getDomain() {
    return unrelatedDomain
  }

  protected resolveDb() {
    return { runtimeCall: 1 }
  }
}

const compatibleRuntime = new SandboxAppRuntime({})
const unrelatedRuntime = new UnrelatedRuntime({})

const sandbox = Sandbox.from(compatibleRuntime, {
  version: 1,
  sandboxId: "sandbox_123",
})

Sandbox.create(compatibleRuntime, { provider: "sprites" })

// @ts-expect-error runtime root domain must include sandboxDomain
Sandbox.from(unrelatedRuntime, {
  version: 1,
  sandboxId: "sandbox_123",
})

// @ts-expect-error runtime root domain must include sandboxDomain
Sandbox.create(unrelatedRuntime, { provider: "sprites" })

async function domainActionTypes() {
  const scoped = await compatibleRuntime.use(sandboxDomain)

  scoped.actions.runCommandProcess({
    sandboxId: "sandbox_123",
    command: "pwd",
  })

  // @ts-expect-error canonical domain action requires sandboxId
  scoped.actions.runCommandProcess({
    command: "pwd",
  })

  const run = await scoped.actions.runCommandProcess({
    sandboxId: "sandbox_123",
    command: "pwd",
  })
  if (run.ok) {
    run.data.processId.toUpperCase()
  }
}

sandbox.actions()[Sandbox.runCommandActionName].execute({ command: "pwd" }, {} as any)

sandbox.actions()[Sandbox.runCommandActionName].execute(
  // @ts-expect-error sandboxId is bound by the Sandbox instance
  { sandboxId: "sandbox_456", command: "pwd" },
  {} as any,
)

domainActionTypes()
