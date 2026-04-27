import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde"
import { ensureDomEvents } from "./polyfills/dom-events.js"

ensureDomEvents()

import type {
  DomainDbFor,
  DomainRuntime,
  RuntimeDomainSource,
  RuntimeMeta,
  RuntimeResolveOptions,
} from "./runtime-step.js"
import type {
  ActiveDomain,
  CompatibleSchemaForDomain,
  DomainSchemaResult,
  IncludedDomainNamesOf,
  SchemaOf,
} from "./index.js"
import { materializeDomain } from "./index.js"

type DomainNamesCompatible<
  RootDomain,
  RequiredDomain extends DomainSchemaResult,
> = string extends IncludedDomainNamesOf<RootDomain>
  ? true
  : string extends IncludedDomainNamesOf<RequiredDomain>
    ? true
    : Exclude<IncludedDomainNamesOf<RequiredDomain>, IncludedDomainNamesOf<RootDomain>> extends never
      ? true
      : false

type RootIncludesDomain<
  RootDomain,
  RequiredDomain extends DomainSchemaResult,
> = RootDomain extends DomainSchemaResult
  ? DomainNamesCompatible<RootDomain, RequiredDomain> extends true
    ? CompatibleSchemaForDomain<SchemaOf<RootDomain>, RequiredDomain> extends never
      ? false
      : true
    : false
  : false

type SubdomainForRoot<
  RootDomain,
  Subdomain extends DomainSchemaResult,
> = RootIncludesDomain<RootDomain, Subdomain> extends true ? Subdomain : never

type RuntimeUseForDomain<
  Env,
  RequiredDomain extends DomainSchemaResult,
> = {
  use(
    subdomain: RequiredDomain,
    options?: RuntimeResolveOptions,
  ): Promise<Omit<ActiveDomain<RequiredDomain, Env>, "env">>
}

type RuntimeEnvOf<Runtime extends EkairosRuntime<any, any, any>> =
  Runtime extends EkairosRuntime<infer Env, any, any> ? Env : never

type RuntimeRootDomainOf<Runtime extends EkairosRuntime<any, any, any>> =
  Runtime extends EkairosRuntime<any, infer RootDomain, any> ? RootDomain : never

type IsAny<T> = 0 extends (1 & T) ? true : false

type RuntimeDomainCompatibility<
  Runtime extends EkairosRuntime<any, any, any>,
  RequiredDomain extends DomainSchemaResult,
> = IsAny<Runtime> extends true
  ? unknown
  : IsAny<RuntimeRootDomainOf<Runtime>> extends true
  ? unknown
  : RootIncludesDomain<RuntimeRootDomainOf<Runtime>, RequiredDomain> extends true
    ? unknown
    : never

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

export type RuntimeLike<
  Env extends Record<string, unknown> = Record<string, unknown>,
  D extends RuntimeDomainSource | null | undefined = RuntimeDomainSource | null,
  DB = DomainDbFor<D>,
> = {
  readonly env: Env
  db(options?: RuntimeResolveOptions): Promise<DB>
  resolve(options?: RuntimeResolveOptions): Promise<DomainRuntime<D, DB>>
  meta(): RuntimeMeta<D>
}

export abstract class EkairosRuntime<
  Env extends Record<string, unknown>,
  D extends RuntimeDomainSource | null = RuntimeDomainSource | null,
  DB = DomainDbFor<D>,
> implements RuntimeLike<Env, D, DB> {
  public readonly env: Env

  constructor(env: Env) {
    this.env = env
  }

  protected static serializeRuntime(instance: EkairosRuntime<any, any, any>) {
    return { env: instance.env }
  }

  protected static deserializeRuntime(
    this: new (env: Record<string, unknown>) => any,
    data: { env: Record<string, unknown> },
  ) {
    return new this(data.env)
  }

  static [WORKFLOW_SERIALIZE](instance: EkairosRuntime<any, any, any>) {
    return this.serializeRuntime(instance)
  }

  static [WORKFLOW_DESERIALIZE](
    this: new (env: Record<string, unknown>) => any,
    data: { env: Record<string, unknown> },
  ) {
    return new this(data.env)
  }

  protected abstract getDomain(): D

  protected abstract resolveDb(
    env: Env,
    options?: RuntimeResolveOptions,
  ): Promise<DB> | DB

  public meta(): RuntimeMeta<D> {
    const domain = this.getDomain()
    return {
      domain,
      schema: resolveSchema(domain) as any,
      context: resolveContext(domain),
      contextString: resolveContextString(domain),
    }
  }

  public async db(options?: RuntimeResolveOptions): Promise<DB> {
    ensureDomEvents()
    return await this.resolveDb(this.env, options)
  }

  public async resolve(options?: RuntimeResolveOptions): Promise<DomainRuntime<D, DB>> {
    const db = await this.db(options)
    const meta = this.meta()
    return {
      db,
      meta: () => meta,
    }
  }

  public async use<SubD extends DomainSchemaResult>(
    subdomain: SubdomainForRoot<D, SubD>,
    options?: RuntimeResolveOptions,
  ): Promise<ActiveDomain<SubD, Env>> {
    const rootDomain = this.getDomain() as any
    if (!rootDomain || typeof rootDomain.fromDB !== "function") {
      throw new Error("EkairosRuntime.use requires a root DomainSchemaResult.")
    }

    const db = await this.db(options)
    return materializeDomain({
      rootDomain,
      subdomain: subdomain as any,
      db: db as any,
      bindings: {
        env: this.env,
        runtime: this,
      },
    }) as ActiveDomain<SubD, Env>
  }
}

export type ExplicitRuntimeLike<
  Env extends Record<string, unknown> = Record<string, unknown>,
  D extends RuntimeDomainSource | null | undefined = RuntimeDomainSource | null,
  DB = DomainDbFor<D>,
> = RuntimeLike<Env, D, DB>

export type RuntimeForDomain<
  Runtime extends EkairosRuntime<any, any, any>,
  RequiredDomain extends DomainSchemaResult,
> =
  & Pick<Runtime, "db" | "resolve" | "meta">
  & RuntimeUseForDomain<RuntimeEnvOf<Runtime>, RequiredDomain>
  & RuntimeDomainCompatibility<Runtime, RequiredDomain>
