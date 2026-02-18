import { i } from "@instantdb/core";
import type { EntitiesDef, LinksDef, RoomsDef, InstantSchemaDef, EntityDef } from "@instantdb/core";
import {
  filterDomainDoc,
  parseDomainDoc,
  renderDomainDoc,
} from "./domain-doc.js";

export {
  parseDomainDoc,
  renderDomainDoc,
  filterDomainDoc,
  type DomainDoc,
  type DomainDocEntity,
  type DomainDocSubdomain,
  type DomainDocSection,
  type DomainDocFilter,
  type DomainDocRenderOptions,
  type ParsedDomainDoc,
} from "./domain-doc.js";

type DomainIncludeRef = () => unknown;

type DomainMeta = {
  name?: string;
  rootDir?: string;
  packageName?: string;
  includes: DomainIncludeRef[];
};

export type DomainConstructorOptions = {
  name?: string;
  rootDir?: string;
  packageName?: string;
};

export type DomainDocInfo = {
  doc: string;
  docPath?: string;
};

export type DomainDocLoader = (input: {
  scope: "root" | "subdomain";
  meta?: DomainMeta | null;
}) => DomainDocInfo | null;

export type DomainInclude =
  | DomainInstance<any, any, any>
  | DomainSchemaResult<any, any, any>
  | InstantSchemaDef<any, any, any>
  | (() => DomainInstance<any, any, any> | DomainSchemaResult<any, any, any> | InstantSchemaDef<any, any, any> | undefined)
  | undefined;

export type DomainActionExecuteParams<
  Env extends Record<string, unknown> = Record<string, unknown>,
  Input = unknown,
  Runtime = unknown,
> = {
  env: Env;
  input: Input;
  runtime: Runtime;
  call: <NestedInput = unknown, NestedOutput = unknown>(
    action: DomainActionDefinition<Env, NestedInput, NestedOutput, Runtime>,
    input: NestedInput,
  ) => Promise<NestedOutput>;
};

export type DomainActionDefinition<
  Env extends Record<string, unknown> = Record<string, unknown>,
  Input = unknown,
  Output = unknown,
  Runtime = unknown,
> = {
  name?: string;
  description?: string;
  inputSchema?: unknown;
  requiredScopes?: string[];
  execute: (
    params: DomainActionExecuteParams<Env, Input, Runtime>,
  ) => Promise<Output> | Output;
};

export type DomainActionRegistration = DomainActionDefinition<any, any, any, any> & {
  name: string;
};

export type DomainActionLike =
  | DomainActionDefinition<any, any, any, any>
  | ((params: DomainActionExecuteParams<any, any, any>) => unknown);

export type DomainActionCollection =
  | Record<string, DomainActionLike>
  | DomainActionLike[]
  | DomainActionRegistration[];

let domainDocLoader: DomainDocLoader | null = null;

export function configureDomainDocLoader(loader?: DomainDocLoader | null) {
  domainDocLoader = loader ?? null;
}

export type DomainContextEntry = {
  name?: string;
  includes?: string[];
  entities?: string[];
  links?: string[];
  rooms?: string[];
  schema?: unknown;
  doc?: string | null;
  docPath?: string | null;
};

export type DomainContext = DomainContextEntry & {
  meta?: Record<string, unknown>;
  registry: DomainContextEntry[];
};

export type DomainContextOptions = {
  meta?: Record<string, unknown>;
  includeSchemas?: boolean;
};

const EKAIROS_META = Symbol.for("@ekairos/domain/meta");
const EKAIROS_ACTIONS = Symbol.for("@ekairos/domain/actions");
const EKAIROS_ACTION_BINDING = Symbol.for("@ekairos/domain/action-binding");

// No hard-coded base entities here. InstantDB adds base entities at runtime inside i.schema.
// We only add them at the TYPE level via WithBase<> so links can reference them.

export type DomainDefinition<E extends EntitiesDef, L extends LinksDef<E>, R extends RoomsDef> = DomainConstructorOptions & {
  entities: E;
  links: L;
  rooms: R;
};

export type DomainInstance<E extends EntitiesDef, L extends LinksDef<E>, R extends RoomsDef> = DomainDefinition<E, L, R> & {
  schema: () => any;
  compose: <E2 extends EntitiesDef, L2 extends LinksDef<E2>, R2 extends RoomsDef>(
    other: DomainInstance<E2, L2, R2> | DomainDefinition<E2, L2, R2>
  ) => DomainInstance<E & E2, LinksDef<E & E2>, R & R2>;
  meta?: Record<string, unknown>;
};

export type SchemaOf<D extends DomainDefinition<any, any, any> | DomainSchemaResult<any, any, any>> =
  D extends DomainSchemaResult<any, any, any>
    ? ReturnType<D["toInstantSchema"]>
    : InstantSchemaDef<D["entities"], LinksDef<D["entities"]>, D["rooms"]>;

// --- Schema compatibility helpers for domain composition ---

type EntitiesOf<S> =
  S extends InstantSchemaDef<infer E, any, any> ? E : never;

type LinksOf<S> =
  S extends InstantSchemaDef<any, infer L, any> ? L : never;

/**
 * Verifies that Full schema includes all entities and links from Required schema.
 * Returns Full if compatible, never otherwise.
 */
type EnsureIncludesSchema<
  Full extends InstantSchemaDef<any, any, any>,
  Required extends InstantSchemaDef<any, any, any>
> =
  // Check entities: Full must contain all entities from Required with compatible types
  {
    [K in keyof EntitiesOf<Required>]:
      K extends keyof EntitiesOf<Full>
        ? (EntitiesOf<Full>[K] extends EntitiesOf<Required>[K] ? unknown : never)
        : never
  }[keyof EntitiesOf<Required>] extends never
    ? (
        // Check links: Full must contain all links from Required with compatible types
        {
          [K in keyof LinksOf<Required>]:
            K extends keyof LinksOf<Full>
              ? (LinksOf<Full>[K] extends LinksOf<Required>[K] ? unknown : never)
              : never
        }[keyof LinksOf<Required>] extends never
          ? Full
          : never
      )
    : never;


/**
 * Schema S restricted to be compatible with RequiredDomain.
 * Returns S if compatible, never otherwise.
 * 
 * This is a generic helper that works with any database type wrapper.
 * Consumers should wrap it with their specific DB type (e.g., InstantAdminDatabase).
 * 
 * Usage in @ekairos/thread:
 * ```ts
 * import type { InstantAdminDatabase } from "@instantdb/admin";
 * 
 * export function createAgent<S extends InstantSchemaDef<any, any, any>>(
 *   db: InstantAdminDatabase<CompatibleSchemaForDomain<S, typeof threadDomain>>
 * ): CreateAgentEntry
 * ```
 */
export type CompatibleSchemaForDomain<
  S extends InstantSchemaDef<any, any, any>,
  RequiredDomain extends DomainDefinition<any, any, any> | DomainSchemaResult<any, any, any> | DomainInstance<any, any, any>
> = EnsureIncludesSchema<S, SchemaOf<RequiredDomain>>;

// Utility types for extracting from domain definitions/instances
type ExtractEntities<T> = T extends { entities: infer E } ? E extends EntitiesDef ? E : never : never;
type ExtractLinks<T> = T extends { links: infer L } ? L extends LinksDef<any> ? L : never : never;
type ExtractRooms<T> = T extends { rooms: infer R } ? R extends RoomsDef ? R : never : never;

type Simplify<T> = { [K in keyof T]: T[K] } & {};

// Strip link metadata from entity definitions to avoid nested EntityDef links
type StripEntityLinks<E extends EntitiesDef> = {
  [K in keyof E]: E[K] extends EntityDef<infer Attrs, any, infer AsType>
    ? EntityDef<Attrs, {}, AsType>
    : E[K];
};

// Merge entities from multiple sources (flatten + strip nested links)
type MergeEntities<A extends EntitiesDef, B extends EntitiesDef> = Simplify<{
  [K in keyof A | keyof B]: K extends keyof B
    ? StripEntityLinks<B>[K]
    : K extends keyof A
      ? StripEntityLinks<A>[K]
      : never;
}>;

// Merge links while preserving literal keys from both sides
type MergeLinks<A extends LinksDef<any>, B extends LinksDef<any>> = Simplify<{
  [K in keyof A | keyof B]: K extends keyof A
    ? A[K]
    : K extends keyof B
      ? B[K]
      : never;
}>;

// Permissive links type that preserves literal keys but doesn't validate entity references
// This allows links to reference entities that will be available after includes ($users, cross-domain entities)
type PermissiveLinksDef = Record<string, {
  forward: { on: string; has: "one" | "many"; label: string };
  reverse: { on: string; has: "one" | "many"; label: string };
}>;

// Simple type to represent entity names for basic validation
type EntityNames<T> = T extends Record<string, any> ? keyof T : never;

// Result of domain.schema() with toInstantSchema method
// L represents the merged links (current domain + included domains) with literal keys preserved
// This type preserves both:
// 1. Full compatibility with InstantDB's schema type for InstaQLParams validation (enriched entities)
// 2. Original entities (E) accessible via originalEntities property for type safety
// The key is that DomainSchemaResult extends InstantDB's schema type completely,
// so typeof domain works with InstaQLParams and validates queries correctly (like InstantDB does)
// InstaQLParams uses the enriched entities from the schema to validate link names in queries
export type DomainSchemaResult<E extends EntitiesDef = EntitiesDef, L extends LinksDef<any> = LinksDef<any>, R extends RoomsDef = RoomsDef> = 
  ReturnType<typeof i.schema<WithBase<E>, L, R>> & {
    // Add originalEntities property for type-safe access to original entity definitions
    // This preserves type safety while InstaQLParams uses enriched entities for validation
    readonly originalEntities: E;
    // Ensure toInstantSchema method is available
    toInstantSchema: () => ReturnType<typeof i.schema<WithBase<E>, L, R>>;
    // Build full domain context (schema + registry + docs) for AI/system prompts.
    context: (options?: DomainContextOptions) => DomainContext;
    // Render a prompt-friendly context string for AI system prompts.
    contextString: (options?: DomainContextOptions) => string;
    // Bind a concrete database to this domain for runtime usage.
    fromDB: <DB = any>(db: DB) => ConcreteDomain<DomainSchemaResult<E, L, R>, DB>;
    // Optional metadata for this domain.
    meta?: Record<string, unknown>;
    // Attach explicit domain actions to this domain result.
    actions: (actions: DomainActionCollection) => DomainSchemaResult<E, L, R>;
    // Retrieve actions explicitly attached to this domain result.
    getActions: () => DomainActionRegistration[];
  };

export type ConcreteDomain<D extends DomainSchemaResult = DomainSchemaResult, DB = any> = {
  domain: D;
  db: DB;
  schema: ReturnType<D["toInstantSchema"]>;
  context: (options?: DomainContextOptions) => DomainContext;
  contextString: (options?: DomainContextOptions) => string;
  fromDomain: <SubD extends DomainSchemaResult>(subdomain: SubD) => ConcreteDomain<SubD, DB>;
};

// Base entities phantom (type-only) so links can reference $users and $files
type AnyEntityDef = EntitiesDef[string];
// Phantom base entities so links can legally reference $users / $files at type-level
type BaseEntitiesPhantom = {
  $users: EntityDef<any, any, any>;
  $files: EntityDef<any, any, any>;
};
type WithBase<E extends EntitiesDef> = MergeEntities<E, BaseEntitiesPhantom>;

// Note: createInstantSchema is now deprecated.
// Use domain.toInstantSchema() directly instead:
// const schema = domain.toInstantSchema();

// Builder that automatically includes base entities and enforces type-safe links
// AccumL preserves literal link keys from included domains
export type DomainBuilder<AccumE extends EntitiesDef, AccumL extends LinksDef<any> = LinksDef<any>> = {
  // Include other domains (instances or schema results). Links are merged and literal keys preserved.
  includes<
    E2 extends EntitiesDef,
    L2 extends LinksDef<any> = {}
  >(
    other:
      | DomainInstance<E2, L2, any>
      | DomainSchemaResult<E2, L2, any>
      | InstantSchemaDef<E2, L2, any>
      | (() => DomainInstance<E2, L2, any> | DomainSchemaResult<E2, L2, any> | InstantSchemaDef<E2, L2, any>)
      | undefined
  ): DomainBuilder<MergeEntities<AccumE, E2>, MergeLinks<AccumL, L2>>;

  // Define local entities and links
  // LL validates against merged entities (includes + local + base entities)
  // This ensures type safety: links can only reference entities that are available
  // Base entities ($users, $files) are included via WithBase, and included domains via AccumE
  schema<LE extends EntitiesDef, const LL extends LinksDef<WithBase<MergeEntities<AccumE, LE>>>>(def: {
    entities: LE;
    links: LL;
    rooms: RoomsDef;
  }): DomainSchemaResult<MergeEntities<AccumE, LE>, MergeLinks<AccumL, LL>, RoomsDef>;
};

function getMeta(source: unknown): DomainMeta | null {
  if (!source || typeof source !== "object") return null;
  return (source as any)[EKAIROS_META] ?? null;
}

function getActionBinding(source: unknown): { name: string; domain: unknown } | null {
  if (!source || typeof source !== "object") return null;
  const binding = (source as any)[EKAIROS_ACTION_BINDING];
  if (!binding || typeof binding !== "object") return null;
  const name = typeof binding.name === "string" ? binding.name.trim() : "";
  if (!name) return null;
  return { name, domain: binding.domain };
}

function bindAction(
  action: DomainActionDefinition<any, any, any, any>,
  params: { name: string; domain: unknown },
): DomainActionRegistration {
  const registration: DomainActionRegistration = {
    ...action,
    name: params.name,
  };
  Object.defineProperty(registration, EKAIROS_ACTION_BINDING, {
    value: {
      name: params.name,
      domain: params.domain,
    },
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return registration;
}

function getStoredActions(source: unknown): DomainActionRegistration[] {
  if (!source || typeof source !== "object") return [];
  const raw = (source as any)[EKAIROS_ACTIONS];
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      typeof (entry as any).name === "string" &&
      typeof (entry as any).execute === "function",
  ) as DomainActionRegistration[];
}

function setStoredActions(source: unknown, actions: DomainActionRegistration[]) {
  if (!source || typeof source !== "object") return;
  const frozenActions = Object.freeze([...actions]) as unknown as DomainActionRegistration[];
  Object.defineProperty(source, EKAIROS_ACTIONS, {
    value: frozenActions,
    enumerable: false,
    configurable: true,
    writable: true,
  });
}

function normalizeActionLike(
  value: DomainActionLike,
  params: { fallbackName: string; domain: unknown },
): DomainActionRegistration {
  const action: DomainActionDefinition<any, any, any, any> =
    typeof value === "function"
      ? ({ execute: value } as DomainActionDefinition<any, any, any, any>)
      : value;

  if (!action || typeof action !== "object" || typeof action.execute !== "function") {
    throw new Error(`Invalid domain action definition: ${params.fallbackName}`);
  }

  const explicitName = typeof action.name === "string" ? action.name.trim() : "";
  const bound = getActionBinding(action);
  const name = explicitName || bound?.name || params.fallbackName;
  if (!name) {
    throw new Error(`Domain action is missing a name: ${params.fallbackName}`);
  }

  const domain = bound?.domain ?? params.domain;
  return bindAction(action, { name, domain });
}

function normalizeActionCollection(
  source: unknown,
  input: DomainActionCollection,
): DomainActionRegistration[] {
  const current = getStoredActions(source);
  const byName = new Set(current.map((action) => action.name));
  const normalized: DomainActionRegistration[] = [];

  const push = (candidate: DomainActionRegistration) => {
    if (byName.has(candidate.name)) {
      throw new Error(`Duplicate domain action name: ${candidate.name}`);
    }
    byName.add(candidate.name);
    normalized.push(candidate);
  };

  if (Array.isArray(input)) {
    for (const entry of input) {
      const normalizedEntry = normalizeActionLike(entry as DomainActionLike, {
        fallbackName:
          typeof (entry as any)?.name === "string"
            ? String((entry as any).name).trim()
            : "",
        domain: source,
      });
      push(normalizedEntry);
    }
    return normalized;
  }

  for (const [key, value] of Object.entries(input ?? {})) {
    const normalizedEntry = normalizeActionLike(value as DomainActionLike, {
      fallbackName: key,
      domain: source,
    });
    push(normalizedEntry);
  }
  return normalized;
}

function attachMeta(target: object, meta: DomainMeta) {
  Object.defineProperty(target, EKAIROS_META, {
    value: meta,
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

function freezeMeta(meta: DomainMeta): DomainMeta {
  const frozenIncludes = Object.freeze([...(meta.includes ?? [])]) as unknown as DomainIncludeRef[];
  return Object.freeze({
    ...meta,
    includes: frozenIncludes,
  }) as DomainMeta;
}

function appendMetaInclude(meta: DomainMeta, include: DomainIncludeRef): DomainMeta {
  return {
    ...meta,
    includes: [...(meta.includes ?? []), include],
  };
}

function cloneRoomsDef<R extends RoomsDef>(rooms: R): R {
  return { ...(rooms as Record<string, unknown>) } as R;
}

function cloneLinksDef<L extends LinksDef<any>>(links: L): L {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries((links ?? {}) as Record<string, any>)) {
    out[key] = {
      ...(value ?? {}),
      forward: { ...(value?.forward ?? {}) },
      reverse: { ...(value?.reverse ?? {}) },
    };
  }
  return out as L;
}

function assertNoDuplicateLinkAttributes(links: LinksDef<any>) {
  const ownership = new Map<string, string>();
  const duplicates: Array<{ attribute: string; first: string; second: string }> = [];

  for (const [linkKey, linkValue] of Object.entries((links ?? {}) as Record<string, any>)) {
    const forward = linkValue?.forward;
    if (forward?.on && forward?.label) {
      const attribute = `${String(forward.on)}->${String(forward.label)}`;
      const first = ownership.get(attribute);
      if (first && first !== linkKey) {
        duplicates.push({ attribute, first, second: linkKey });
      } else {
        ownership.set(attribute, linkKey);
      }
    }

    const reverse = linkValue?.reverse;
    if (reverse?.on && reverse?.label) {
      const attribute = `${String(reverse.on)}->${String(reverse.label)}`;
      const first = ownership.get(attribute);
      if (first && first !== linkKey) {
        duplicates.push({ attribute, first, second: linkKey });
      } else {
        ownership.set(attribute, linkKey);
      }
    }
  }

  if (duplicates.length === 0) return;

  const detail = duplicates
    .map((entry) => `${entry.attribute} (${entry.first} vs ${entry.second})`)
    .join(", ");
  throw new Error(`duplicate_link_attribute:${detail}`);
}

function listKeys(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  return Object.keys(value as object).filter((key) => !key.startsWith("$"));
}

function resolveSchema(source: any): any {
  if (!source) return null;
  if (typeof source.toInstantSchema === "function") return source.toInstantSchema();
  if (typeof source.schema === "function") return source.schema();
  return {
    entities: source.entities ?? {},
    links: source.links ?? {},
    rooms: source.rooms ?? {},
  };
}

function collectSchemaKeys(schema: any): { entities: string[]; links: string[]; rooms: string[] } {
  return {
    entities: Object.keys(schema?.entities ?? {}),
    links: Object.keys(schema?.links ?? {}),
    rooms: Object.keys(schema?.rooms ?? {}),
  };
}

function assertSchemaIncludes(fullSchema: any, requiredSchema: any) {
  if (!fullSchema || !requiredSchema) return;
  const full = collectSchemaKeys(fullSchema);
  const required = collectSchemaKeys(requiredSchema);
  const missingEntities = required.entities.filter((k) => !full.entities.includes(k));
  const missingLinks = required.links.filter((k) => !full.links.includes(k));
  const missingRooms = required.rooms.filter((k) => !full.rooms.includes(k));
  if (missingEntities.length || missingLinks.length || missingRooms.length) {
    const parts: string[] = [];
    if (missingEntities.length) parts.push(`entities: ${missingEntities.join(", ")}`);
    if (missingLinks.length) parts.push(`links: ${missingLinks.join(", ")}`);
    if (missingRooms.length) parts.push(`rooms: ${missingRooms.join(", ")}`);
    throw new Error(`ConcreteDomain: schema is missing required keys (${parts.join(" | ")})`);
  }
}

function createConcreteDomain<D extends DomainSchemaResult, DB>(
  domainInstance: D,
  db: DB,
  fullSchema?: any,
): ConcreteDomain<D, DB> {
  const baseSchema = fullSchema ?? resolveSchema(domainInstance);
  const concrete: ConcreteDomain<D, DB> = {
    domain: domainInstance,
    db,
    schema: resolveSchema(domainInstance),
    context: (options?: DomainContextOptions) => domainInstance.context(options),
    contextString: (options?: DomainContextOptions) => domainInstance.contextString(options),
    fromDomain<SubD extends DomainSchemaResult>(subdomain: SubD) {
      const requiredSchema = resolveSchema(subdomain);
      assertSchemaIncludes(baseSchema, requiredSchema);
      return createConcreteDomain(subdomain, db, baseSchema);
    },
  };
  return concrete;
}

function loadDomainDoc(scope: "root" | "subdomain", meta: DomainMeta | null): DomainDocInfo | null {
  if (!domainDocLoader) return null;
  try {
    return domainDocLoader({ scope, meta }) ?? null;
  } catch {
    return null;
  }
}

function normalizeDoc(
  docInfo: DomainDocInfo | null,
  options: {
    subdomains?: string[];
    entities?: string[];
    titlePrefix?: "Domain" | "Subdomain";
    includeSubdomains?: boolean;
  }
): { doc: string | null; docPath?: string } {
  if (!docInfo?.doc) return { doc: null, docPath: docInfo?.docPath };
  const parsed = parseDomainDoc(docInfo.doc);
  if (!parsed) return { doc: docInfo.doc, docPath: docInfo.docPath };
  const filtered = filterDomainDoc(parsed.data, {
    subdomains: options.subdomains,
    entities: options.entities,
  });
  const rendered = renderDomainDoc(filtered, {
    titlePrefix: options.titlePrefix,
    includeSubdomains: options.includeSubdomains,
  });
  return { doc: rendered, docPath: docInfo.docPath };
}

function buildRegistryEntries(
  meta: DomainMeta | null,
  options?: DomainContextOptions
): DomainContextEntry[] {
  if (!meta) return [];
  const seen = new Set<unknown>();
  const queue = [...meta.includes];
  const entries: DomainContextEntry[] = [];

  while (queue.length > 0) {
    const getter = queue.shift();
    if (!getter) continue;
    let child: any = null;
    try {
      child = getter();
    } catch {
      child = null;
    }
    if (!child || typeof child !== "object") continue;
    if (seen.has(child)) continue;
    seen.add(child);

    const childMeta = getMeta(child);
    const schema = resolveSchema(child);
    const docInfo = loadDomainDoc("subdomain", childMeta);
    const includeSchema = options?.includeSchemas !== false;
    const includeNames = resolveIncludeNames(childMeta);
    const normalizedDoc = normalizeDoc(docInfo, {
      entities: listKeys(schema?.entities),
      titlePrefix: "Subdomain",
      includeSubdomains: false,
    });

    if (childMeta?.name) {
      entries.push({
        name: childMeta.name,
        includes: includeNames,
        entities: listKeys(schema?.entities),
        links: listKeys(schema?.links),
        rooms: listKeys(schema?.rooms),
        schema: includeSchema ? schema : undefined,
        doc: normalizedDoc.doc ?? null,
        docPath: normalizedDoc.docPath,
      });
    }

    if (childMeta?.includes?.length) {
      queue.push(...childMeta.includes);
    }
  }

  return entries;
}

function buildContext(
  source: any,
  options?: DomainContextOptions
): DomainContext {
  const meta = getMeta(source);
  const schema = resolveSchema(source);
  const registry = buildRegistryEntries(meta, options);
  const docInfo = loadDomainDoc("root", meta);
  const includeSchema = options?.includeSchemas !== false;
  const includeNames = resolveIncludeNames(meta);
  const normalizedDoc = normalizeDoc(docInfo, {
    subdomains: registry.map((entry) => entry.name ?? "").filter(Boolean),
    titlePrefix: "Domain",
    includeSubdomains: false,
  });

  return {
    name: meta?.name,
    includes: includeNames,
    entities: listKeys(schema?.entities),
    links: listKeys(schema?.links),
    rooms: listKeys(schema?.rooms),
    meta: options?.meta ?? (source as any)?.meta,
    schema: includeSchema ? schema : undefined,
    doc: normalizedDoc.doc ?? null,
    docPath: normalizedDoc.docPath,
    registry,
  };
}

function contextToString(context: DomainContext): string {
  const lines: string[] = [];

  const pushSection = (title: string) => {
    lines.push("");
    lines.push(`# ${title}`);
  };

  lines.push("# Domain Context");
  if (context.name) lines.push(`Name: ${context.name}`);

  if (context.entities?.length) {
    lines.push(`Entities: ${context.entities.join(", ")}`);
  }
  if (context.links?.length) {
    lines.push(`Links: ${context.links.join(", ")}`);
  }
  if (context.rooms?.length) {
    lines.push(`Rooms: ${context.rooms.join(", ")}`);
  }
  if (context.includes?.length) {
    lines.push(`Includes: ${context.includes.join(", ")}`);
  }

  if (context.doc) {
    pushSection("DOMAIN.md (root)");
    lines.push(context.doc);
  }

  if (context.registry?.length) {
    pushSection("Subdomains");
    for (const entry of context.registry) {
      lines.push("");
      lines.push(`## ${entry.name ?? "unknown"}`);
      if (entry.includes?.length) {
        lines.push(`Includes: ${entry.includes.join(", ")}`);
      }
      if (entry.doc) {
        lines.push(entry.doc);
        continue;
      }
      if (entry.entities?.length) {
        lines.push(`Entities: ${entry.entities.join(", ")}`);
      }
      if (entry.links?.length) {
        lines.push(`Links: ${entry.links.join(", ")}`);
      }
      if (entry.rooms?.length) {
        lines.push(`Rooms: ${entry.rooms.join(", ")}`);
      }
    }
  }

  return lines.join("\n").trim() + "\n";
}

function resolveIncludeNames(meta: DomainMeta | null): string[] {
  if (!meta?.includes?.length) return [];
  const names = new Set<string>();
  for (const getter of meta.includes) {
    if (!getter) continue;
    let child: any = null;
    try {
      child = getter();
    } catch {
      child = null;
    }
    if (!child || typeof child !== "object") continue;
    const childMeta = getMeta(child);
    if (childMeta?.name) names.add(childMeta.name);
  }
  return Array.from(names);
}

function makeInstance<E extends EntitiesDef, L extends LinksDef<E>, R extends RoomsDef>(
  def: DomainDefinition<E, L, R>,
  metaIncludes: DomainIncludeRef[] = [],
): DomainInstance<E, L, R> {
  const meta: DomainMeta = {
    name: def.name,
    rootDir: def.rootDir,
    packageName: def.packageName,
    includes: [...metaIncludes],
  };

  let instance: DomainInstance<E, L, R>;

  function schema() {
    return i.schema({
      entities: def.entities as E,
      links: def.links as L,
      rooms: def.rooms as R,
    });
  }

  function compose<E2 extends EntitiesDef, L2 extends LinksDef<E2>, R2 extends RoomsDef>(
    other: DomainInstance<E2, L2, R2> | DomainDefinition<E2, L2, R2>
  ): DomainInstance<E & E2, LinksDef<E & E2>, R & R2> {
    const otherDef =
      "schema" in other
        ? { entities: other.entities, links: other.links, rooms: other.rooms }
        : other;

    const mergedEntities = { ...def.entities, ...otherDef.entities } as E & E2;
    const mergedLinks = { ...(def.links as object), ...(otherDef.links as object) } as LinksDef<E & E2>;
    const mergedRooms = { ...def.rooms, ...otherDef.rooms } as R & R2;

    const composed = makeInstance({
      entities: mergedEntities,
      links: mergedLinks,
      rooms: mergedRooms,
      name: def.name,
      rootDir: def.rootDir,
      packageName: def.packageName,
    }, [() => instance, () => other]);
    return composed;
  }

  instance = {
    entities: def.entities,
    links: def.links,
    rooms: def.rooms,
    schema,
    compose,
  };
  attachMeta(instance, freezeMeta(meta));
  return instance;
}

// Overload 1: classic API: domain({ entities, links, rooms })
export function domain<E extends EntitiesDef, L extends LinksDef<E>, R extends RoomsDef>(
  def: DomainDefinition<E, L, R>
): DomainInstance<E, L, R>;

// Overload 2: builder API with dependsOn
export function domain(name?: string | DomainConstructorOptions): DomainBuilder<{}, {}>;

// Impl
export function domain(arg?: unknown): any {
  // Default include: start with an empty entities object
  // Base entities ($users, $files) are added at toInstantSchema() time to ensure they're always available
  // This allows links to reference them even when they're not explicitly defined in domains
  const base = i.schema({ entities: {}, links: {}, rooms: {} });
  const baseEntities = { ...base.entities };

  if (arg === undefined || arg === null) {
    throw new Error("domain() requires a name");
  }

  if (typeof arg === "object" && arg !== null) {
    const maybeDef = arg as DomainDefinition<any, LinksDef<any>, any>;
    if ("entities" in maybeDef && "links" in maybeDef && "rooms" in maybeDef) {
      if (!maybeDef.name) {
        throw new Error("domain() requires a name");
      }
      // classic API path: def provided directly
      return makeInstance(maybeDef);
    }
    const opts = arg as DomainConstructorOptions;
    if (!opts.name) {
      throw new Error("domain() requires a name");
    }
    return createBuilder<{}, {}>(baseEntities, {} as any, [], {
      name: opts.name,
      rootDir: opts.rootDir,
      packageName: opts.packageName,
      includes: [],
    });
  }

  // builder API - runtime state tracks accumulated dependencies
  // Support lazy includes for circular dependencies by storing references and resolving at schema()/toInstantSchema() time
  // AL preserves literal link keys from included domains
  function createBuilder<AE extends EntitiesDef, AL extends LinksDef<any> = LinksDef<any>>(
    deps: AE,
    linkDeps: AL,
    lazyIncludes: Array<() => DomainInstance<any, any, any> | DomainSchemaResult<any, any, any> | InstantSchemaDef<any, any, any> | undefined> = [],
    meta: DomainMeta
  ): DomainBuilder<AE, AL> {
    return {
      includes<E2 extends EntitiesDef, L2 extends LinksDef<any> = {}>(other: DomainInstance<E2, L2, any> | DomainSchemaResult<E2, L2, any> | InstantSchemaDef<E2, L2, any> | (() => DomainInstance<E2, L2, any> | DomainSchemaResult<E2, L2, any> | InstantSchemaDef<E2, L2, any>) | undefined) {
        // Support lazy includes via function for circular dependencies
        if (typeof other === 'function') {
          const lazyGetter = () => {
            try {
              return other();
            } catch (e) {
              return undefined;
            }
          };
          const nextMeta = appendMetaInclude(meta, lazyGetter as DomainIncludeRef);
          // Preserve link literal keys using MergeLinks
          return createBuilder<MergeEntities<AE, E2>, MergeLinks<AL, L2>>(
            deps as MergeEntities<AE, E2>,
            linkDeps as MergeLinks<AL, L2>,
            [...lazyIncludes, lazyGetter as any],
            nextMeta
          );
        }
        
        // If other is undefined (circular dependency), store a lazy getter
        // Entities will be resolved from app domain composition at toInstantSchema() time
        if (!other || other === undefined) {
          // Create a lazy getter that returns undefined
          // Entities will be available from app domain's merged entities when toInstantSchema() is called
          const lazyGetter = () => undefined;
          const nextMeta = appendMetaInclude(meta, lazyGetter as DomainIncludeRef);
          // Preserve link literal keys
          return createBuilder<MergeEntities<AE, E2>, MergeLinks<AL, L2>>(
            deps as MergeEntities<AE, E2>,
            linkDeps as MergeLinks<AL, L2>,
            [...lazyIncludes, lazyGetter],
            nextMeta
          );
        }
        
        // Try to get entities and links immediately
        try {
          const entities = (other as any).entities as E2 | undefined;
          if (!entities) {
            // If entities don't exist yet, store as lazy
            const lazyGetter = () => other;
            const nextMeta = appendMetaInclude(meta, lazyGetter as DomainIncludeRef);
            // Preserve link literal keys
            return createBuilder<MergeEntities<AE, E2>, MergeLinks<AL, L2>>(
              deps as MergeEntities<AE, E2>,
              linkDeps as MergeLinks<AL, L2>,
              [...lazyIncludes, lazyGetter as any],
              nextMeta
            );
          }
          
          const links = (other as any).links as L2 | undefined;
          const mergedEntities = { ...deps, ...entities } as MergeEntities<AE, E2>;
          // Preserve literal link keys by merging directly (not casting to LinksDef)
          const mergedLinks = (links ? { ...linkDeps, ...links } : { ...linkDeps }) as MergeLinks<AL, L2>;
          const includeRef = () => other as any;
          const nextMeta = appendMetaInclude(meta, includeRef);
          return createBuilder<MergeEntities<AE, E2>, MergeLinks<AL, L2>>(mergedEntities, mergedLinks, lazyIncludes, nextMeta);
        } catch (e) {
          // If accessing entities throws, store as lazy
          const lazyGetter = () => other;
          const nextMeta = appendMetaInclude(meta, lazyGetter as DomainIncludeRef);
          // Preserve link literal keys
          return createBuilder<MergeEntities<AE, E2>, MergeLinks<AL, L2>>(
            deps as MergeEntities<AE, E2>,
            linkDeps as MergeLinks<AL, L2>,
            [...lazyIncludes, lazyGetter as any],
            nextMeta
          );
        }
      },
      schema<LE extends EntitiesDef, const LL extends LinksDef<WithBase<MergeEntities<AE, LE>>>>(def: {
        entities: LE;
        links: LL;
        rooms: RoomsDef;
      }): DomainSchemaResult<MergeEntities<AE, LE>, MergeLinks<AL, LL>, RoomsDef> {
        // Resolve lazy includes at schema() time (when all domains should be initialized)
        // This handles circular dependencies by deferring entity resolution
        let resolvedDeps = { ...deps };
        // Preserve literal link keys from accumulated links
        let resolvedLinks: AL = { ...linkDeps } as AL;
        for (const lazyGetter of lazyIncludes) {
          try {
            const other = lazyGetter();
            if (other) {
              const entities = (other as any).entities as EntitiesDef;
              if (entities) {
                resolvedDeps = { ...resolvedDeps, ...entities };
              }
              const links = (other as any).links as LinksDef<any>;
              if (links) {
                // Merge links preserving literal keys
                resolvedLinks = { ...resolvedLinks, ...links } as AL;
              }
            }
          } catch (e) {
            // If lazy resolution fails, continue - entities might be available via string references
            // This is expected for circular dependencies that will be resolved when all domains are composed
          }
        }
        
        // Runtime merge for output; compile-time validation handled by types above
        const allEntities = { ...resolvedDeps, ...def.entities } as MergeEntities<AE, LE>;
        // allLinks contains merged links from included domains + current domain
        // Preserve literal link keys (owner, related, parent, etc.) by using MergeLinks
        const allLinks = { ...resolvedLinks, ...def.links } as MergeLinks<AL, LL>;
        
        // Capture the literal type of merged links - this is critical for preserving literal link keys
        // MergeLinks<AL, LL> preserves literal keys from both included domains (AL) and local links (LL)
        // The 'const' modifier on LL parameter ensures literal keys are preserved
        type MergedLinksType = MergeLinks<AL, LL>;
        type MergedEntitiesType = MergeEntities<AE, LE>;
        
        const createDomainResult = (
          seedActions: DomainActionRegistration[] = [],
        ): DomainSchemaResult<MergedEntitiesType, MergedLinksType, typeof def.rooms> => {
          type InstantSchemaResult = ReturnType<
            DomainSchemaResult<MergedEntitiesType, MergedLinksType, typeof def.rooms>["toInstantSchema"]
          >;
          const capturedEntities = { ...allEntities };
          const capturedLinks = cloneLinksDef(allLinks);
          const capturedRooms = cloneRoomsDef(def.rooms);
          let cachedInstantSchema: InstantSchemaResult | null = null;

          const result = {
            entities: Object.freeze({ ...allEntities }) as MergedEntitiesType,
            // Strip base phantom from public type so it's assignable to i.schema()
            links: Object.freeze(cloneLinksDef(allLinks)) as MergedLinksType,
            rooms: Object.freeze(cloneRoomsDef(def.rooms)),
            // Add originalEntities for type-safe access to original entity definitions
            originalEntities: Object.freeze({ ...allEntities }) as MergedEntitiesType,
            toInstantSchema: () => {
              if (cachedInstantSchema) {
                return cachedInstantSchema;
              }

              let finalEntities = { ...capturedEntities };
              let finalLinks = cloneLinksDef(capturedLinks);
              let hasUnresolvedIncludes = false;

              // Try to resolve lazy includes one more time (domains should be initialized by now)
              for (const lazyGetter of lazyIncludes) {
                try {
                  const other = lazyGetter();
                  if (other) {
                    const entities = (other as any).entities as EntitiesDef;
                    if (entities) {
                      finalEntities = { ...finalEntities, ...entities };
                    }
                    const links = (other as any).links as LinksDef<any>;
                    if (links) {
                      finalLinks = { ...finalLinks, ...links } as typeof finalLinks;
                    }
                  } else {
                    hasUnresolvedIncludes = true;
                  }
                } catch {
                  // If still can't resolve, entities should already be in allEntities from app domain composition
                  hasUnresolvedIncludes = true;
                }
              }

              assertNoDuplicateLinkAttributes(finalLinks as LinksDef<any>);

              // Include base entities ($users, $files) that InstantDB manages
              // These need to be explicitly included since InstantDB doesn't auto-add them
              const baseEntities = {
                $users: i.entity({
                  email: i.string().optional().indexed(),
                }),
                $files: i.entity({
                  path: i.string(),
                  url: i.string().optional(),
                  contentType: i.string().optional(),
                  size: i.number().optional(),
                }),
              };

              // Merge base entities with user entities, user entities take precedence
              const allEntitiesWithBase = {
                ...baseEntities,
                ...finalEntities,
              } as WithBase<MergedEntitiesType>;

              const schemaResult = i.schema({
                entities: allEntitiesWithBase,
                links: cloneLinksDef(finalLinks as MergedLinksType) as LinksDef<WithBase<MergedEntitiesType>>,
                rooms: cloneRoomsDef(capturedRooms),
              });

              const frozenSchema = Object.freeze(schemaResult) as InstantSchemaResult;
              if (!hasUnresolvedIncludes) {
                cachedInstantSchema = frozenSchema;
              }
              return frozenSchema;
            },
          } as unknown as DomainSchemaResult<MergedEntitiesType, MergedLinksType, typeof def.rooms>;

          attachMeta(result as object, freezeMeta(meta));
          (result as any).context = (options?: DomainContextOptions) =>
            buildContext(result, options);
          (result as any).contextString = (options?: DomainContextOptions) =>
            contextToString(buildContext(result, options));
          (result as any).fromDB = <DB = any>(db: DB) =>
            createConcreteDomain(result as any, db, resolveSchema(result));

          const reboundActions = seedActions.map((action) =>
            bindAction(action, { name: action.name, domain: result }),
          );
          setStoredActions(result as any, [...reboundActions]);
          (result as any).actions = (actionsInput: DomainActionCollection) => {
            const current = getStoredActions(result as any);
            const additions = normalizeActionCollection(result as any, actionsInput);
            return createDomainResult([...current, ...additions]);
          };
          (result as any).getActions = () => [...getStoredActions(result as any)];

          return Object.freeze(result as any);
        };

        return createDomainResult();
      },
    };
  }

  if (typeof arg === "string" && !arg.trim()) {
    throw new Error("domain() requires a name");
  }

  const meta: DomainMeta = { name: String(arg), includes: [] };

  return createBuilder<{}, {}>(baseEntities, {} as any, [], meta);
}

export function composeDomain(
  name: string | DomainConstructorOptions,
  includes: DomainInclude[] = [],
): DomainSchemaResult<any, any, any> {
  let builder: any = domain(name);
  for (const include of includes) {
    builder = builder.includes(include as any);
  }
  return builder.schema({ entities: {}, links: {}, rooms: {} });
}

export function defineDomainAction<
  Env extends Record<string, unknown> = Record<string, unknown>,
  Input = unknown,
  Output = unknown,
  Runtime = unknown,
>(
  action: DomainActionDefinition<Env, Input, Output, Runtime>,
): DomainActionDefinition<Env, Input, Output, Runtime> {
  return action;
}

export function getDomainActions(source: unknown): DomainActionRegistration[] {
  return getStoredActions(source);
}

export function getDomainActionBinding(source: unknown): { name: string; domain: unknown } | null {
  return getActionBinding(source);
}


