import type { ActiveDomain, ConcreteDomain, DomainSchemaResult } from "@ekairos/domain"
import type { EkairosRuntime, RuntimeForDomain, RuntimeResolveOptions } from "@ekairos/domain/runtime"

import type { ContextEnvironment } from "./context.config.js"
import type { ContextStore } from "./context.store.js"
import { eventsDomain } from "./schema.js"

export type ContextRuntime<
  Env extends ContextEnvironment = ContextEnvironment,
> = EkairosRuntime<Env, any, any>

export type ContextRuntimeServiceHandle = Pick<
  ContextRuntime<any>,
  "db" | "resolve" | "meta"
>

export type ContextRuntimeHandleForDomain<
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainSchemaResult = typeof eventsDomain,
> = ContextRuntimeServiceHandle & {
  use<Subdomain extends typeof eventsDomain | RequiredDomain>(
    subdomain: Subdomain,
    options?: RuntimeResolveOptions,
  ): Promise<Omit<ActiveDomain<Subdomain, Env>, "env">>
}

export type ContextRuntimeForDomain<
  Runtime extends ContextRuntime<any>,
  RequiredDomain extends DomainSchemaResult = typeof eventsDomain,
> =
  & RuntimeForDomain<Runtime, typeof eventsDomain>
  & RuntimeForDomain<Runtime, RequiredDomain>

export type ContextRuntimeServices = {
  db: any
  store: ContextStore
  domain?: ConcreteDomain<any, any>
}

const storeByDb = new WeakMap<object, ContextStore>()

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}

export async function getContextRuntimeServices(
  runtime: ContextRuntimeServiceHandle,
): Promise<ContextRuntimeServices> {
  const db = await runtime.db()
  if (!db) {
    throw new Error("Context runtime did not provide a database instance.")
  }

  let store = typeof db === "object" && db !== null ? storeByDb.get(db as object) : undefined
  if (!store) {
    const { InstantStore } = await import("./stores/instant.store.js")
    store = new InstantStore(db)
    if (typeof db === "object" && db !== null) {
      storeByDb.set(db as object, store)
    }
  }

  const resolved = await runtime.resolve()
  const resolvedMeta = asRecord(resolved).meta
  const meta = typeof resolvedMeta === "function" ? resolvedMeta() : undefined
  const domain = asRecord(meta).domain
  return {
    db,
    store,
    domain: domain as ConcreteDomain<any, any> | undefined,
  }
}
