import { promises as fs } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type ComponentSource = {
  name: string;
  relativePath: string;
  absolutePath: string;
  rawContent: string;
  content: string;
};

export type ComponentDoc = {
  name: string;
  category: string;
  title: string;
  description: string;
  path: string;
  body: string;
};

export type ComponentCatalogEntry = {
  name: string;
  title: string;
  description: string;
  category: string;
  sourcePath: string;
  docsPath: string | null;
};

const componentsRoot = join(process.cwd(), "components", "ai-elements");
const docsRoot = join(process.cwd(), "content", "components");
const packageJsonPath = join(process.cwd(), "package.json");

let cachedSources: ComponentSource[] | null = null;
let cachedDocs: Map<string, ComponentDoc> | null = null;
let cachedCatalog: ComponentCatalogEntry[] | null = null;
let cachedPackageVersions: Map<string, string> | null = null;

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function stripExt(value: string): string {
  return value.replace(/\.[^.]+$/i, "");
}

function titleCaseFromName(name: string): string {
  return name
    .split("-")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function stripQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, "").trim();
}

function parseFrontmatter(input: string): {
  data: Record<string, string>;
  body: string;
} {
  if (!input.startsWith("---\n")) {
    return { data: {}, body: input };
  }

  const end = input.indexOf("\n---", 4);
  if (end === -1) {
    return { data: {}, body: input };
  }

  const raw = input.slice(4, end).trim();
  const body = input.slice(end + 4).trimStart();
  const data: Record<string, string> = {};

  for (const line of raw.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = stripQuotes(line.slice(idx + 1).trim());
    if (key) data[key] = value;
  }

  return { data, body };
}

function transformSourceContent(raw: string): string {
  return raw
    .replaceAll(
      "@repo/shadcn-ui/components/ui/",
      "@/components/ui/",
    )
    .replaceAll("@repo/shadcn-ui/lib/utils", "@/lib/utils")
    .replaceAll("@repo/elements/", "@/components/ai-elements/");
}

async function readPackageVersions() {
  if (cachedPackageVersions) return cachedPackageVersions;
  const map = new Map<string, string>();
  const raw = await fs.readFile(packageJsonPath, "utf8");
  const json = JSON.parse(raw) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  for (const [name, version] of Object.entries(json.dependencies ?? {})) {
    map.set(name, version);
  }
  for (const [name, version] of Object.entries(json.devDependencies ?? {})) {
    if (!map.has(name)) map.set(name, version);
  }
  cachedPackageVersions = map;
  return map;
}

async function walkFiles(rootDir: string): Promise<string[]> {
  const out: string[] = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const abs = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
      } else {
        out.push(abs);
      }
    }
  }
  return out;
}

export async function getComponentSources(): Promise<ComponentSource[]> {
  if (cachedSources) return cachedSources;
  const files = await walkFiles(componentsRoot);
  const out: ComponentSource[] = [];

  for (const abs of files) {
    if (!abs.endsWith(".tsx")) continue;
    const rel = normalizePath(abs.slice(componentsRoot.length + 1));
    const name = stripExt(rel.split("/").at(-1) ?? rel);
    const rawContent = await fs.readFile(abs, "utf8");
    out.push({
      name,
      relativePath: rel,
      absolutePath: abs,
      rawContent,
      content: transformSourceContent(rawContent),
    });
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  cachedSources = out;
  return out;
}

export async function getComponentDocs(): Promise<Map<string, ComponentDoc>> {
  if (cachedDocs) return cachedDocs;
  const files = await walkFiles(docsRoot);
  const map = new Map<string, ComponentDoc>();

  for (const abs of files) {
    if (!abs.endsWith(".mdx")) continue;
    const rel = normalizePath(abs.slice(docsRoot.length + 1));
    const name = stripExt(rel.split("/").at(-1) ?? rel);
    const categoryRaw = rel.split("/")[0] ?? "general";
    const category = categoryRaw.replace(/[()]/g, "");
    const raw = await fs.readFile(abs, "utf8");
    const parsed = parseFrontmatter(raw);
    map.set(name, {
      name,
      category,
      title: parsed.data.title || titleCaseFromName(name),
      description:
        parsed.data.description ||
        `Documentation for ${titleCaseFromName(name)}.`,
      path: rel,
      body: parsed.body,
    });
  }

  cachedDocs = map;
  return map;
}

export async function getComponentCatalog(): Promise<ComponentCatalogEntry[]> {
  if (cachedCatalog) return cachedCatalog;
  const [sources, docs] = await Promise.all([
    getComponentSources(),
    getComponentDocs(),
  ]);
  const out: ComponentCatalogEntry[] = sources.map((source) => {
    const doc = docs.get(source.name);
    return {
      name: source.name,
      title: doc?.title ?? titleCaseFromName(source.name),
      description:
        doc?.description ??
        `Thread element component ${titleCaseFromName(source.name)}.`,
      category: doc?.category ?? "general",
      sourcePath: source.relativePath,
      docsPath: doc?.path ?? null,
    };
  });
  out.sort((a, b) => a.name.localeCompare(b.name));
  cachedCatalog = out;
  return out;
}

function extractSpecifiers(code: string): string[] {
  const specifiers = new Set<string>();
  const importExportRegex =
    /(?:import|export)\s+(?:[\s\S]+?)?\s+from\s+["'`]([^"'`]+)["'`]/g;
  const sideEffectRegex = /import\s+["'`]([^"'`]+)["'`]/g;
  const dynamicRegex = /import\(\s*["'`]([^"'`]+)["'`]\s*\)/g;

  for (const rx of [importExportRegex, sideEffectRegex, dynamicRegex]) {
    rx.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rx.exec(code)) !== null) {
      if (match[1]) specifiers.add(match[1]);
    }
  }
  return Array.from(specifiers);
}

function packageNameFromSpecifier(specifier: string): string {
  if (specifier.startsWith("@")) {
    const [scope, name] = specifier.split("/");
    return scope && name ? `${scope}/${name}` : specifier;
  }
  return specifier.split("/")[0] ?? specifier;
}

function registryDependencyForUiComponent(componentName: string): string {
  return `https://ui.shadcn.com/r/styles/default/${componentName}.json`;
}

function registryDependencyForLocalComponent(
  origin: string | null,
  componentName: string,
): string {
  const path = `/api/registry/${componentName}.json`;
  if (!origin) return path;
  return `${origin}${path}`;
}

function resolveRelativeComponentName(
  fromSource: ComponentSource,
  specifier: string,
  byPath: Map<string, ComponentSource>,
): string | null {
  const baseDir = dirname(fromSource.relativePath);
  const resolved = normalizePath(
    stripExt(resolve("/", baseDir, specifier)).slice(1),
  );
  const hit = byPath.get(resolved);
  return hit?.name ?? null;
}

export async function analyzeComponentDependencies(params: {
  source: ComponentSource;
  allSources: ComponentSource[];
  origin: string | null;
}) {
  const packageVersions = await readPackageVersions();
  const dependencies = new Set<string>();
  const registryDependencies = new Set<string>();

  const byPath = new Map<string, ComponentSource>();
  const byName = new Map<string, ComponentSource>();
  for (const source of params.allSources) {
    byPath.set(stripExt(source.relativePath), source);
    byName.set(source.name, source);
  }

  for (const specifier of extractSpecifiers(params.source.content)) {
    if (specifier.startsWith("@/components/ui/")) {
      const uiName = specifier.split("/").at(-1);
      if (uiName) {
        registryDependencies.add(registryDependencyForUiComponent(uiName));
      }
      continue;
    }

    if (specifier.startsWith("@/components/ai-elements/")) {
      const localName = stripExt(specifier.split("/").at(-1) ?? "");
      if (localName && byName.has(localName)) {
        registryDependencies.add(
          registryDependencyForLocalComponent(params.origin, localName),
        );
      }
      continue;
    }

    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      const localName = resolveRelativeComponentName(
        params.source,
        specifier,
        byPath,
      );
      if (localName) {
        registryDependencies.add(
          registryDependencyForLocalComponent(params.origin, localName),
        );
      }
      continue;
    }

    if (specifier.startsWith("@/")) {
      continue;
    }

    if (specifier.startsWith("node:")) {
      continue;
    }

    const pkg = packageNameFromSpecifier(specifier);
    if (!pkg) continue;
    const version = packageVersions.get(pkg);
    dependencies.add(version ? `${pkg}@${version}` : pkg);
  }

  return {
    dependencies: Array.from(dependencies).sort((a, b) => a.localeCompare(b)),
    registryDependencies: Array.from(registryDependencies).sort((a, b) =>
      a.localeCompare(b),
    ),
  };
}
