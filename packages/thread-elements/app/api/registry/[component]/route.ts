import { NextRequest, NextResponse } from "next/server";
import type { Registry, RegistryItem } from "shadcn/schema";
import {
  analyzeComponentDependencies,
  getComponentCatalog,
  getComponentSources,
} from "@/lib/registry-data";

function normalizeComponentParam(value: string): string {
  return decodeURIComponent(value || "").replace(/\.json$/i, "").trim();
}

function buildRegistryHomepage(origin: string | null): string {
  return origin ? `${origin}/docs` : "/docs";
}

function getOrigin(req: NextRequest): string | null {
  try {
    return new URL(req.url).origin;
  } catch {
    return null;
  }
}

function buildRegistryFile(source: {
  relativePath: string;
  content: string;
}) {
  return {
    path: `registry/default/ai-elements/${source.relativePath}`,
    type: "registry:component" as const,
    content: source.content,
    target: `components/ai-elements/${source.relativePath}`,
  };
}

async function buildRegistrySummary(origin: string | null): Promise<Registry> {
  const [catalog, sources] = await Promise.all([
    getComponentCatalog(),
    getComponentSources(),
  ]);
  const sourceByName = new Map(sources.map((source) => [source.name, source]));

  const items: RegistryItem[] = catalog.map((entry) => {
    const source = sourceByName.get(entry.name);
    return {
      name: entry.name,
      type: "registry:component",
      title: entry.title,
      description: entry.description,
      files: source ? [buildRegistryFile(source)] : [],
    };
  });

  return {
    name: "thread-elements",
    homepage: buildRegistryHomepage(origin),
    items,
  };
}

async function buildSingleRegistryItem(params: {
  name: string;
  origin: string | null;
}): Promise<RegistryItem | null> {
  const [catalog, sources] = await Promise.all([
    getComponentCatalog(),
    getComponentSources(),
  ]);
  const source = sources.find((row) => row.name === params.name);
  const entry = catalog.find((row) => row.name === params.name);
  if (!source || !entry) return null;

  const analysis = await analyzeComponentDependencies({
    source,
    allSources: sources,
    origin: params.origin,
  });

  return {
    $schema: "https://ui.shadcn.com/schema/registry-item.json",
    name: entry.name,
    type: "registry:component",
    title: entry.title,
    description: entry.description,
    files: [buildRegistryFile(source)],
    dependencies: analysis.dependencies,
    devDependencies: [],
    registryDependencies: analysis.registryDependencies,
  };
}

async function buildAllRegistryItem(origin: string | null): Promise<RegistryItem> {
  const [catalog, sources] = await Promise.all([
    getComponentCatalog(),
    getComponentSources(),
  ]);
  const allDependencies = new Set<string>();
  const allRegistryDependencies = new Set<string>();

  for (const source of sources) {
    const analysis = await analyzeComponentDependencies({
      source,
      allSources: sources,
      origin,
    });
    for (const dep of analysis.dependencies) allDependencies.add(dep);
    for (const dep of analysis.registryDependencies)
      allRegistryDependencies.add(dep);
  }

  return {
    $schema: "https://ui.shadcn.com/schema/registry-item.json",
    name: "all",
    type: "registry:component",
    title: "All Thread Elements",
    description:
      "Bundle with all AI SDK Elements-compatible components for Ekairos Thread.",
    files: sources.map((source) => buildRegistryFile(source)),
    dependencies: Array.from(allDependencies).sort((a, b) => a.localeCompare(b)),
    devDependencies: [],
    registryDependencies: Array.from(allRegistryDependencies).sort((a, b) =>
      a.localeCompare(b),
    ),
  };
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ component: string }> },
) {
  const { component } = await context.params;
  const key = normalizeComponentParam(component);
  const origin = getOrigin(req);

  if (!key || key === "registry") {
    const registry = await buildRegistrySummary(origin);
    return NextResponse.json(registry);
  }

  if (key === "all") {
    const allItem = await buildAllRegistryItem(origin);
    return NextResponse.json(allItem);
  }

  const item = await buildSingleRegistryItem({ name: key, origin });
  if (!item) {
    return NextResponse.json(
      {
        error: `Component "${key}" not found.`,
      },
      { status: 404 },
    );
  }

  return NextResponse.json(item);
}
