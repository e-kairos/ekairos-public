import { promises as fs } from "node:fs";
import { join } from "node:path";
import { track } from "@vercel/analytics/server";
import { createMcpHandler } from "mcp-handler";
import type { RegistryItem } from "shadcn/schema";
import { z } from "zod";

const componentsRoot = join(process.cwd(), "components");

type RegistrySource = {
  name: string;
  relativePath: string;
  absolutePath: string;
  content: string;
};

const normalizePath = (value: string) => value.replace(/\\/g, "/");

const stripExtension = (value: string) =>
  normalizePath(value).replace(/\.(tsx|ts)$/i, "");

const toComponentName = (relativePath: string) =>
  stripExtension(relativePath).split("/").join("-");

const toTitle = (relativePath: string) =>
  stripExtension(relativePath)
    .split("/")
    .map((segment) =>
      segment
        .split(/[-_]/)
        .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
        .join(" ")
    )
    .join(" / ");

const collectSources = async (
  dir: string,
  prefix = ""
): Promise<RegistrySource[]> => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const list: RegistrySource[] = [];

  for (const entry of entries) {
    const absolutePath = join(dir, entry.name);
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      list.push(...(await collectSources(absolutePath, relativePath)));
      continue;
    }

    if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) {
      continue;
    }

    const content = await fs.readFile(absolutePath, "utf-8");
    list.push({
      name: toComponentName(relativePath),
      relativePath: normalizePath(relativePath),
      absolutePath,
      content,
    });
  }

  return list;
};

const registrySources = await collectSources(componentsRoot);
const componentNames = registrySources.map((source) => source.name);
const componentEnum =
  componentNames.length > 0
    ? z.enum(componentNames as [string, ...string[]])
    : z.string();

const handler = createMcpHandler(
  (server) => {
    server.tool(
      "get_ekairos_components",
      "Provides a list of all Ekairos registry components.",
      {},
      async () => {
        if (process.env.NODE_ENV === "production") {
          try {
            await track("MCP: ekairos components");
          } catch (error) {
            console.error(error);
          }
        }

        return {
          content: [{ type: "text", text: JSON.stringify(componentNames) }],
        };
      }
    );

    server.tool(
      "get_ekairos_component",
      "Provides information about a specific Ekairos registry component.",
      { component: componentEnum },
      async ({ component }) => {
        const source = registrySources.find((entry) => entry.name === component);

        if (!source) {
          return {
            content: [
              { type: "text", text: `Component ${component} not found` },
            ],
          };
        }

        if (process.env.NODE_ENV === "production") {
          try {
            await track("MCP: ekairos component", {
              component,
            });
          } catch (error) {
            console.error(error);
          }
        }

        const componentInfo: RegistryItem = {
          name: source.name,
          type: "registry:component",
          title: toTitle(source.relativePath),
          description: `Ekairos component defined at ${source.relativePath}.`,
          files: [
            {
              path: `registry/default/${source.relativePath}`,
              type: "registry:component",
              content: source.content,
              target: `components/${source.relativePath}`,
            },
          ],
        };

        return {
          content: [
            { type: "text", text: JSON.stringify(componentInfo, null, 2) },
          ],
        };
      }
    );
  },
  {},
  {
    disableSse: true,
    basePath: "/api",
    maxDuration: 60,
    verboseLogs: true,
  }
);

export { handler as GET, handler as POST };
