import { i } from "@instantdb/core";
import type { EntitiesDef, LinksDef, RoomsDef, InstantSchemaDef, EntityDef } from "@instantdb/core";
export { parseDomainDoc, renderDomainDoc, filterDomainDoc, type DomainDoc, type DomainDocEntity, type DomainDocSubdomain, type DomainDocSection, type DomainDocFilter, type DomainDocRenderOptions, type ParsedDomainDoc, } from "./domain-doc.js";
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
export type DomainInclude = DomainInstance<any, any, any> | DomainSchemaResult<any, any, any> | InstantSchemaDef<any, any, any> | (() => DomainInstance<any, any, any> | DomainSchemaResult<any, any, any> | InstantSchemaDef<any, any, any> | undefined) | undefined;
export declare function configureDomainDocLoader(loader?: DomainDocLoader | null): void;
export type DomainContextEntry = {
    name?: string;
    entities?: string[];
    links?: string[];
    rooms?: string[];
    actions?: string[];
    schema?: unknown;
    doc?: string | null;
    docPath?: string | null;
};
export type DomainContext = DomainContextEntry & {
    meta?: Record<string, unknown>;
    registry: DomainContextEntry[];
};
export type DomainContextOptions = {
    actions?: Record<string, unknown>;
    meta?: Record<string, unknown>;
    includeSchemas?: boolean;
};
export type DomainDefinition<E extends EntitiesDef, L extends LinksDef<E>, R extends RoomsDef> = DomainConstructorOptions & {
    entities: E;
    links: L;
    rooms: R;
};
export type DomainInstance<E extends EntitiesDef, L extends LinksDef<E>, R extends RoomsDef> = DomainDefinition<E, L, R> & {
    schema: () => any;
    compose: <E2 extends EntitiesDef, L2 extends LinksDef<E2>, R2 extends RoomsDef>(other: DomainInstance<E2, L2, R2> | DomainDefinition<E2, L2, R2>) => DomainInstance<E & E2, LinksDef<E & E2>, R & R2>;
};
export type SchemaOf<D extends DomainDefinition<any, any, any> | DomainSchemaResult<any, any, any>> = D extends DomainSchemaResult<any, any, any> ? ReturnType<D["toInstantSchema"]> : InstantSchemaDef<D["entities"], LinksDef<D["entities"]>, D["rooms"]>;
type EntitiesOf<S> = S extends InstantSchemaDef<infer E, any, any> ? E : never;
type LinksOf<S> = S extends InstantSchemaDef<any, infer L, any> ? L : never;
/**
 * Verifies that Full schema includes all entities and links from Required schema.
 * Returns Full if compatible, never otherwise.
 */
type EnsureIncludesSchema<Full extends InstantSchemaDef<any, any, any>, Required extends InstantSchemaDef<any, any, any>> = {
    [K in keyof EntitiesOf<Required>]: K extends keyof EntitiesOf<Full> ? (EntitiesOf<Full>[K] extends EntitiesOf<Required>[K] ? unknown : never) : never;
}[keyof EntitiesOf<Required>] extends never ? ({
    [K in keyof LinksOf<Required>]: K extends keyof LinksOf<Full> ? (LinksOf<Full>[K] extends LinksOf<Required>[K] ? unknown : never) : never;
}[keyof LinksOf<Required>] extends never ? Full : never) : never;
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
export type CompatibleSchemaForDomain<S extends InstantSchemaDef<any, any, any>, RequiredDomain extends DomainDefinition<any, any, any> | DomainSchemaResult<any, any, any> | DomainInstance<any, any, any>> = EnsureIncludesSchema<S, SchemaOf<RequiredDomain>>;
type MergeEntities<A extends EntitiesDef, B extends EntitiesDef> = {
    [K in keyof A | keyof B]: K extends keyof A ? A[K] : K extends keyof B ? B[K] : never;
};
type MergeLinks<A extends LinksDef<any>, B extends LinksDef<any>> = {
    [K in keyof A | keyof B]: K extends keyof A ? A[K] : K extends keyof B ? B[K] : never;
};
export type DomainSchemaResult<E extends EntitiesDef = EntitiesDef, L extends LinksDef<any> = LinksDef<any>, R extends RoomsDef = RoomsDef> = ReturnType<typeof i.schema<WithBase<E>, L, R>> & {
    readonly originalEntities: E;
    toInstantSchema: () => ReturnType<typeof i.schema<WithBase<E>, L, R>>;
    context: (options?: DomainContextOptions) => DomainContext;
    contextString: (options?: DomainContextOptions) => string;
    fromDB: <DB = any>(db: DB) => ConcreteDomain<DomainSchemaResult<E, L, R>, DB>;
};
export type ConcreteDomain<D extends DomainSchemaResult = DomainSchemaResult, DB = any> = {
    domain: D;
    db: DB;
    schema: ReturnType<D["toInstantSchema"]>;
    context: (options?: DomainContextOptions) => DomainContext;
    contextString: (options?: DomainContextOptions) => string;
    fromDomain: <SubD extends DomainSchemaResult>(subdomain: SubD) => ConcreteDomain<SubD, DB>;
};
type BaseEntitiesPhantom = {
    $users: EntityDef<any, any, any>;
    $files: EntityDef<any, any, any>;
};
type WithBase<E extends EntitiesDef> = MergeEntities<E, BaseEntitiesPhantom>;
export type DomainBuilder<AccumE extends EntitiesDef, AccumL extends LinksDef<any> = LinksDef<any>> = {
    includes<E2 extends EntitiesDef, L2 extends LinksDef<any> = {}>(other: DomainInstance<E2, L2, any> | DomainSchemaResult<E2, L2, any> | InstantSchemaDef<E2, L2, any> | (() => DomainInstance<E2, L2, any> | DomainSchemaResult<E2, L2, any> | InstantSchemaDef<E2, L2, any>) | undefined): DomainBuilder<MergeEntities<AccumE, E2>, MergeLinks<AccumL, L2>>;
    schema<LE extends EntitiesDef, const LL extends LinksDef<WithBase<MergeEntities<AccumE, LE>>>>(def: {
        entities: LE;
        links: LL;
        rooms: RoomsDef;
    }): DomainSchemaResult<MergeEntities<AccumE, LE>, MergeLinks<AccumL, LL>, RoomsDef>;
};
export declare function domain<E extends EntitiesDef, L extends LinksDef<E>, R extends RoomsDef>(def: DomainDefinition<E, L, R>): DomainInstance<E, L, R>;
export declare function domain(name?: string | DomainConstructorOptions): DomainBuilder<{}, {}>;
export declare function composeDomain(name: string | DomainConstructorOptions, includes?: DomainInclude[]): DomainSchemaResult<any, any, any>;
