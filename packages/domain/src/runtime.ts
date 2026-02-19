import {
  configureDomainDocLoader,
  getDomainActionBinding,
  getDomainActions,
  type DomainActionDefinition,
  type DomainActionExecuteParams,
  type DomainDocLoader,
} from "./index.js";
import type { InstantAdminDatabase } from "@instantdb/admin";
import type { InstantSchemaDef } from "@instantdb/core";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

export type RuntimeDomainSource = {
  toInstantSchema?: () => any;
  schema?: () => any;
  entities?: Record<string, unknown>;
  links?: Record<string, unknown>;
  rooms?: Record<string, unknown>;
  context?: (options?: any) => any;
  contextString?: (options?: any) => string;
  fromDB?: (db: any) => any;
  meta?: Record<string, unknown>;
};

type SchemaForDomain<D> =
  D extends null | undefined
    ? InstantSchemaDef<any, any, any>
    : D extends { toInstantSchema: () => infer S }
      ? (S extends InstantSchemaDef<any, any, any> ? S : InstantSchemaDef<any, any, any>)
      : D extends { schema: () => infer S }
        ? (S extends InstantSchemaDef<any, any, any> ? S : InstantSchemaDef<any, any, any>)
        : D extends { entities: infer E; links: infer L; rooms: infer R }
          ? InstantSchemaDef<E & any, L & any, R & any>
          : InstantSchemaDef<any, any, any>;

export type DomainDbFor<D> = InstantAdminDatabase<SchemaForDomain<D>, true>;

export type RuntimeMeta<
  D extends RuntimeDomainSource | null | undefined = RuntimeDomainSource | null
> = {
  domain?: D | null;
  schema?: SchemaForDomain<D>;
  context?: any;
  contextString?: string;
};

export type DomainRuntime<
  D extends RuntimeDomainSource | null | undefined = RuntimeDomainSource | null,
  DB = DomainDbFor<D>
> = {
  db: DB;
  meta: () => RuntimeMeta<D>;
};

export type Runtime<
  D extends RuntimeDomainSource | null | undefined = RuntimeDomainSource | null,
  DB = DomainDbFor<D>
> = DomainRuntime<D, DB>;

export type RuntimeProgressState =
  | "initializing"
  | "provisioning"
  | "connecting"
  | "ready"
  | "error";

export type RuntimeProgressEvent = {
  state: RuntimeProgressState;
  message?: string;
  progress?: number;
  details?: Record<string, unknown>;
};

export type RuntimeResolveOptions = {
  onProgress?: (event: RuntimeProgressEvent) => void | Promise<void>;
};

export type RegistrableThread = {
  key?: string;
  register: () => void;
};

export type RuntimeResolver<
  Env extends Record<string, unknown> = Record<string, unknown>,
  D extends RuntimeDomainSource | null = RuntimeDomainSource | null,
  DB = DomainDbFor<D>
> = (
  env: Env,
  domain?: D | null,
  options?: RuntimeResolveOptions
) =>
  | Promise<DB | { db?: DB } | DomainRuntime<D, DB> | any>
  | DB
  | { db?: DB }
  | DomainRuntime<D, DB>
  | any;

export type RuntimeMcpAuthContext = {
  token?: string;
  orgId?: string;
  userId?: string;
  apiKeyId?: string;
  scopes?: string[];
  isAdmin?: boolean;
  [key: string]: unknown;
};

export type RuntimeMcpConfig = {
  required?: boolean;
  resolveAuth?: (input: {
    req: unknown;
    token?: string | null;
  }) => Promise<RuntimeMcpAuthContext | null> | RuntimeMcpAuthContext | null;
};

export type RuntimeDomainAction<
  Env extends Record<string, unknown> = Record<string, unknown>,
  Input = unknown,
  Output = unknown,
  Runtime = unknown,
> = DomainActionDefinition<Env, Input, Output, Runtime> & {
  name: string;
  domain?: RuntimeDomainSource | null;
};

export type RuntimeDomainActionCollection<
  Env extends Record<string, unknown> = Record<string, unknown>,
> =
  | RuntimeDomainAction<Env, any, any, any>[]
  | Record<string, RuntimeDomainAction<Env, any, any, any> | ((params: DomainActionExecuteParams<Env, any, any>) => unknown)>;

export type RuntimeDomainConfig = {
  // Root domain for the app (single domain).
  domain?: RuntimeDomainSource;
  // Optional metadata (description, version, etc.).
  meta?: Record<string, unknown>;
  // Optional MCP auth configuration.
  mcp?: RuntimeMcpConfig;
  // Optional explicit actions (in addition to domain.actions()).
  actions?: RuntimeDomainActionCollection;
};

export type RuntimeConfig<Env extends Record<string, unknown> = Record<string, unknown>> = {
  threads: RegistrableThread[];
  runtime?: RuntimeResolver<Env>;
  domain?: RuntimeDomainConfig;
  setup: () => void;
};

let runtimeDomainConfig: RuntimeDomainConfig | null = null;
let docLoaderConfigured = false;
let runtimeProjectId: string | null = null;

const runtimeResolverSymbol = Symbol.for("ekairos.domain.runtimeResolver");
type StoredRuntimeResolver = RuntimeResolver<Record<string, unknown>, RuntimeDomainSource | null, unknown>;
type RuntimeGlobalStore = typeof globalThis & {
  [runtimeResolverSymbol]?: StoredRuntimeResolver;
};
let runtimeResolver: StoredRuntimeResolver | null = null;

function getGlobalRuntimeResolver(): StoredRuntimeResolver | null {
  if (typeof globalThis === "undefined") return null;
  const store = globalThis as RuntimeGlobalStore;
  return store[runtimeResolverSymbol] ?? null;
}

function setGlobalRuntimeResolver(resolver: StoredRuntimeResolver | null) {
  if (typeof globalThis === "undefined") return;
  const store = globalThis as RuntimeGlobalStore;
  store[runtimeResolverSymbol] = resolver ?? undefined;
}

function configureRuntimeResolver(resolver?: StoredRuntimeResolver | null) {
  runtimeResolver = resolver ?? null;
  setGlobalRuntimeResolver(runtimeResolver);
}

function getRuntimeResolver(): StoredRuntimeResolver | null {
  return runtimeResolver ?? getGlobalRuntimeResolver();
}

function ensureDomainDocLoader() {
  if (docLoaderConfigured) return;
  if (typeof process === "undefined" || !process.versions?.node) return;
  const cache = new Map<string, { doc: string; docPath?: string } | null>();

  const readDoc = (absPath: string) => {
    if (cache.has(absPath)) return cache.get(absPath) ?? null;
    if (!existsSync(absPath)) {
      cache.set(absPath, null);
      return null;
    }
    try {
      const doc = readFileSync(absPath, "utf8");
      const rel = relative(process.cwd(), absPath);
      const info = { doc, docPath: rel };
      cache.set(absPath, info);
      return info;
    } catch {
      cache.set(absPath, null);
      return null;
    }
  };

  const readDocFromRoot = (rootDir: string) => {
    const absRoot = isAbsolute(rootDir) ? rootDir : resolve(process.cwd(), rootDir);
    return readDoc(join(absRoot, "DOMAIN.md"));
  };

  const readDocFromPackage = (packageName: string) => {
    const normalizedName = String(packageName || "").trim();
    if (!normalizedName) return null;

    const packageSegments = normalizedName
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean);
    if (packageSegments.length === 0) return null;

    const cwd = process.cwd();
    const ekairosPrefix = "@ekairos/";
    const inferredWorkspaceName = normalizedName.startsWith(ekairosPrefix)
      ? normalizedName.slice(ekairosPrefix.length).trim()
      : "";

    const candidates = new Set<string>([
      join(cwd, "node_modules", ...packageSegments, "DOMAIN.md"),
      join(cwd, "..", "node_modules", ...packageSegments, "DOMAIN.md"),
      join(cwd, "..", "..", "node_modules", ...packageSegments, "DOMAIN.md"),
    ]);

    if (inferredWorkspaceName) {
      candidates.add(join(cwd, "packages", inferredWorkspaceName, "DOMAIN.md"));
      candidates.add(join(cwd, "..", "packages", inferredWorkspaceName, "DOMAIN.md"));
      candidates.add(join(cwd, "..", "..", "packages", inferredWorkspaceName, "DOMAIN.md"));
    }

    for (const candidate of candidates) {
      const resolvedCandidate = resolve(candidate);
      const fromPath = readDoc(resolvedCandidate);
      if (fromPath) return fromPath;
    }

    return null;
  };

  const loader: DomainDocLoader = ({ scope, meta }) => {
    if (scope === "root") {
      return readDoc(join(process.cwd(), "DOMAIN.md"));
    }
    if (meta?.rootDir) {
      const fromRoot = readDocFromRoot(meta.rootDir);
      if (fromRoot) return fromRoot;
    }
    if (meta?.packageName) {
      const fromPackage = readDocFromPackage(meta.packageName);
      if (fromPackage) return fromPackage;
    }
    if (meta?.name) {
      const inferred = readDocFromPackage(`@ekairos/${meta.name}`);
      if (inferred) return inferred;
    }
    return null;
  };

  configureDomainDocLoader(loader);
  docLoaderConfigured = true;
}

function normalizeProjectId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function resolveProjectIdFromEnv(): string {
  if (typeof process === "undefined" || !process.env) return "";
  return normalizeProjectId(process.env.EKAIROS_PROJECT_ID);
}

function resolveSchema(domain?: RuntimeDomainSource | null): any {
  if (!domain) return null;
  if (typeof domain.toInstantSchema === "function") return domain.toInstantSchema();
  if (typeof domain.schema === "function") return domain.schema();
  return {
    entities: domain.entities ?? {},
    links: domain.links ?? {},
    rooms: domain.rooms ?? {},
  };
}

function resolveContext(domain?: RuntimeDomainSource | null): any {
  if (!domain || typeof domain.context !== "function") return null;
  return domain.context();
}

function resolveContextString(domain?: RuntimeDomainSource | null): string {
  if (!domain || typeof domain.contextString !== "function") return "";
  return domain.contextString();
}

function hasDb(resolved: unknown): resolved is { db: unknown } {
  return typeof resolved === "object" && resolved !== null && "db" in resolved;
}

function resolveDb(resolved: unknown): unknown | null {
  if (!resolved) return null;
  if (hasDb(resolved)) {
    return resolved.db;
  }
  return resolved;
}

function normalizeAction(
  actionInput:
    | RuntimeDomainAction<any, any, any, any>
    | ((params: DomainActionExecuteParams<any, any, any>) => unknown),
  params: { key?: string; defaultDomain?: RuntimeDomainSource | null },
): RuntimeDomainAction<any, any, any, any> {
  const action =
    typeof actionInput === "function"
      ? ({ execute: actionInput } as RuntimeDomainAction<any, any, any, any>)
      : actionInput;

  if (!action || typeof action !== "object" || typeof action.execute !== "function") {
    throw new Error("invalid_runtime_action");
  }

  const bound = getDomainActionBinding(action);
  const explicitName = typeof action.name === "string" ? action.name.trim() : "";
  const derivedName = bound?.name ?? "";
  const keyName = typeof params.key === "string" ? params.key.trim() : "";
  const name = explicitName || derivedName || keyName;
  if (!name) {
    throw new Error("runtime_action_name_required");
  }

  const domainFromBinding = (bound?.domain ?? null) as RuntimeDomainSource | null;
  const domain = domainFromBinding || action.domain || params.defaultDomain || null;

  return {
    ...action,
    name,
    ...(domain ? { domain } : {}),
  };
}

function normalizeActionCollection(
  input: RuntimeDomainActionCollection | undefined,
  defaultDomain?: RuntimeDomainSource | null,
): RuntimeDomainAction<any, any, any, any>[] {
  if (!input) return [];
  const out: RuntimeDomainAction<any, any, any, any>[] = [];
  const seen = new Set<string>();

  const push = (action: RuntimeDomainAction<any, any, any, any>) => {
    if (seen.has(action.name)) {
      throw new Error(`duplicate_runtime_action:${action.name}`);
    }
    seen.add(action.name);
    out.push(action);
  };

  if (Array.isArray(input)) {
    for (const actionInput of input) {
      push(normalizeAction(actionInput as RuntimeDomainAction<any, any, any, any>, { defaultDomain }));
    }
    return out;
  }

  for (const [key, actionInput] of Object.entries(input)) {
    push(normalizeAction(actionInput as RuntimeDomainAction<any, any, any, any>, { key, defaultDomain }));
  }
  return out;
}

function resolveRuntimeActionsFromConfig(config: RuntimeDomainConfig | null): RuntimeDomainAction<any, any, any, any>[] {
  if (!config) return [];
  const out: RuntimeDomainAction<any, any, any, any>[] = [];
  const seen = new Set<string>();

  const push = (action: RuntimeDomainAction<any, any, any, any>) => {
    if (seen.has(action.name)) {
      throw new Error(`duplicate_runtime_action:${action.name}`);
    }
    seen.add(action.name);
    out.push(action);
  };

  const domainActions = getDomainActions(config.domain);
  for (const action of domainActions) {
    push(
      normalizeAction(action as RuntimeDomainAction<any, any, any, any>, {
        defaultDomain: config.domain ?? null,
      }),
    );
  }

  const explicit = normalizeActionCollection(config.actions, config.domain ?? null);
  for (const action of explicit) {
    push(action);
  }
  return out;
}

async function emitRuntimeProgress(
  options: RuntimeResolveOptions | undefined,
  event: RuntimeProgressEvent
) {
  const notify = options?.onProgress;
  if (!notify) return;
  await notify(event);
}

export function configureRuntime<Env extends Record<string, unknown>>(params: {
  runtime?: RuntimeResolver<Env>;
  threads?: RegistrableThread[];
  domain?: RuntimeDomainConfig;
}): RuntimeConfig<Env> {
  const threads = params.threads ?? [];
  const domainConfig = params.domain;

  let didSetup = false;

  const config: RuntimeConfig<Env> = {
    threads,
    runtime: params.runtime,
    domain: domainConfig,
    setup() {
      if (didSetup) return;
      didSetup = true;

      runtimeDomainConfig = domainConfig ?? null;
      resolveRuntimeActionsFromConfig(runtimeDomainConfig);
      ensureDomainDocLoader();

      if (params.runtime) {
        configureRuntimeResolver(
          params.runtime as unknown as StoredRuntimeResolver
        );
      }

      const envProjectId = resolveProjectIdFromEnv();
      if (envProjectId) runtimeProjectId = envProjectId;

      for (const thread of threads) {
        if (thread && typeof thread.register === "function") {
          thread.register();
        }
      }
    },
  };

  config.setup();
  return config;
}

export function getRuntimeConfig(): RuntimeDomainConfig | null {
  return runtimeDomainConfig;
}

export function getRuntimeProjectId(): string {
  return runtimeProjectId ?? resolveProjectIdFromEnv();
}

export function getRuntimeActions(): RuntimeDomainAction<any, any, any, any>[] {
  return resolveRuntimeActionsFromConfig(runtimeDomainConfig);
}

export function getRuntimeAction(name: string): RuntimeDomainAction<any, any, any, any> | null {
  const normalized = String(name ?? "").trim();
  if (!normalized) return null;
  const actions = getRuntimeActions();
  return actions.find((action) => action.name === normalized) ?? null;
}

type ExecuteRuntimeActionParams<
  Env extends Record<string, unknown>,
  Input,
  Output,
  Runtime,
> = {
  action: RuntimeDomainAction<Env, Input, Output, Runtime> | string;
  env: Env;
  input: Input;
  options?: RuntimeResolveOptions;
  _stack?: string[];
};

export async function executeRuntimeAction<
  Env extends Record<string, unknown> = Record<string, unknown>,
  Input = unknown,
  Output = unknown,
  Runtime = unknown,
>(params: ExecuteRuntimeActionParams<Env, Input, Output, Runtime>): Promise<Output> {
  const action =
    typeof params.action === "string"
      ? (getRuntimeAction(params.action) as RuntimeDomainAction<Env, Input, Output, Runtime> | null)
      : params.action;
  if (!action) {
    throw new Error(
      typeof params.action === "string"
        ? `runtime_action_not_found:${params.action}`
        : "runtime_action_not_found",
    );
  }

  const actionName = String(action.name || "").trim();
  if (!actionName) {
    throw new Error("runtime_action_name_required");
  }

  const stack = Array.isArray(params._stack) ? params._stack : [];
  if (stack.includes(actionName)) {
    throw new Error(`runtime_action_cycle:${actionName}`);
  }

  const domain = action.domain ?? runtimeDomainConfig?.domain ?? null;
  if (!domain) {
    throw new Error(`runtime_action_domain_required:${actionName}`);
  }

  const runtime = (await resolveRuntime(domain as any, params.env, params.options)) as unknown as Runtime;
  const call = async <NestedInput = unknown, NestedOutput = unknown>(
    nestedAction: DomainActionDefinition<Env, NestedInput, NestedOutput, Runtime>,
    nestedInput: NestedInput,
  ) => {
    return (await executeRuntimeAction({
      action: nestedAction as RuntimeDomainAction<Env, NestedInput, NestedOutput, Runtime>,
      env: params.env,
      input: nestedInput,
      options: params.options,
      _stack: [...stack, actionName],
    })) as NestedOutput;
  };

  const output = await action.execute({
    env: params.env,
    input: params.input,
    runtime,
    call,
  } as DomainActionExecuteParams<Env, Input, Runtime>);
  return output as Output;
}

export async function resolveRuntime<
  Env extends Record<string, unknown>,
  D extends RuntimeDomainSource | null | undefined,
  DB = DomainDbFor<D>
>(
  domain: D,
  env: Env,
  options?: RuntimeResolveOptions
): Promise<DomainRuntime<D, DB>> {
  const runtimeDomain = (domain ?? null) as RuntimeDomainSource | null;
  if (!runtimeDomain) {
    throw new Error(
      "Runtime requires an explicit domain. Call resolveRuntime(domain, env) with a concrete app domain."
    );
  }

  const resolver = getRuntimeResolver();
  if (!resolver) {
    throw new Error(
      [
        "Runtime is not configured.",
        "",
        "Create an app-level runtime bootstrap (by convention: src/runtime.ts)",
        "and call configureRuntime({ runtime, domain }).",
      ].join("\n")
    );
  }

  await emitRuntimeProgress(options, {
    state: "initializing",
    progress: 5,
    message: "Preparing runtime context.",
  });

  let resolved: unknown;
  try {
    const typedResolver = resolver as RuntimeResolver<Env, RuntimeDomainSource | null, DB>;
    resolved = await typedResolver(env, runtimeDomain, options);
  } catch (error) {
    await emitRuntimeProgress(options, {
      state: "error",
      progress: 100,
      message: "Runtime could not be prepared.",
      details: {
        reason: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }

  const db = resolveDb(resolved) as DB | null;
  if (!db) {
    await emitRuntimeProgress(options, {
      state: "error",
      progress: 100,
      message: "Runtime database is unavailable.",
    });
    throw new Error("Runtime resolver did not return a database instance.");
  }

  await emitRuntimeProgress(options, {
    state: "connecting",
    progress: 90,
    message: "Connecting runtime database.",
  });

  const schema = resolveSchema(runtimeDomain);
  const context = resolveContext(runtimeDomain);
  const contextString = resolveContextString(runtimeDomain);
  const runtimeMeta: RuntimeMeta<D> = {
    domain: runtimeDomain as D,
    schema: schema as SchemaForDomain<D>,
    context,
    contextString,
  };

  await emitRuntimeProgress(options, {
    state: "ready",
    progress: 100,
    message: "Runtime ready.",
  });

  return {
    db,
    meta: () => runtimeMeta,
  };
}

export const runtime = resolveRuntime;
