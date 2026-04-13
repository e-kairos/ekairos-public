import type { InstantAdminDatabase } from "@instantdb/admin"
import type { InstantSchemaDef } from "@instantdb/core"

export type RuntimeDomainSource = {
  toInstantSchema?: () => any
  schema?: () => any
  entities?: Record<string, unknown>
  links?: Record<string, unknown>
  rooms?: Record<string, unknown>
  context?: (options?: any) => any
  contextString?: (options?: any) => string
  fromDB?: (db: any) => any
  meta?: Record<string, unknown>
}

type SchemaForDomain<D> =
  D extends null | undefined
    ? InstantSchemaDef<any, any, any>
    : D extends { toInstantSchema: () => infer S }
      ? (S extends InstantSchemaDef<any, any, any> ? S : InstantSchemaDef<any, any, any>)
      : D extends { schema: () => infer S }
        ? (S extends InstantSchemaDef<any, any, any> ? S : InstantSchemaDef<any, any, any>)
        : D extends { entities: infer E; links: infer L; rooms: infer R }
          ? InstantSchemaDef<E & any, L & any, R & any>
          : InstantSchemaDef<any, any, any>

export type DomainDbFor<D> = InstantAdminDatabase<SchemaForDomain<D>, true>

export type RuntimeMeta<
  D extends RuntimeDomainSource | null | undefined = RuntimeDomainSource | null,
> = {
  domain?: D | null
  schema?: SchemaForDomain<D>
  context?: any
  contextString?: string
}

export type DomainRuntime<
  D extends RuntimeDomainSource | null | undefined = RuntimeDomainSource | null,
  DB = DomainDbFor<D>,
> = {
  db: DB
  meta: () => RuntimeMeta<D>
}

export type Runtime<
  D extends RuntimeDomainSource | null | undefined = RuntimeDomainSource | null,
  DB = DomainDbFor<D>,
> = DomainRuntime<D, DB>

export type RuntimeProgressState =
  | "initializing"
  | "provisioning"
  | "connecting"
  | "ready"
  | "error"

export type RuntimeProgressEvent = {
  state: RuntimeProgressState
  message?: string
  progress?: number
  details?: Record<string, unknown>
}

export type RuntimeResolveOptions = {
  onProgress?: (event: RuntimeProgressEvent) => void | Promise<void>
}

export type RuntimeResolver<
  Env extends Record<string, unknown> = Record<string, unknown>,
  D extends RuntimeDomainSource | null = RuntimeDomainSource | null,
  DB = DomainDbFor<D>,
> = (
  env: Env,
  domain?: D | null,
  options?: RuntimeResolveOptions,
) =>
  | Promise<DB | { db?: DB } | DomainRuntime<D, DB> | any>
  | DB
  | { db?: DB }
  | DomainRuntime<D, DB>
  | any

const runtimeResolverSymbol = Symbol.for("ekairos.domain.runtimeResolver")

type StoredRuntimeResolver = RuntimeResolver<
  Record<string, unknown>,
  RuntimeDomainSource | null,
  unknown
>

type RuntimeGlobalStore = typeof globalThis & {
  [runtimeResolverSymbol]?: StoredRuntimeResolver
}

function getGlobalRuntimeResolver(): StoredRuntimeResolver | null {
  if (typeof globalThis === "undefined") return null
  const store = globalThis as RuntimeGlobalStore
  return store[runtimeResolverSymbol] ?? null
}

function resolveSchema(domain?: RuntimeDomainSource | null): any {
  if (!domain) return null
  if (typeof (domain as any).instantSchema === "function") return (domain as any).instantSchema()
  if (typeof domain.toInstantSchema === "function") return domain.toInstantSchema()
  if (typeof domain.schema === "function") return domain.schema()
  return {
    entities: domain.entities ?? {},
    links: domain.links ?? {},
    rooms: domain.rooms ?? {},
  }
}

function resolveContext(domain?: RuntimeDomainSource | null): any {
  if (!domain || typeof domain.context !== "function") return null
  return domain.context()
}

function resolveContextString(domain?: RuntimeDomainSource | null): string {
  if (!domain || typeof domain.contextString !== "function") return ""
  return domain.contextString()
}

function hasDb(resolved: unknown): resolved is { db: unknown } {
  return typeof resolved === "object" && resolved !== null && "db" in resolved
}

function resolveDb(resolved: unknown): unknown | null {
  if (!resolved) return null
  if (hasDb(resolved)) {
    return resolved.db
  }
  return resolved
}

async function emitRuntimeProgress(
  options: RuntimeResolveOptions | undefined,
  event: RuntimeProgressEvent,
) {
  const notify = options?.onProgress
  if (!notify) return
  await notify(event)
}

export async function resolveRuntime<
  Env extends Record<string, unknown>,
  D extends RuntimeDomainSource | null | undefined,
  DB = DomainDbFor<D>,
>(
  domain: D,
  env: Env,
  options?: RuntimeResolveOptions,
): Promise<DomainRuntime<D, DB>> {
  const runtimeDomain = (domain ?? null) as RuntimeDomainSource | null
  if (!runtimeDomain) {
    throw new Error(
      "Runtime requires an explicit domain. Call resolveRuntime(domain, env) with a concrete app domain.",
    )
  }

  const resolver = getGlobalRuntimeResolver()
  if (!resolver) {
    throw new Error(
      [
        "Runtime is not configured.",
        "",
        "Create an app-level runtime bootstrap (by convention: src/runtime.ts)",
        "and call configureRuntime({ runtime, domain }).",
      ].join("\n"),
    )
  }

  await emitRuntimeProgress(options, {
    state: "initializing",
    progress: 5,
    message: "Preparing runtime context.",
  })

  let resolved: unknown
  try {
    const typedResolver = resolver as RuntimeResolver<
      Env,
      RuntimeDomainSource | null,
      DB
    >
    resolved = await typedResolver(env, runtimeDomain, options)
  } catch (error) {
    await emitRuntimeProgress(options, {
      state: "error",
      progress: 100,
      message: "Runtime could not be prepared.",
      details: {
        reason: error instanceof Error ? error.message : String(error),
      },
    })
    throw error
  }

  const db = resolveDb(resolved) as DB | null
  if (!db) {
    await emitRuntimeProgress(options, {
      state: "error",
      progress: 100,
      message: "Runtime database is unavailable.",
    })
    throw new Error("Runtime resolver did not return a database instance.")
  }

  await emitRuntimeProgress(options, {
    state: "connecting",
    progress: 90,
    message: "Connecting runtime database.",
  })

  const schema = resolveSchema(runtimeDomain)
  const context = resolveContext(runtimeDomain)
  const contextString = resolveContextString(runtimeDomain)
  const runtimeMeta: RuntimeMeta<D> = {
    domain: runtimeDomain as D,
    schema: schema as SchemaForDomain<D>,
    context,
    contextString,
  }

  await emitRuntimeProgress(options, {
    state: "ready",
    progress: 100,
    message: "Runtime ready.",
  })

  return {
    db,
    meta: () => runtimeMeta,
  }
}
