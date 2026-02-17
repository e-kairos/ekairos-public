/** biome-ignore-all lint/suspicious/noConsole: "server only" */

import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { track } from "@vercel/analytics/server";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { Registry, RegistryItem } from "shadcn/schema";

// Load registry package.json to get dependency versions
let registryPackageJson: Record<string, any> | null = null;
async function getRegistryPackageJson() {
  if (!registryPackageJson) {
    try {
      const packageJsonPath = join(process.cwd(), "package.json");
      const content = await fs.readFile(packageJsonPath, "utf-8");
      registryPackageJson = JSON.parse(content);
    } catch (error) {
      console.warn("Failed to load registry package.json:", error);
      registryPackageJson = {};
    }
  }
  return registryPackageJson;
}
const importExportRegex =
  /(?:import|export)\s+(?:[\s\S]+?)?\s+from\s+["'`]([^"'`]+)["'`]/g;
const sideEffectImportRegex = /import\s+["'`]([^"'`]+)["'`]/g;
const dynamicImportRegex = /import\(\s*["'`]([^"'`]+)["'`]\s*\)/g;

const extractModuleSpecifiers = (code: string) => {
  const specifiers = new Set<string>();
  const collect = (regex: RegExp) => {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(code)) !== null) {
      if (match[1]) {
        specifiers.add(match[1]);
      }
    }
  };

  collect(importExportRegex);
  collect(sideEffectImportRegex);
  collect(dynamicImportRegex);

  return Array.from(specifiers);
};

const protocol = process.env.NODE_ENV === "development" ? "http" : "https";
const inferredDevOrigin =
  process.env.PORT && Number.isFinite(Number(process.env.PORT))
    ? `${protocol}://localhost:${process.env.PORT}`
    : null;

const registryOrigin =
  process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `${protocol}://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.NEXT_PUBLIC_APP_URL ??
      inferredDevOrigin ??
      (process.env.NODE_ENV === "development" ? "http://localhost:3001" : "");

const homepage = registryOrigin
  ? new URL("/registry", registryOrigin).toString()
  : "http://localhost:3001/registry";

const componentsRoot = join(process.cwd(), "components");
const defaultAiElementsRegistry = "https://registry.ai-sdk.dev/";
const aiElementsRegistryBase =
  process.env.AI_ELEMENTS_REGISTRY_URL ?? defaultAiElementsRegistry;

const buildAiElementsRegistryUrl = (componentName: string) => {
  const trimmedBase = aiElementsRegistryBase.endsWith("/")
    ? aiElementsRegistryBase
    : `${aiElementsRegistryBase}/`;
  return `${trimmedBase}${componentName}.json`;
};

type RegistrySource = {
  name: string;
  relativePath: string;
  absolutePath: string;
  content: string;
};

const normalizePath = (value: string) => value.replace(/\\/g, "/");

const stripExtension = (value: string) =>
  normalizePath(value).replace(/\.(tsx|ts)$/i, "");

const capitalize = (value: string) => {
  if (!value) {
    return value;
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
};

const toComponentName = (relativePath: string) =>
  stripExtension(relativePath).split("/").join("-");

const toTitle = (relativePath: string) =>
  stripExtension(relativePath)
    .split("/")
    .map((segment) =>
      segment
        .split(/[-_]/)
        .map((word) => capitalize(word))
        .join(" ")
    )
    .join(" / ");

const toDescription = (relativePath: string) => {
  const basePath = stripExtension(relativePath);
  const segments = basePath.split("/");
  const fileName = segments[segments.length - 1] ?? basePath;

  switch (basePath) {
    case "ekairos/agent":
      return "Full Ekairos chat agent shell that wires together prompt, messages, responses and tools.";
    case "ekairos/prompt":
      return "Ekairos prompt input with support for streaming state and file attachments.";
    case "ekairos/thread":
      return "Utilities to work with Ekairos conversation threads from your UI.";
    case "ekairos/event":
      return "Event-level building block to represent messages and agent activity in Ekairos.";
    case "ekairos/use-thread":
      return "React hook to read and update the current Ekairos thread from components.";
    case "ekairos/use-story":
      return "React hook to connect a UI to an Ekairos Story and its agent backend.";
    case "ekairos/voice-provider":
      return "Provider component that enables voice input and audio integration for Ekairos agents.";
    case "ekairos/orb":
      return "Animated Ekairos orb, ideal as a visual indicator for agent presence or thinking state.";
    case "ekairos/cost-simulator":
      return "Visualizer to estimate and simulate token and cost usage for Ekairos agents.";
    case "ekairos/ekairos-logo":
      return "Ekairos logo component ready to embed in headers, sidebars or empty states.";
    case "open-in-v0-button":
      return "Button that lets you open the current component in v0 for rapid iteration.";
    default: {
      const humanPath = basePath.replace(/\//g, " / ");
      return `Ekairos UI component defined in ${humanPath}.`;
    }
  }
};

async function collectSources(
  dir: string,
  prefix = ""
): Promise<RegistrySource[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    console.error(`Error reading directory ${dir}:`, error);
    throw error;
  }
  
  const list: RegistrySource[] = [];

  for (const entry of entries) {
    const absolutePath = join(dir, entry.name);
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

    // Skip UI components directory - these are shadcn base components
    if (entry.isDirectory()) {
      const isRootLevel = prefix === "";
      const isInsideEkairosTree = prefix.startsWith("ekairos");

      // At the root level we only expose the ekairos folder to avoid leaking ui/ai-elements.
      if (isRootLevel && entry.name !== "ekairos") {
        continue;
      }

      // Once we are inside components/ekairos/** we should keep recursing so nested building blocks are exposed.
      if (!isRootLevel && !isInsideEkairosTree) {
        continue;
      }

      list.push(...(await collectSources(absolutePath, relativePath)));
      continue;
    }

    // Skip markdown files and other non-component files
    if (!entry.name.endsWith(".tsx") && !entry.name.endsWith(".ts")) {
      continue;
    }

    // Skip spec files and other test files
    if (entry.name.includes(".spec.") || entry.name.includes(".test.")) {
      continue;
    }

    try {
      const content = await fs.readFile(absolutePath, "utf-8");
      const normalizedRelativePath = normalizePath(relativePath);

      // Special handling for Ekairos components:
      // - Top-level files under components/ekairos (e.g. ekairos/agent.tsx)
      //   are exposed with simplified names like "agent" => @ekairos/agent
      // - Components in subdirectories with capitalized name (e.g. ekairos/agent/Agent.tsx)
      //   are exposed as the directory name (e.g. "agent" => @ekairos/agent)
      // - Other nested ekairos components (e.g. ekairos/prompt/prompt-button.tsx)
      //   keep the default toComponentName naming so they can be used as dependencies.
      if (normalizedRelativePath.startsWith("ekairos/")) {
        const segments = normalizedRelativePath.split("/");

        if (segments.length === 2) {
          // ekairos/agent.tsx -> agent
          const fileName = segments[1] ?? "";
          const ekairosName = stripExtension(fileName);

          if (!ekairosName) {
            continue;
          }

          list.push({
            name: ekairosName,
            relativePath: normalizedRelativePath,
            absolutePath,
            content,
          });
          continue;
        }

        if (segments.length === 3) {
          // ekairos/agent/Agent.tsx -> agent (if directory name matches file name)
          const dirName = segments[1] ?? "";
          const fileName = stripExtension(segments[2] ?? "");
          
          // If directory name matches file name (case-insensitive), use directory name
          if (dirName.toLowerCase() === fileName.toLowerCase()) {
            list.push({
              name: dirName,
              relativePath: normalizedRelativePath,
              absolutePath,
              content,
            });
            continue;
          }
        }

        // Nested ekairos sub-components: use default naming
        list.push({
          name: toComponentName(normalizedRelativePath),
          relativePath: normalizedRelativePath,
          absolutePath,
          content,
        });
        continue;
      }

      // Default behavior for all other components (including ai-elements/*)
      list.push({
        name: toComponentName(normalizedRelativePath),
        relativePath: normalizedRelativePath,
        absolutePath,
        content,
      });
    } catch (error) {
      console.warn(`Failed to read file ${absolutePath}:`, error);
    }
  }

  return list;
}

// Cache for sources (reloaded in development)
let cachedSources: RegistrySource[] | null = null;
let cachedSourceByPath: Map<string, RegistrySource> | null = null;
let cachedSourceByName: Map<string, RegistrySource> | null = null;

async function getSources() {
  if (process.env.NODE_ENV === "development" || !cachedSources) {
    try {
      // Verify components root exists
      try {
        const stats = await fs.stat(componentsRoot);
        if (!stats.isDirectory()) {
          throw new Error(`Components root is not a directory: ${componentsRoot}`);
        }
      } catch (error) {
        console.error(`Components root not found: ${componentsRoot}`, error);
        throw new Error(`Components directory not found at ${componentsRoot}`);
      }

      const sources = (await collectSources(componentsRoot)).sort((a, b) =>
        a.name.localeCompare(b.name)
      );
      
      const sourceByPath = new Map<string, RegistrySource>();
      const sourceByName = new Map<string, RegistrySource>();
      
      for (const source of sources) {
        sourceByPath.set(stripExtension(source.relativePath), source);
        sourceByName.set(source.name, source);
      }
      
      cachedSources = sources;
      cachedSourceByPath = sourceByPath;
      cachedSourceByName = sourceByName;
    } catch (error) {
      console.error("Error collecting sources:", error);
      throw error;
    }
  }

    return {
    sources: cachedSources!,
    sourceByPath: cachedSourceByPath!,
    sourceByName: cachedSourceByName!,
    };
}

export async function getRegistry() {
  try {
    const { sources } = await getSources();
    const registryItems: RegistryItem[] = sources.map((source) => ({
      name: source.name,
      type: "registry:component",
      title: toTitle(source.relativePath),
      description: toDescription(source.relativePath),
      files: [
        {
          path: `registry/default/${source.relativePath}`,
          type: "registry:component",
          target: `components/${source.relativePath}`,
        },
      ],
    }));

    return {
      name: "ekairos",
      homepage,
      items: registryItems,
    };
  } catch (error) {
    console.error("Error in getRegistry:", error);
    throw error;
  }
}

const getRegistryDependencyReference = (componentName: string | null) => {
  if (!componentName) {
    return null;
  }

  if (registryOrigin) {
    return new URL(`/${componentName}.json`, registryOrigin).toString();
  }

  return `/${componentName}.json`;
};

const getBasePackageName = (specifier: string) => {
  if (specifier.startsWith("@")) {
    const [scope, name] = specifier.split("/");
    return name ? `${scope}/${name}` : scope;
  }
  return specifier.split("/")[0];
};

const resolveRelativeDependency = async (
  from: RegistrySource,
  specifier: string
): Promise<string | null> => {
  const { sourceByPath } = await getSources();
  const resolved = stripExtension(
    normalizePath(join(dirname(from.relativePath), specifier))
  );
  const match = sourceByPath.get(resolved);
  return match ? match.name : null;
};

const resolveAliasedDependency = async (specifier: string): Promise<string | null> => {
  if (!specifier.startsWith("@/components/")) {
    return null;
  }

  const { sourceByPath } = await getSources();
  const relative = stripExtension(
    normalizePath(specifier.replace("@/components/", ""))
  );
  const match = sourceByPath.get(relative);
  return match ? match.name : null;
};

const analyzeSource = async (source: RegistrySource) => {
  const dependencies = new Set<string>();
  const registryDependencies = new Set<string>();

  try {
    const imports = extractModuleSpecifiers(source.content);

    for (const specifier of imports) {
      if (!specifier) {
        continue;
      }

      // Components from @/components/ui/ are shadcn base components
      if (specifier.startsWith("@/components/ui/")) {
        const componentName = specifier.split("/").pop();
        if (componentName) {
          // Reference to official shadcn registry (assuming default style)
          registryDependencies.add(`https://ui.shadcn.com/r/styles/default/${componentName}.json`);
        }
        continue;
      }

      if (specifier.startsWith("@/components/ai-elements/")) {
        // AI Elements live in their own registry. Reference their remote URL
        // so shadcn CLI can fetch them automatically.
        const componentName = specifier.split("/").pop();
        if (componentName) {
          registryDependencies.add(
            buildAiElementsRegistryUrl(componentName),
          );
        }
        continue;
      }

      // Components from @/components/ekairos/ are our registry components
      if (specifier.startsWith("@/components/ekairos/")) {
        const targetName = await resolveAliasedDependency(specifier);
        if (targetName) {
          const ref = getRegistryDependencyReference(targetName);
          if (ref) {
            registryDependencies.add(ref);
          }
        } else {
          const pathWithoutPrefix = specifier.replace("@/components/ekairos/", "");
          const fallbackName = `ekairos-${pathWithoutPrefix.replace(/\//g, "-")}`;
          const fallbackRef = getRegistryDependencyReference(fallbackName);
          if (fallbackRef) {
            registryDependencies.add(fallbackRef);
          }
        }
        continue;
      }

      // Other @/components/ paths
      if (specifier.startsWith("@/components/")) {
        const targetName = await resolveAliasedDependency(specifier);
        if (targetName) {
          const ref = getRegistryDependencyReference(targetName);
          if (ref) {
            registryDependencies.add(ref);
          }
        }
        continue;
      }

      if (specifier.startsWith("./") || specifier.startsWith("../")) {
        const targetName = await resolveRelativeDependency(source, specifier);
        const ref = getRegistryDependencyReference(targetName);
        if (ref) {
          registryDependencies.add(ref);
        }
        continue;
      }

      // Skip path aliases
      if (specifier.startsWith("@/")) {
        continue;
      }

      const pkg = getBasePackageName(specifier);
      if (pkg && !pkg.startsWith(".") && !pkg.startsWith("/")) {
        // Try to get version from registry package.json
        const packageJson = await getRegistryPackageJson();
        const version = packageJson?.dependencies?.[pkg] || packageJson?.devDependencies?.[pkg];
        if (version) {
          dependencies.add(`${pkg}@${version}`);
        } else {
          dependencies.add(pkg);
        }
      }
    }
  } catch (error) {
    console.warn(`Failed to analyze imports for ${source.relativePath}`, error);
  }

  return {
    dependencies,
    registryDependencies,
  };
};

type RequestProps = {
  params: Promise<{ component: string }>;
};

export const GET = async (_request: NextRequest, { params }: RequestProps) => {
  let component: string = "unknown";
  let parsedComponent: string = "unknown";
  
  try {
    const paramsResult = await params;
    component = paramsResult.component;
    parsedComponent = component.replace(".json", "");

  if (parsedComponent === "registry") {
    try {
        track("ekairos:registry");
      } catch (error) {
        console.warn("Failed to track registry summary:", error);
      }
      try {
        const registry = await getRegistry();
        return NextResponse.json(registry);
    } catch (error) {
        console.error("Error getting registry:", error);
        return NextResponse.json(
          { 
            error: "Failed to get registry",
            details: error instanceof Error ? error.message : String(error)
          },
          { status: 500 }
        );
      }
    }

  if (parsedComponent === "all") {
    try {
        track("ekairos:registry-all");
    } catch (error) {
        console.warn("Failed to track registry all bundle:", error);
    }

      const { sources } = await getSources();
    const allDependencies = new Set<string>();
    const allRegistryDependencies = new Set<string>();

      const allFiles = await Promise.all(sources.map(async (source) => {
        const analysis = await analyzeSource(source);
        for (const dep of analysis.dependencies) {
          allDependencies.add(dep);
        }
        for (const dep of analysis.registryDependencies) {
          allRegistryDependencies.add(dep);
            }

        return {
          path: `registry/default/${source.relativePath}`,
          type: "registry:component" as const,
          content: source.content,
          target: `components/${source.relativePath}`,
        };
      }));

    const allComponentsItem: RegistryItem = {
      $schema: "https://ui.shadcn.com/schema/registry-item.json",
      name: "all",
      type: "registry:component",
        title: "All Ekairos Components",
        description:
          "Bundle containing every Ekairos component exposed through the registry.",
      files: allFiles,
      dependencies: Array.from(allDependencies),
        devDependencies: [],
      registryDependencies: Array.from(allRegistryDependencies),
    };

    return NextResponse.json(allComponentsItem);
  }

    const { sourceByName } = await getSources();
    const source = sourceByName.get(parsedComponent);

    if (!source) {
    return NextResponse.json(
        { error: `Component "${parsedComponent}" not found. Available components: ${Array.from(sourceByName.keys()).slice(0, 10).join(", ")}...` },
      { status: 404 }
    );
  }

    try {
      track(`ekairos:registry:${parsedComponent}`);
    } catch (error) {
      console.warn(`Failed to track registry component ${parsedComponent}:`, error);
        }

    let analysis;
    try {
      analysis = await analyzeSource(source);
  } catch (error) {
      console.error(`Error analyzing source ${source.relativePath}:`, error);
      // Fallback: return empty dependencies instead of failing
      analysis = {
        dependencies: new Set<string>(),
        registryDependencies: new Set<string>(),
      };
  }

  const itemResponse: RegistryItem = {
    $schema: "https://ui.shadcn.com/schema/registry-item.json",
      name: source.name,
      type: "registry:component",
      title: toTitle(source.relativePath),
      description: toDescription(source.relativePath),
    files: [
      {
          path: `registry/default/${source.relativePath}`,
          type: "registry:component",
          content: source.content,
          target: `components/${source.relativePath}`,
      },
    ],
      dependencies: Array.from(analysis.dependencies),
      devDependencies: [],
      registryDependencies: Array.from(analysis.registryDependencies),
  };

  return NextResponse.json(itemResponse);
  } catch (error) {
    console.error(`Error in GET handler:`, error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    const componentName = parsedComponent || component || "unknown";
    
    return NextResponse.json(
      { 
        error: `Failed to serve component "${componentName}".`,
        message: errorMessage,
        stack: process.env.NODE_ENV === "development" ? errorStack : undefined
      },
      { status: 500 }
    );
  }
};
