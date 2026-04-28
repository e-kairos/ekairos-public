import { i } from "@instantdb/core";
import type { InstantAdminDatabase } from "@instantdb/admin";
import type { EntitiesDef, LinksDef, RoomsDef, InstantSchemaDef, EntityDef } from "@instantdb/core";
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde";
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
export {
  EkairosRuntime,
  type RuntimeForDomain,
  type RuntimeLike,
  type ExplicitRuntimeLike,
} from "./runtime-handle.js";

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
  Domain = unknown,
> = {
  env: Env;
  input: Input;
  runtime: Runtime;
};

declare const DOMAIN_ACTION_RUNTIME_OUTPUT: unique symbol;
declare const DOMAIN_ACTION_SERIALIZED_OUTPUT: unique symbol;

export type DomainActionOutputContract<
  RuntimeOutput,
  SerializedOutput = RuntimeOutput,
> = {
  readonly kind: string;
  readonly [DOMAIN_ACTION_RUNTIME_OUTPUT]?: RuntimeOutput;
  readonly [DOMAIN_ACTION_SERIALIZED_OUTPUT]?: SerializedOutput;
};

export type WorkflowSerializableConstructor<
  Instance = unknown,
  Serialized = unknown,
> = {
  [WORKFLOW_SERIALIZE](instance: Instance): Serialized;
  [WORKFLOW_DESERIALIZE](data: Serialized): Instance;
};

export type WorkflowOutputInstance<Ctor> =
  Ctor extends { [WORKFLOW_DESERIALIZE](data: any): infer Instance }
    ? Instance
    : never;

export type WorkflowOutputSerialized<Ctor> =
  Ctor extends { [WORKFLOW_SERIALIZE](instance: any): infer Serialized }
    ? Serialized
    : never;

export type DomainWorkflowOutput<
  Ctor extends WorkflowSerializableConstructor<any, any>,
> = DomainActionOutputContract<
  WorkflowOutputInstance<Ctor>,
  WorkflowOutputSerialized<Ctor>
> & {
  readonly kind: "workflow";
  readonly ctor: Ctor;
};

export type DomainActionRuntimeOutput<Output> =
  Output extends DomainActionOutputContract<infer RuntimeOutput, any>
    ? RuntimeOutput
    : Output;

export type DomainActionSerializedOutputValue<Output> =
  Output extends DomainActionOutputContract<any, infer SerializedOutput>
    ? SerializedOutput
    : Output;

export function workflow<Ctor extends WorkflowSerializableConstructor<any, any>>(
  ctor: Ctor,
): DomainWorkflowOutput<Ctor> {
  return {
    kind: "workflow",
    ctor,
  } as DomainWorkflowOutput<Ctor>;
}

export type DomainActionDefinition<
  Env extends Record<string, unknown> = Record<string, unknown>,
  Input = unknown,
  Output = unknown,
  Runtime = unknown,
  Domain = unknown,
  OutputContract = unknown,
> = {
  name?: string;
  description?: string;
  inputSchema?: unknown;
  output?: OutputContract;
  outputSchema?: unknown;
  requiredScopes?: string[];
  /**
   * Domain actions are step-safe command units.
   *
   * Recommended pattern:
   *
   * `async execute({ runtime, input }) { "use step"; const domain = await runtime.use(myDomain); ... }`
   *
   * Action execution receives `env`, `input`, and `runtime`. If action logic
   * needs a scoped domain handle, reconstruct it locally with
   * `await runtime.use(exportedDomain)`. `"use workflow"` inside `execute(...)`
   * is intentionally out of scope.
   */
  execute: (
    params: DomainActionExecuteParams<Env, Input, Runtime, Domain>,
  ) => Promise<Output> | Output;
};

export type DomainActionRegistration<
  Env extends Record<string, unknown> = Record<string, unknown>,
  Input = unknown,
  Output = unknown,
  Runtime = unknown,
  Domain = unknown,
  OutputContract = unknown,
> = DomainActionDefinition<Env, Input, Output, Runtime, Domain, OutputContract> & {
  name: string;
};

export type DomainActionLike =
  | DomainActionDefinition<any, any, any, any, any, any>
  | ((params: DomainActionExecuteParams<any, any, any, any>) => unknown);

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

type UnknownDomainNames = string;

const EKAIROS_META = Symbol.for("@ekairos/domain/meta");
const EKAIROS_ACTIONS = Symbol.for("@ekairos/domain/actions");
const EKAIROS_ACTION_MAP = Symbol.for("@ekairos/domain/action-map");
const EKAIROS_ACTION_BINDING = Symbol.for("@ekairos/domain/action-binding");
const EKAIROS_ACTION_STACK = Symbol.for("@ekairos/domain/action-stack");
declare const DOMAIN_NAME_TYPE: unique symbol;
declare const DOMAIN_INCLUDED_NAMES_TYPE: unique symbol;
declare const DOMAIN_ACTION_MAP_TYPE: unique symbol;
declare const DOMAIN_LINKS_TYPE: unique symbol;

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
    ? ReturnType<D["instantSchema"]>
    : InstantSchemaDef<D["entities"], LinksDef<D["entities"]>, D["rooms"]>;

export type DomainDbFor<D extends DomainDefinition<any, any, any> | DomainSchemaResult<any, any, any>> =
  InstantAdminDatabase<SchemaOf<D>, true>;

// --- Schema compatibility helpers for domain composition ---

type EntitiesOf<S> =
  S extends InstantSchemaDef<infer E, any, any> ? E : never;

type LinksOf<S> =
  S extends InstantSchemaDef<any, infer L, any> ? L : never;

type AttrsOfEntity<E> =
  E extends EntityDef<infer Attrs, any, any> ? Attrs : never;

type EnsureIncludesEntityAttrs<
  FullEntity,
  RequiredEntity,
> = [
  {
    [K in keyof AttrsOfEntity<RequiredEntity>]:
      K extends keyof AttrsOfEntity<FullEntity>
        ? (AttrsOfEntity<FullEntity>[K] extends AttrsOfEntity<RequiredEntity>[K] ? never : K)
        : K
  }[keyof AttrsOfEntity<RequiredEntity>]
] extends [never]
  ? true
  : false;

/**
 * Verifies that Full schema includes all entities and links from Required schema.
 * Returns Full if compatible, never otherwise.
 */
type EnsureIncludesSchema<
  Full extends InstantSchemaDef<any, any, any>,
  Required extends InstantSchemaDef<any, any, any>
> =
  // Check entities: Full must contain all entities from Required with compatible types
  [
  {
    [K in keyof EntitiesOf<Required>]:
      K extends keyof EntitiesOf<Full>
        ? (EnsureIncludesEntityAttrs<EntitiesOf<Full>[K], EntitiesOf<Required>[K]> extends true ? never : K)
        : K
  }[keyof EntitiesOf<Required>]
  ] extends [never]
    ? (
        // Check links: Full must contain all links from Required with compatible types
        [
        {
          [K in keyof LinksOf<Required>]:
            K extends keyof LinksOf<Full>
              ? (LinksOf<Full>[K] extends LinksOf<Required>[K] ? never : K)
              : K
        }[keyof LinksOf<Required>]
        ] extends [never]
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
 * Usage in @ekairos/events:
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

export type DomainNameOf<D> =
  D extends { readonly [DOMAIN_NAME_TYPE]?: infer Name }
    ? NonNullable<Name> extends string
      ? NonNullable<Name>
      : UnknownDomainNames
    : UnknownDomainNames;

export type IncludedDomainNamesOf<D> =
  D extends { readonly [DOMAIN_INCLUDED_NAMES_TYPE]?: infer Names }
    ? NonNullable<Names> extends string
      ? NonNullable<Names>
      : DomainNameOf<D>
    : DomainNameOf<D>;

export type DomainInstantSchema<D> =
  D extends DomainSchemaResult<any, any, any, any, any, any>
    ? ReturnType<D["instantSchema"]>
    : never;

// Utility types for extracting from domain definitions/instances
type ExtractEntities<T> = T extends { entities: infer E } ? E extends EntitiesDef ? E : never : never;
type ExtractLinks<T> = T extends { links: infer L } ? L extends LinksDef<any> ? L : never : never;
type ExtractRooms<T> = T extends { rooms: infer R } ? R extends RoomsDef ? R : never : never;

type Simplify<T> = { [K in keyof T]: T[K] } & {};

export type DomainActionMap = Record<string, DomainActionRegistration<any, any, any, any, any, any>>;

export type DomainDefinitionOf<D> =
  D extends DomainSchemaResult<
    infer E,
    infer L,
    infer R,
    infer Actions,
    infer Name,
    infer IncludedNames
  >
    ? DomainSchemaResult<
        Simplify<E>,
        Simplify<L>,
        R,
        Simplify<Actions>,
        Name,
        IncludedNames
      >
    : never;

type InferActionRegistrationFromLike<Value, Key extends string> =
  Value extends DomainActionDefinition<
    infer Env,
    infer Input,
    infer Output,
    infer Runtime,
    infer Domain,
    infer OutputContract
  >
    ? DomainActionRegistration<Env, Input, Output, Runtime, Domain, OutputContract>
    : Value extends (params: DomainActionExecuteParams<
        infer Env,
        infer Input,
        infer Runtime,
        infer Domain
      >) => infer Output
      ? DomainActionRegistration<Env, Input, Awaited<Output>, Runtime, Domain>
      : DomainActionRegistration;

type ActionMapFromCollection<Input> =
  Input extends Record<string, any>
    ? {
        [K in keyof Input & string]: InferActionRegistrationFromLike<Input[K], K>;
      }
    : {};

type MergeActionMaps<
  Current extends DomainActionMap,
  Next extends DomainActionMap,
> = Simplify<Omit<Current, keyof Next> & Next>;

export type ActionMapOf<D> =
  D extends { readonly [DOMAIN_ACTION_MAP_TYPE]?: infer Actions }
    ? NonNullable<Actions>
    : {};

export type DomainActionsOf<D> = ActionMapOf<D>;

type ActionInputOf<Action> =
  Action extends DomainActionDefinition<any, infer Input, any, any, any, any> ? Input : never;

type ActionOutputOf<Action> =
  Action extends DomainActionDefinition<any, any, infer Output, any, any, any>
    ? Awaited<Output>
    : never;

export type DomainActionOutput<Action> =
  Action extends DomainActionDefinition<any, any, infer Output, any, any, any>
    ? Awaited<Output>
    : never;

export type DomainActionSerializedOutput<Action> =
  Action extends DomainActionDefinition<any, any, infer Output, any, any, infer OutputContract>
    ? [OutputContract] extends [never]
      ? Awaited<Output>
      : unknown extends OutputContract
      ? Awaited<Output>
      : DomainActionSerializedOutputValue<OutputContract>
    : never;

type DomainActionMethods<Actions extends DomainActionMap> = {
  [K in keyof Actions]: (
    input: ActionInputOf<Actions[K]>,
  ) => Promise<ActionOutputOf<Actions[K]>>;
};

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

type DomainSchemaSource =
  | DomainInstance<any, any, any>
  | DomainSchemaResult<any, any, any>
  | InstantSchemaDef<any, any, any>;

type EntitiesOfDomainSource<D> =
  D extends DomainSchemaResult<infer E, any, any, any, any, any>
    ? E
    : D extends DomainInstance<infer E, any, any>
      ? E
      : D extends InstantSchemaDef<infer E, any, any>
        ? E
        : {};

type LinksOfDomainSource<D> =
  D extends { readonly [DOMAIN_LINKS_TYPE]?: infer L }
    ? NonNullable<L> extends LinksDef<any>
      ? NonNullable<L>
      : {}
    : D extends { links: infer L }
      ? L extends LinksDef<any>
        ? L
        : {}
    : {};

// Permissive links type that preserves literal keys but doesn't validate entity references
// This allows links to reference entities that will be available after includes ($users, cross-domain entities)
type PermissiveLinksDef = Record<string, {
  forward: { on: string; has: "one" | "many"; label: string };
  reverse: { on: string; has: "one" | "many"; label: string };
}>;

// Simple type to represent entity names for basic validation
type EntityNames<T> = T extends Record<string, any> ? keyof T : never;

// Result of domain.withSchema() with toInstantSchema method
// L represents the merged links (current domain + included domains) with literal keys preserved
// This type preserves both:
// 1. Full compatibility with InstantDB's schema type for InstaQLParams validation (enriched entities)
// 2. Original entities (E) accessible via originalEntities property for type safety
// The key is that DomainSchemaResult extends InstantDB's schema type completely,
// so typeof domain works with InstaQLParams and validates queries correctly (like InstantDB does)
// InstaQLParams uses the enriched entities from the schema to validate link names in queries
export type DomainSchemaResult<
  E extends EntitiesDef = EntitiesDef,
  L extends LinksDef<any> = LinksDef<any>,
  R extends RoomsDef = RoomsDef,
  Actions extends DomainActionMap = {},
  Name extends string = string,
  IncludedNames extends string = Name,
> = 
  ReturnType<typeof i.schema<WithBase<E>, L, R>> & {
    // Add originalEntities property for type-safe access to original entity definitions
    // This preserves type safety while InstaQLParams uses enriched entities for validation
    readonly originalEntities: E;
    readonly [DOMAIN_NAME_TYPE]?: Name;
    readonly [DOMAIN_INCLUDED_NAMES_TYPE]?: IncludedNames;
    readonly [DOMAIN_ACTION_MAP_TYPE]?: Actions;
    readonly [DOMAIN_LINKS_TYPE]?: L;
    // Build the complete Instant schema for provisioning/admin usage.
    instantSchema: () => ReturnType<typeof i.schema<WithBase<E>, L, R>>;
    /**
     * @deprecated Use instantSchema().
     */
    toInstantSchema: () => ReturnType<typeof i.schema<WithBase<E>, L, R>>;
    // Return this domain as a materialized type, flattening composition history.
    definition: () => DomainDefinitionOf<
      DomainSchemaResult<E, L, R, Actions, Name, IncludedNames>
    >;
    // Build full domain context (schema + registry + docs) for AI/system prompts.
    context: (options?: DomainContextOptions) => DomainContext;
    // Render a prompt-friendly context string for AI system prompts.
    contextString: (options?: DomainContextOptions) => string;
    // Bind a concrete database to this domain for runtime usage.
    fromDB: <DB = any>(
      db: DB,
      bindings?: { env?: unknown; runtime?: unknown },
    ) => ConcreteDomain<DomainSchemaResult<E, L, R, Actions, Name, IncludedNames>, DB>;
    // Optional metadata for this domain.
    meta?: Record<string, unknown>;
    // Raw domain action definitions declared for this domain result.
    readonly actions: Readonly<Actions>;
    // Attach explicit domain actions to this domain result.
    withActions: {
      <Input extends Record<string, DomainActionLike>>(
        actions: Input,
      ): DomainSchemaResult<E, L, R, MergeActionMaps<Actions, ActionMapFromCollection<Input>>, Name, IncludedNames>;
      (actions: DomainActionLike[] | DomainActionRegistration[]): DomainSchemaResult<E, L, R, Actions, Name, IncludedNames>;
    };
    // Retrieve actions explicitly attached to this domain result.
    getActions: () => DomainActionRegistration[];
    getActionMap: () => Actions;
  };

export type ConcreteDomain<
  D extends DomainSchemaResult = DomainSchemaResult,
  DB = any,
> = {
  domain: D;
  db: DB;
  schema: ReturnType<D["toInstantSchema"]>;
  context: (options?: DomainContextOptions) => DomainContext;
  contextString: (options?: DomainContextOptions) => string;
};

export type ActiveDomain<
  D extends DomainSchemaResult = DomainSchemaResult,
  Env = unknown,
  Bound extends boolean = true,
> = ConcreteDomain<D, DomainDbFor<D>> & (Bound extends true
  ? {
      env: Env;
      actions: DomainActionMethods<ActionMapOf<D>>;
    }
  : {});

// Base entities phantom (type-only) so links can reference $users and $files
type AnyEntityDef = EntitiesDef[string];
// Phantom base entities so links can legally reference $users / $files at type-level
type BaseEntitiesPhantom = {
  $users: EntityDef<any, any, any>;
  $files: EntityDef<any, any, any>;
  $streams: EntityDef<any, any, any>;
};
type WithBase<E extends EntitiesDef> = MergeEntities<E, BaseEntitiesPhantom>;

// Note: createInstantSchema is now deprecated.
// Use domain.instantSchema() directly instead:
// const schema = domain.instantSchema();

// Builder that automatically includes base entities and enforces type-safe links
// AccumL preserves literal link keys from included domains
export type DomainBuilder<
  AccumE extends EntitiesDef,
  AccumL extends LinksDef<any> = LinksDef<any>,
  Name extends string = string,
  IncludedNames extends string = Name,
> = {
  // Include other domains (instances or schema results). Links are merged and literal keys preserved.
  includes<const OtherDomain extends DomainSchemaSource>(
    other:
      | OtherDomain
      | (() => OtherDomain)
      | undefined
  ): DomainBuilder<
    MergeEntities<AccumE, EntitiesOfDomainSource<OtherDomain>>,
    MergeLinks<AccumL, LinksOfDomainSource<OtherDomain>>,
    Name,
    IncludedNames | IncludedDomainNamesOf<OtherDomain>
  >;

  // Define local entities and links
  // LL validates against merged entities (includes + local + base entities)
  // This ensures type safety: links can only reference entities that are available
  // Base entities ($users, $files) are included via WithBase, and included domains via AccumE
  withSchema<LE extends EntitiesDef, const LL extends LinksDef<any>>(def: {
    entities: LE;
    links: LL;
    rooms: RoomsDef;
  }): DomainSchemaResult<MergeEntities<AccumE, LE>, MergeLinks<AccumL, LL>, RoomsDef, {}, Name, IncludedNames>;

  /**
   * @deprecated Use withSchema().
   */
  schema<LE extends EntitiesDef, const LL extends LinksDef<any>>(def: {
    entities: LE;
    links: LL;
    rooms: RoomsDef;
  }): DomainSchemaResult<MergeEntities<AccumE, LE>, MergeLinks<AccumL, LL>, RoomsDef, {}, Name, IncludedNames>;
};

function getMeta(source: unknown): DomainMeta | null {
  if (!source || typeof source !== "object") return null;
  return (source as any)[EKAIROS_META] ?? null;
}

function getActionBinding(source: unknown): { name: string; domain: unknown; key?: string } | null {
  if (!source || typeof source !== "object") return null;
  const binding = (source as any)[EKAIROS_ACTION_BINDING];
  if (!binding || typeof binding !== "object") return null;
  const name = typeof binding.name === "string" ? binding.name.trim() : "";
  if (!name) return null;
  const key = typeof binding.key === "string" ? binding.key.trim() : "";
  return {
    name,
    domain: binding.domain,
    ...(key ? { key } : {}),
  };
}

function bindAction(
  action: DomainActionDefinition<any, any, any, any, any, any>,
  params: { name: string; domain: unknown; key?: string },
): DomainActionRegistration {
  const registration: DomainActionRegistration = {
    ...action,
    name: params.name,
  };
  Object.defineProperty(registration, EKAIROS_ACTION_BINDING, {
    value: {
      name: params.name,
      domain: params.domain,
      key: params.key,
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

function getStoredActionMap(source: unknown): DomainActionMap {
  if (!source || typeof source !== "object") return {};
  const raw = (source as any)[EKAIROS_ACTION_MAP];
  if (!raw || typeof raw !== "object") return {};
  return raw as DomainActionMap;
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

function setStoredActionMap(source: unknown, actionMap: DomainActionMap) {
  if (!source || typeof source !== "object") return;
  Object.defineProperty(source, EKAIROS_ACTION_MAP, {
    value: Object.freeze({ ...actionMap }),
    enumerable: false,
    configurable: true,
    writable: true,
  });
}

function readRuntimeActionStack(runtime: unknown): string[] {
  if (!runtime || typeof runtime !== "object") return [];
  const stack = (runtime as any)[EKAIROS_ACTION_STACK];
  return Array.isArray(stack) ? [...stack] : [];
}

function cloneRuntimeWithActionStack<Runtime>(runtime: Runtime, stack: string[]): Runtime {
  if (!runtime || typeof runtime !== "object") return runtime;
  const scoped = Object.assign(
    Object.create(Object.getPrototypeOf(runtime)),
    runtime,
  ) as Runtime;
  Object.defineProperty(scoped as object, EKAIROS_ACTION_STACK, {
    value: [...stack],
    enumerable: false,
    configurable: true,
    writable: true,
  });
  return scoped;
}

function normalizeActionLike(
  value: DomainActionLike,
  params: { fallbackName: string; domain: unknown; key?: string },
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
  return bindAction(action, { name, domain, key: params.key ?? params.fallbackName });
}

function normalizeActionCollection(
  source: unknown,
  input: DomainActionCollection,
): { actions: DomainActionRegistration[]; actionMap: DomainActionMap } {
  const current = getStoredActions(source);
  const currentActionMap = getStoredActionMap(source);
  const byName = new Set(current.map((action) => action.name));
  const byKey = new Set(Object.keys(currentActionMap));
  const normalized: DomainActionRegistration[] = [];
  const actionMap: DomainActionMap = {};

  const push = (candidate: DomainActionRegistration, key?: string) => {
    if (byName.has(candidate.name)) {
      throw new Error(`Duplicate domain action name: ${candidate.name}`);
    }
    const localKey = String(key ?? (candidate as any)?.name ?? "").trim();
    if (localKey) {
      if (byKey.has(localKey)) {
        throw new Error(`Duplicate domain action key: ${localKey}`);
      }
      byKey.add(localKey);
      actionMap[localKey] = candidate;
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
      push(normalizedEntry, (normalizedEntry as any)?.name);
    }
    return { actions: normalized, actionMap };
  }

  for (const [key, value] of Object.entries(input ?? {})) {
    const normalizedEntry = normalizeActionLike(value as DomainActionLike, {
      fallbackName: key,
      domain: source,
      key,
    });
    push(normalizedEntry, key);
  }
  return { actions: normalized, actionMap };
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
  if (typeof source.instantSchema === "function") return source.instantSchema();
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

function collectTransitiveDomainNames(source: unknown, seen = new Set<unknown>()): Set<string> {
  const names = new Set<string>();
  if (!source || typeof source !== "object") return names;
  if (seen.has(source)) return names;
  seen.add(source);

  const meta = getMeta(source);
  if (!meta) return names;
  if (meta.name) names.add(meta.name);

  for (const getter of meta.includes ?? []) {
    if (!getter) continue;
    let child: unknown = null;
    try {
      child = getter();
    } catch {
      child = null;
    }
    for (const name of collectTransitiveDomainNames(child, seen)) {
      names.add(name);
    }
  }

  return names;
}

function assertDomainNamesInclude(rootDomain: unknown, requiredDomain: unknown) {
  const rootMeta = getMeta(rootDomain);
  const requiredMeta = getMeta(requiredDomain);
  if (!rootMeta || !requiredMeta) return;

  const rootNames = collectTransitiveDomainNames(rootDomain);
  const requiredNames = collectTransitiveDomainNames(requiredDomain);
  if (rootNames.size === 0 || requiredNames.size === 0) return;

  const missing = Array.from(requiredNames).filter((name) => !rootNames.has(name));
  if (missing.length > 0) {
    throw new Error(`ConcreteDomain: domain is missing required names (${missing.join(", ")})`);
  }
}

function createConcreteDomain<D extends DomainSchemaResult, DB>(
  domainInstance: D,
  db: DB,
  fullSchema?: any,
  bindings?: { env?: unknown; runtime?: unknown },
): ConcreteDomain<D, DB> {
  const baseSchema = fullSchema ?? resolveSchema(domainInstance);
  const actionMap = getStoredActionMap(domainInstance);
  const concrete: ConcreteDomain<D, DB> = {
    domain: domainInstance,
    db,
    schema: resolveSchema(domainInstance),
    context: (options?: DomainContextOptions) => domainInstance.context(options),
    contextString: (options?: DomainContextOptions) => domainInstance.contextString(options),
  };
  if (bindings?.env !== undefined && bindings?.runtime !== undefined) {
    const inheritedStack = readRuntimeActionStack(bindings.runtime);

    const buildActions = (stack: string[]) =>
      Object.fromEntries(
        Object.entries(actionMap).map(([key, action]) => [
          key,
          async (input: unknown) => {
            const execute = (action as any)?.execute;
            if (typeof execute !== "function") {
              throw new Error(`domain_action_not_executable:${key}`);
            }
            if (stack.includes(key)) {
              throw new Error(`domain_action_cycle:${key}`);
            }

            const nextStack = [...stack, key];
            const scopedRuntime = cloneRuntimeWithActionStack(
              bindings.runtime,
              nextStack,
            );

            const params: DomainActionExecuteParams<any, unknown, unknown> = {
              env: bindings.env,
              input,
              runtime: scopedRuntime,
            }

            return await execute(params);
          },
        ]),
      );

    ;(concrete as any).env = bindings.env;
    ;(concrete as any).actions = buildActions(inheritedStack);
  }
  return concrete;
}

export function materializeDomain<SubD extends DomainSchemaResult>(params: {
  rootDomain: DomainSchemaResult;
  subdomain: SubD;
  db: DomainDbFor<SubD>;
  bindings?: { env?: unknown; runtime?: unknown };
}): ActiveDomain<SubD, unknown> {
  const baseSchema = resolveSchema(params.rootDomain);
  const requiredSchema = resolveSchema(params.subdomain);
  assertDomainNamesInclude(params.rootDomain, params.subdomain);
  assertSchemaIncludes(baseSchema, requiredSchema);
  return createConcreteDomain(
    params.subdomain,
    params.db,
    baseSchema,
    params.bindings,
  ) as ActiveDomain<SubD, unknown>;
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

// Overload 2: builder API preserving the domain name literal.
export function domain<const Name extends string>(name: Name): DomainBuilder<{}, {}, Name, Name>;
export function domain<const Name extends string>(
  options: DomainConstructorOptions & { name: Name }
): DomainBuilder<{}, {}, Name, Name>;

// Overload 3: builder API fallback when the name has already been widened.
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
    return createBuilder<{}, {}, string, string>(baseEntities, {} as any, [], {
      name: opts.name,
      rootDir: opts.rootDir,
      packageName: opts.packageName,
      includes: [],
    });
  }

  // builder API - runtime state tracks accumulated dependencies
  // Support lazy includes for circular dependencies by storing references and resolving at schema()/toInstantSchema() time
  // AL preserves literal link keys from included domains
  function createBuilder<
    AE extends EntitiesDef,
    AL extends LinksDef<any> = LinksDef<any>,
    Name extends string = string,
    IncludedNames extends string = Name,
  >(
    deps: AE,
    linkDeps: AL,
    lazyIncludes: Array<() => DomainInstance<any, any, any> | DomainSchemaResult<any, any, any> | InstantSchemaDef<any, any, any> | undefined> = [],
    meta: DomainMeta
  ): DomainBuilder<AE, AL, Name, IncludedNames> {
    const builder = {
      includes<const OtherDomain extends DomainSchemaSource>(other: OtherDomain | (() => OtherDomain) | undefined) {
        type E2 = EntitiesOfDomainSource<OtherDomain>;
        type L2 = LinksOfDomainSource<OtherDomain>;
        type NextIncludedNames = IncludedNames | IncludedDomainNamesOf<OtherDomain>;
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
          return createBuilder<MergeEntities<AE, E2>, MergeLinks<AL, L2>, Name, NextIncludedNames>(
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
          return createBuilder<MergeEntities<AE, E2>, MergeLinks<AL, L2>, Name, NextIncludedNames>(
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
            return createBuilder<MergeEntities<AE, E2>, MergeLinks<AL, L2>, Name, NextIncludedNames>(
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
          return createBuilder<MergeEntities<AE, E2>, MergeLinks<AL, L2>, Name, NextIncludedNames>(mergedEntities, mergedLinks, lazyIncludes, nextMeta);
        } catch (e) {
          // If accessing entities throws, store as lazy
          const lazyGetter = () => other;
          const nextMeta = appendMetaInclude(meta, lazyGetter as DomainIncludeRef);
          // Preserve link literal keys
          return createBuilder<MergeEntities<AE, E2>, MergeLinks<AL, L2>, Name, NextIncludedNames>(
            deps as MergeEntities<AE, E2>,
            linkDeps as MergeLinks<AL, L2>,
            [...lazyIncludes, lazyGetter as any],
            nextMeta
          );
        }
      },
      withSchema<LE extends EntitiesDef, const LL extends LinksDef<any>>(def: {
        entities: LE;
        links: LL;
        rooms: RoomsDef;
      }): DomainSchemaResult<MergeEntities<AE, LE>, MergeLinks<AL, LL>, RoomsDef, {}, Name, IncludedNames> {
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
        
        const createDomainResult = <Actions extends DomainActionMap = {}>(
          seedActions: DomainActionRegistration[] = [],
          seedActionMap: Actions = {} as Actions,
        ): DomainSchemaResult<MergedEntitiesType, MergedLinksType, typeof def.rooms, Actions, Name, IncludedNames> => {
          type InstantSchemaResult = ReturnType<
            DomainSchemaResult<MergedEntitiesType, MergedLinksType, typeof def.rooms, Actions, Name, IncludedNames>["toInstantSchema"]
          >;
          const capturedEntities = { ...allEntities };
          const capturedLinks = cloneLinksDef(allLinks);
          const capturedRooms = cloneRoomsDef(def.rooms);
          let cachedInstantSchema: InstantSchemaResult | null = null;

          const instantSchema = () => {
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

            // Include base entities ($users, $files, $streams) that InstantDB manages
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
              $streams: i.entity({
                clientId: i.string().optional().indexed(),
                size: i.number().optional(),
                createdAt: i.date().optional().indexed(),
                updatedAt: i.date().optional().indexed(),
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
          };

          const result = {
            entities: Object.freeze({ ...allEntities }) as MergedEntitiesType,
            // Strip base phantom from public type so it's assignable to i.schema()
            links: Object.freeze(cloneLinksDef(allLinks)) as MergedLinksType,
            rooms: Object.freeze(cloneRoomsDef(def.rooms)),
            // Add originalEntities for type-safe access to original entity definitions
            originalEntities: Object.freeze({ ...allEntities }) as MergedEntitiesType,
            instantSchema,
            toInstantSchema: instantSchema,
          } as unknown as DomainSchemaResult<MergedEntitiesType, MergedLinksType, typeof def.rooms, Actions, Name, IncludedNames>;

          attachMeta(result as object, freezeMeta(meta));
          (result as any).context = (options?: DomainContextOptions) =>
            buildContext(result, options);
          (result as any).contextString = (options?: DomainContextOptions) =>
            contextToString(buildContext(result, options));
          (result as any).fromDB = <DB = any>(
            db: DB,
            bindings?: { env?: unknown; runtime?: unknown },
          ) => createConcreteDomain(result as any, db, resolveSchema(result), bindings);

          const reboundByAction = new Map<DomainActionRegistration, DomainActionRegistration>();
          const reboundActionMap = Object.fromEntries(
            Object.entries(seedActionMap).map(([key, action]) => {
              const rebound = bindAction(action, {
                name: action.name,
                domain: result,
                key,
              });
              reboundByAction.set(action, rebound);
              return [key, rebound] as const;
            }),
          ) as Actions;
          const reboundActions = seedActions.map((action) => {
            const rebound = reboundByAction.get(action);
            if (rebound) return rebound;
            return bindAction(action, {
              name: action.name,
              domain: result,
              key: getActionBinding(action)?.key,
            });
          });
          setStoredActions(result as any, [...reboundActions]);
          setStoredActionMap(result as any, reboundActionMap);
          (result as any).actions = getStoredActionMap(result as any);
          (result as any).withActions = (actionsInput: DomainActionCollection) => {
            const current = getStoredActions(result as any);
            const currentMap = getStoredActionMap(result as any);
            const additions = normalizeActionCollection(result as any, actionsInput);
            return createDomainResult(
              [...current, ...additions.actions],
              { ...currentMap, ...additions.actionMap },
            );
          };
          (result as any).getActions = () => [...getStoredActions(result as any)];
          (result as any).getActionMap = () => ({ ...getStoredActionMap(result as any) });
          (result as any).definition = () => result;

          return Object.freeze(result as any);
        };

        return createDomainResult([], {});
      },
      schema<LE extends EntitiesDef, const LL extends LinksDef<any>>(def: {
        entities: LE;
        links: LL;
        rooms: RoomsDef;
      }): DomainSchemaResult<MergeEntities<AE, LE>, MergeLinks<AL, LL>, RoomsDef, {}, Name, IncludedNames> {
        return this.withSchema(def);
      },
    };
    return builder as unknown as DomainBuilder<AE, AL, Name, IncludedNames>;
  }

  if (typeof arg === "string" && !arg.trim()) {
    throw new Error("domain() requires a name");
  }

  const meta: DomainMeta = { name: String(arg), includes: [] };

  return createBuilder<{}, {}, string, string>(baseEntities, {} as any, [], meta);
}

export function composeDomain(
  name: string | DomainConstructorOptions,
  includes: DomainInclude[] = [],
): DomainSchemaResult<any, any, any> {
  let builder: any = domain(name);
  for (const include of includes) {
    builder = builder.includes(include as any);
  }
  return builder.withSchema({ entities: {}, links: {}, rooms: {} });
}

/**
 * Define a domain action without changing the public action contract.
 *
 * Convention for new actions:
 *
 * `async execute({ runtime, input }) { "use step"; const domain = await runtime.use(myDomain); ... }`
 *
 * Actions remain callable directly, from nested `runtime.use(domain).actions.*`
 * composition, and from higher-level workflows that orchestrate them.
 */
export function defineDomainAction<
  OutputContract extends DomainActionOutputContract<any, any>,
  Env extends Record<string, unknown> = Record<string, unknown>,
  Input = unknown,
  Runtime = unknown,
  Domain = unknown,
>(
  action: Omit<
    DomainActionDefinition<
      Env,
      Input,
      DomainActionRuntimeOutput<OutputContract>,
      Runtime,
      Domain,
      OutputContract
    >,
    "output"
  > & {
    output: OutputContract;
  },
): DomainActionDefinition<
  Env,
  Input,
  DomainActionRuntimeOutput<OutputContract>,
  Runtime,
  Domain,
  OutputContract
>;
export function defineDomainAction<
  Env extends Record<string, unknown> = Record<string, unknown>,
  Input = unknown,
  Output = unknown,
  Runtime = unknown,
  Domain = unknown,
>(
  action: Omit<
    DomainActionDefinition<Env, Input, Output, Runtime, Domain, never>,
    "output"
  > & {
    output?: never;
  },
): DomainActionDefinition<Env, Input, Output, Runtime, Domain, never>;
export function defineDomainAction(
  action: DomainActionDefinition<any, any, any, any, any, any>,
): DomainActionDefinition<any, any, any, any, any, any> {
  return action;
}

export const defineAction = defineDomainAction;

export function getDomainActions(source: unknown): DomainActionRegistration[] {
  return getStoredActions(source);
}

export function getDomainActionBinding(source: unknown): { name: string; domain: unknown; key?: string } | null {
  return getActionBinding(source);
}


