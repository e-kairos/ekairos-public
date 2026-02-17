import { configureDomainDocLoader } from "./index.js";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
let runtimeDomainConfig = null;
let docLoaderConfigured = false;
let runtimeProjectId = null;
const runtimeResolverSymbol = Symbol.for("ekairos.domain.runtimeResolver");
let runtimeResolver = null;
function getGlobalRuntimeResolver() {
    if (typeof globalThis === "undefined")
        return null;
    return globalThis[runtimeResolverSymbol] ?? null;
}
function setGlobalRuntimeResolver(resolver) {
    if (typeof globalThis === "undefined")
        return;
    globalThis[runtimeResolverSymbol] = resolver;
}
function configureRuntimeResolver(resolver) {
    runtimeResolver = resolver ?? null;
    setGlobalRuntimeResolver(runtimeResolver);
}
function getRuntimeResolver() {
    return runtimeResolver ?? getGlobalRuntimeResolver();
}
function ensureDomainDocLoader() {
    if (docLoaderConfigured)
        return;
    if (typeof process === "undefined" || !process.versions?.node)
        return;
    const req = createRequire(import.meta.url);
    const cache = new Map();
    const readDoc = (absPath) => {
        if (cache.has(absPath))
            return cache.get(absPath) ?? null;
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
        }
        catch {
            cache.set(absPath, null);
            return null;
        }
    };
    const readDocFromRoot = (rootDir) => {
        const absRoot = isAbsolute(rootDir) ? rootDir : resolve(process.cwd(), rootDir);
        return readDoc(join(absRoot, "DOMAIN.md"));
    };
    const readDocFromPackage = (packageName) => {
        try {
            const pkgJson = req.resolve(`${packageName}/package.json`);
            const pkgRoot = dirname(pkgJson);
            return readDoc(join(pkgRoot, "DOMAIN.md"));
        }
        catch {
            return null;
        }
    };
    const loader = ({ scope, meta }) => {
        if (scope === "root") {
            return readDoc(join(process.cwd(), "DOMAIN.md"));
        }
        if (meta?.rootDir) {
            const fromRoot = readDocFromRoot(meta.rootDir);
            if (fromRoot)
                return fromRoot;
        }
        if (meta?.packageName) {
            const fromPackage = readDocFromPackage(meta.packageName);
            if (fromPackage)
                return fromPackage;
        }
        if (meta?.name) {
            const inferred = readDocFromPackage(`@ekairos/${meta.name}`);
            if (inferred)
                return inferred;
        }
        return null;
    };
    configureDomainDocLoader(loader);
    docLoaderConfigured = true;
}
function normalizeProjectId(value) {
    return typeof value === "string" ? value.trim() : "";
}
function resolveProjectIdFromEnv() {
    if (typeof process === "undefined" || !process.env)
        return "";
    return normalizeProjectId(process.env.EKAIROS_PROJECT_ID);
}
function resolveSchema(domain) {
    if (!domain)
        return null;
    if (typeof domain.toInstantSchema === "function")
        return domain.toInstantSchema();
    if (typeof domain.schema === "function")
        return domain.schema();
    return {
        entities: domain.entities ?? {},
        links: domain.links ?? {},
        rooms: domain.rooms ?? {},
    };
}
function resolveContext(domain) {
    if (!domain || typeof domain.context !== "function")
        return null;
    return domain.context();
}
function resolveContextString(domain) {
    if (!domain || typeof domain.contextString !== "function")
        return "";
    return domain.contextString();
}
function resolveDb(resolved) {
    if (!resolved)
        return null;
    if (typeof resolved === "object" && "db" in resolved) {
        return resolved.db;
    }
    return resolved;
}
export function configureRuntime(params) {
    const threads = params.threads ?? [];
    const domainConfig = params.domain;
    let didSetup = false;
    const config = {
        threads,
        runtime: params.runtime,
        domain: domainConfig,
        setup() {
            if (didSetup)
                return;
            didSetup = true;
            runtimeDomainConfig = domainConfig ?? null;
            ensureDomainDocLoader();
            if (params.runtime) {
                configureRuntimeResolver(params.runtime);
            }
            const envProjectId = resolveProjectIdFromEnv();
            if (envProjectId)
                runtimeProjectId = envProjectId;
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
export function getRuntimeConfig() {
    return runtimeDomainConfig;
}
export function getRuntimeProjectId() {
    return runtimeProjectId ?? resolveProjectIdFromEnv();
}
export async function resolveRuntime(domain, env) {
    const runtimeDomain = (domain ?? null);
    if (!runtimeDomain) {
        throw new Error("Runtime requires an explicit domain. Call resolveRuntime(domain, env) with a concrete app domain.");
    }
    const resolver = getRuntimeResolver();
    if (!resolver) {
        throw new Error([
            "Runtime is not configured.",
            "",
            "Create an app-level runtime bootstrap (by convention: src/runtime.ts)",
            "and call configureRuntime({ runtime, domain }).",
        ].join("\n"));
    }
    const resolved = await resolver(env, runtimeDomain);
    const db = resolveDb(resolved);
    if (!db) {
        throw new Error("Runtime resolver did not return a database instance.");
    }
    const schema = resolveSchema(runtimeDomain);
    const context = resolveContext(runtimeDomain);
    const contextString = resolveContextString(runtimeDomain);
    const runtimeMeta = {
        domain: runtimeDomain,
        schema: schema,
        context,
        contextString,
    };
    return {
        db,
        meta: () => runtimeMeta,
    };
}
export const runtime = resolveRuntime;
//# sourceMappingURL=runtime.js.map