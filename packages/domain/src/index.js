import { i } from "@instantdb/core";
import { filterDomainDoc, parseDomainDoc, renderDomainDoc, } from "./domain-doc.js";
export { parseDomainDoc, renderDomainDoc, filterDomainDoc, } from "./domain-doc.js";
let domainDocLoader = null;
export function configureDomainDocLoader(loader) {
    domainDocLoader = loader ?? null;
}
const EKAIROS_META = Symbol.for("@ekairos/domain/meta");
function getMeta(source) {
    if (!source || typeof source !== "object")
        return null;
    return source[EKAIROS_META] ?? null;
}
function attachMeta(target, meta) {
    Object.defineProperty(target, EKAIROS_META, {
        value: meta,
        enumerable: false,
        configurable: false,
        writable: false,
    });
}
function listKeys(value) {
    if (!value || typeof value !== "object")
        return [];
    return Object.keys(value).filter((key) => !key.startsWith("$"));
}
function resolveSchema(source) {
    if (!source)
        return null;
    if (typeof source.toInstantSchema === "function")
        return source.toInstantSchema();
    if (typeof source.schema === "function")
        return source.schema();
    return {
        entities: source.entities ?? {},
        links: source.links ?? {},
        rooms: source.rooms ?? {},
    };
}
function collectSchemaKeys(schema) {
    return {
        entities: Object.keys(schema?.entities ?? {}),
        links: Object.keys(schema?.links ?? {}),
        rooms: Object.keys(schema?.rooms ?? {}),
    };
}
function assertSchemaIncludes(fullSchema, requiredSchema) {
    if (!fullSchema || !requiredSchema)
        return;
    const full = collectSchemaKeys(fullSchema);
    const required = collectSchemaKeys(requiredSchema);
    const missingEntities = required.entities.filter((k) => !full.entities.includes(k));
    const missingLinks = required.links.filter((k) => !full.links.includes(k));
    const missingRooms = required.rooms.filter((k) => !full.rooms.includes(k));
    if (missingEntities.length || missingLinks.length || missingRooms.length) {
        const parts = [];
        if (missingEntities.length)
            parts.push(`entities: ${missingEntities.join(", ")}`);
        if (missingLinks.length)
            parts.push(`links: ${missingLinks.join(", ")}`);
        if (missingRooms.length)
            parts.push(`rooms: ${missingRooms.join(", ")}`);
        throw new Error(`ConcreteDomain: schema is missing required keys (${parts.join(" | ")})`);
    }
}
function createConcreteDomain(domainInstance, db, fullSchema) {
    const baseSchema = fullSchema ?? resolveSchema(domainInstance);
    const concrete = {
        domain: domainInstance,
        db,
        schema: resolveSchema(domainInstance),
        context: (options) => domainInstance.context(options),
        contextString: (options) => domainInstance.contextString(options),
        fromDomain(subdomain) {
            const requiredSchema = resolveSchema(subdomain);
            assertSchemaIncludes(baseSchema, requiredSchema);
            return createConcreteDomain(subdomain, db, baseSchema);
        },
    };
    return concrete;
}
function loadDomainDoc(scope, meta) {
    if (!domainDocLoader)
        return null;
    try {
        return domainDocLoader({ scope, meta }) ?? null;
    }
    catch {
        return null;
    }
}
function normalizeDoc(docInfo, options) {
    if (!docInfo?.doc)
        return { doc: null, docPath: docInfo?.docPath };
    const parsed = parseDomainDoc(docInfo.doc);
    if (!parsed)
        return { doc: docInfo.doc, docPath: docInfo.docPath };
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
function buildRegistryEntries(meta, options) {
    if (!meta)
        return [];
    const seen = new Set();
    const queue = [...meta.includes];
    const entries = [];
    while (queue.length > 0) {
        const getter = queue.shift();
        if (!getter)
            continue;
        let child = null;
        try {
            child = getter();
        }
        catch {
            child = null;
        }
        if (!child || typeof child !== "object")
            continue;
        if (seen.has(child))
            continue;
        seen.add(child);
        const childMeta = getMeta(child);
        const schema = resolveSchema(child);
        const docInfo = loadDomainDoc("subdomain", childMeta);
        const includeSchema = options?.includeSchemas !== false;
        const normalizedDoc = normalizeDoc(docInfo, {
            entities: listKeys(schema?.entities),
            titlePrefix: "Subdomain",
            includeSubdomains: false,
        });
        if (childMeta?.name) {
            entries.push({
                name: childMeta.name,
                entities: listKeys(schema?.entities),
                links: listKeys(schema?.links),
                rooms: listKeys(schema?.rooms),
                actions: listKeys(child?.actions),
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
function buildContext(source, options) {
    const meta = getMeta(source);
    const schema = resolveSchema(source);
    const registry = buildRegistryEntries(meta, options);
    const docInfo = loadDomainDoc("root", meta);
    const includeSchema = options?.includeSchemas !== false;
    const normalizedDoc = normalizeDoc(docInfo, {
        subdomains: registry.map((entry) => entry.name ?? "").filter(Boolean),
        titlePrefix: "Domain",
        includeSubdomains: false,
    });
    return {
        name: meta?.name,
        entities: listKeys(schema?.entities),
        links: listKeys(schema?.links),
        rooms: listKeys(schema?.rooms),
        actions: listKeys(options?.actions ?? source?.actions),
        meta: options?.meta ?? source?.meta,
        schema: includeSchema ? schema : undefined,
        doc: normalizedDoc.doc ?? null,
        docPath: normalizedDoc.docPath,
        registry,
    };
}
function contextToString(context) {
    const lines = [];
    const pushSection = (title) => {
        lines.push("");
        lines.push(`# ${title}`);
    };
    lines.push("# Domain Context");
    if (context.name)
        lines.push(`Name: ${context.name}`);
    if (context.entities?.length) {
        lines.push(`Entities: ${context.entities.join(", ")}`);
    }
    if (context.links?.length) {
        lines.push(`Links: ${context.links.join(", ")}`);
    }
    if (context.rooms?.length) {
        lines.push(`Rooms: ${context.rooms.join(", ")}`);
    }
    if (context.actions?.length) {
        lines.push(`Actions: ${context.actions.join(", ")}`);
    }
    if (context.doc) {
        pushSection("DOMAIN.md (root)");
        lines.push(context.doc);
    }
    if (context.registry?.length) {
        pushSection("Subdomains");
        for (const entry of context.registry) {
            if (entry.doc) {
                lines.push("");
                lines.push(entry.doc);
                continue;
            }
            lines.push("");
            lines.push(`## ${entry.name ?? "unknown"}`);
            if (entry.entities?.length) {
                lines.push(`Entities: ${entry.entities.join(", ")}`);
            }
            if (entry.links?.length) {
                lines.push(`Links: ${entry.links.join(", ")}`);
            }
            if (entry.rooms?.length) {
                lines.push(`Rooms: ${entry.rooms.join(", ")}`);
            }
            if (entry.actions?.length) {
                lines.push(`Actions: ${entry.actions.join(", ")}`);
            }
        }
    }
    return lines.join("\n").trim() + "\n";
}
function makeInstance(def) {
    const meta = {
        name: def.name,
        rootDir: def.rootDir,
        packageName: def.packageName,
        includes: [],
    };
    let instance;
    function schema() {
        return i.schema({
            entities: def.entities,
            links: def.links,
            rooms: def.rooms,
        });
    }
    function compose(other) {
        const otherDef = "schema" in other
            ? { entities: other.entities, links: other.links, rooms: other.rooms }
            : other;
        const mergedEntities = { ...def.entities, ...otherDef.entities };
        const mergedLinks = { ...def.links, ...otherDef.links };
        const mergedRooms = { ...def.rooms, ...otherDef.rooms };
        const composed = makeInstance({
            entities: mergedEntities,
            links: mergedLinks,
            rooms: mergedRooms,
            name: def.name,
            rootDir: def.rootDir,
            packageName: def.packageName,
        });
        const composedMeta = getMeta(composed);
        if (composedMeta) {
            composedMeta.includes.push(() => instance, () => other);
        }
        return composed;
    }
    instance = {
        entities: def.entities,
        links: def.links,
        rooms: def.rooms,
        schema,
        compose,
    };
    attachMeta(instance, meta);
    return instance;
}
// Impl
export function domain(arg) {
    // Default include: start with an empty entities object
    // Base entities ($users, $files) are added at toInstantSchema() time to ensure they're always available
    // This allows links to reference them even when they're not explicitly defined in domains
    const base = i.schema({ entities: {}, links: {}, rooms: {} });
    const baseEntities = { ...base.entities };
    if (arg === undefined || arg === null) {
        throw new Error("domain() requires a name");
    }
    if (typeof arg === "object" && arg !== null) {
        const maybeDef = arg;
        if ("entities" in maybeDef && "links" in maybeDef && "rooms" in maybeDef) {
            if (!maybeDef.name) {
                throw new Error("domain() requires a name");
            }
            // classic API path: def provided directly
            return makeInstance(maybeDef);
        }
        const opts = arg;
        if (!opts.name) {
            throw new Error("domain() requires a name");
        }
        return createBuilder(baseEntities, {}, [], {
            name: opts.name,
            rootDir: opts.rootDir,
            packageName: opts.packageName,
            includes: [],
        });
    }
    // builder API - runtime state tracks accumulated dependencies
    // Support lazy includes for circular dependencies by storing references and resolving at schema()/toInstantSchema() time
    // AL preserves literal link keys from included domains
    function createBuilder(deps, linkDeps, lazyIncludes = [], meta) {
        return {
            includes(other) {
                // Support lazy includes via function for circular dependencies
                if (typeof other === 'function') {
                    const lazyGetter = () => {
                        try {
                            return other();
                        }
                        catch (e) {
                            return undefined;
                        }
                    };
                    meta.includes.push(lazyGetter);
                    // Preserve link literal keys using MergeLinks
                    return createBuilder(deps, linkDeps, [...lazyIncludes, lazyGetter], meta);
                }
                // If other is undefined (circular dependency), store a lazy getter
                // Entities will be resolved from app domain composition at toInstantSchema() time
                if (!other || other === undefined) {
                    // Create a lazy getter that returns undefined
                    // Entities will be available from app domain's merged entities when toInstantSchema() is called
                    const lazyGetter = () => undefined;
                    meta.includes.push(lazyGetter);
                    // Preserve link literal keys
                    return createBuilder(deps, linkDeps, [...lazyIncludes, lazyGetter], meta);
                }
                // Try to get entities and links immediately
                try {
                    const entities = other.entities;
                    if (!entities) {
                        // If entities don't exist yet, store as lazy
                        const lazyGetter = () => other;
                        meta.includes.push(lazyGetter);
                        // Preserve link literal keys
                        return createBuilder(deps, linkDeps, [...lazyIncludes, lazyGetter], meta);
                    }
                    const links = other.links;
                    const mergedEntities = { ...deps, ...entities };
                    // Preserve literal link keys by merging directly (not casting to LinksDef)
                    const mergedLinks = (links ? { ...linkDeps, ...links } : { ...linkDeps });
                    meta.includes.push(() => other);
                    return createBuilder(mergedEntities, mergedLinks, lazyIncludes, meta);
                }
                catch (e) {
                    // If accessing entities throws, store as lazy
                    const lazyGetter = () => other;
                    meta.includes.push(lazyGetter);
                    // Preserve link literal keys
                    return createBuilder(deps, linkDeps, [...lazyIncludes, lazyGetter], meta);
                }
            },
            schema(def) {
                // Resolve lazy includes at schema() time (when all domains should be initialized)
                // This handles circular dependencies by deferring entity resolution
                let resolvedDeps = { ...deps };
                // Preserve literal link keys from accumulated links
                let resolvedLinks = { ...linkDeps };
                for (const lazyGetter of lazyIncludes) {
                    try {
                        const other = lazyGetter();
                        if (other) {
                            const entities = other.entities;
                            if (entities) {
                                resolvedDeps = { ...resolvedDeps, ...entities };
                            }
                            const links = other.links;
                            if (links) {
                                // Merge links preserving literal keys
                                resolvedLinks = { ...resolvedLinks, ...links };
                            }
                        }
                    }
                    catch (e) {
                        // If lazy resolution fails, continue - entities might be available via string references
                        // This is expected for circular dependencies that will be resolved when all domains are composed
                    }
                }
                // Runtime merge for output; compile-time validation handled by types above
                const allEntities = { ...resolvedDeps, ...def.entities };
                // allLinks contains merged links from included domains + current domain
                // Preserve literal link keys (owner, related, parent, etc.) by using MergeLinks
                const allLinks = { ...resolvedLinks, ...def.links };
                const result = {
                    entities: allEntities,
                    // Strip base phantom from public type so it's assignable to i.schema()
                    links: allLinks,
                    rooms: def.rooms,
                    // Add originalEntities for type-safe access to original entity definitions
                    originalEntities: allEntities,
                    toInstantSchema: (() => {
                        // Capture allEntities and allLinks in closure to avoid TypeScript scoping issues
                        const capturedEntities = allEntities;
                        const capturedLinks = allLinks;
                        return () => {
                            // i is already imported at the top of the file
                            // Final resolution: capturedEntities contains merged entities from all includes()
                            // For app domain, this includes all domains, so all entities are available
                            // Resolve any remaining lazy includes that couldn't be resolved at schema() time
                            let finalEntities = { ...capturedEntities };
                            // Preserve literal link keys from capturedLinks
                            let finalLinks = { ...capturedLinks };
                            // Try to resolve lazy includes one more time (domains should be initialized by now)
                            for (const lazyGetter of lazyIncludes) {
                                try {
                                    const other = lazyGetter();
                                    if (other) {
                                        const entities = other.entities;
                                        if (entities) {
                                            // Merge entities that weren't available during schema() call
                                            finalEntities = { ...finalEntities, ...entities };
                                        }
                                        const links = other.links;
                                        if (links) {
                                            // Merge links preserving literal keys (owner, related, parent, etc.)
                                            finalLinks = { ...finalLinks, ...links };
                                        }
                                    }
                                }
                                catch (e) {
                                    // If still can't resolve, entities should already be in allEntities from app domain composition
                                }
                            }
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
                            const allEntitiesWithBase = { ...baseEntities, ...finalEntities };
                            // Create schema with merged links - preserve literal link keys
                            // The actual links object has literal keys (owner, related, parent, etc.)
                            // that need to be preserved for query validation
                            const schemaResult = i.schema({
                                entities: allEntitiesWithBase,
                                links: finalLinks,
                                rooms: def.rooms,
                            });
                            // Return schema result - i.schema() enriches entities with link labels automatically
                            // The type system should preserve this enrichment through the return type of toInstantSchema()
                            // which uses ReturnType<typeof i.schema<WithBase<E>, L, R>> where L is MergeLinks<AL, LL>
                            // This preserves both the enriched entities and the literal link keys
                            return schemaResult;
                        };
                    })(),
                };
                attachMeta(result, meta);
                result.context = (options) => buildContext(result, options);
                result.contextString = (options) => contextToString(buildContext(result, options));
                result.fromDB = (db) => createConcreteDomain(result, db, resolveSchema(result));
                return result;
            },
        };
    }
    if (typeof arg === "string" && !arg.trim()) {
        throw new Error("domain() requires a name");
    }
    const meta = { name: String(arg), includes: [] };
    return createBuilder(baseEntities, {}, [], meta);
}
export function composeDomain(name, includes = []) {
    let builder = domain(name);
    for (const include of includes) {
        builder = builder.includes(include);
    }
    return builder.schema({ entities: {}, links: {}, rooms: {} });
}
