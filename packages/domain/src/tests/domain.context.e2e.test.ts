/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { init, id } from "@instantdb/admin";
import { domain } from "@ekairos/domain";
import { configureRuntime } from "@ekairos/domain/runtime";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config as dotenvConfig } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import os from "node:os";
import { i } from "@instantdb/core";

const execFileAsync = promisify(execFile);
const fileDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(fileDir, "..", "..", "..", "..");

dotenvConfig({ path: path.resolve(repoRoot, ".env.local") });
dotenvConfig({ path: path.resolve(repoRoot, ".env") });

const TEST_TIMEOUT_MS = 6 * 60 * 1000;
const CLI_TIMEOUT_MS = 2 * 60 * 1000;

function hasInstantEnv(): boolean {
  return Boolean(String(process.env.INSTANT_CLI_AUTH_TOKEN ?? "").trim());
}

function instantCliEnv(): NodeJS.ProcessEnv {
  const token = String(process.env.INSTANT_CLI_AUTH_TOKEN ?? "").trim();
  return { ...process.env, INSTANT_CLI_AUTH_TOKEN: token };
}

function resolveNpxCommand(): string {
  if (process.platform !== "win32") return "npx";
  return process.env.COMSPEC ?? "cmd.exe";
}

function parseInstantCliOutput(output: string): { appId: string; adminToken: string } {
  const raw = String(output ?? "").trim();
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("instant-cli output did not contain JSON");
  }

  const jsonStr = raw.slice(firstBrace, lastBrace + 1);
  const parsed = JSON.parse(jsonStr);
  if (parsed?.error) {
    throw new Error(`instant-cli error: ${String(parsed.error)}`);
  }

  const appId = String(parsed?.appId ?? parsed?.app?.appId ?? "");
  const adminToken = String(parsed?.adminToken ?? parsed?.app?.adminToken ?? "");
  if (!appId || !adminToken) {
    throw new Error("instant-cli output missing appId/adminToken");
  }

  return { appId, adminToken };
}

async function createTempInstantApp(title: string): Promise<{ appId: string; adminToken: string }> {
  const npxCmd = resolveNpxCommand();
  const baseArgs = [
    "instant-cli@latest",
    "init-without-files",
    "--title",
    title,
    "--temp",
  ];
  const args = process.platform === "win32" ? ["/c", "npx", ...baseArgs] : baseArgs;

  const { stdout, stderr } = await execFileAsync(npxCmd, args, {
    env: instantCliEnv(),
    cwd: repoRoot,
    timeout: CLI_TIMEOUT_MS,
    maxBuffer: 5 * 1024 * 1024,
  });

  const output = String(stdout ?? "").trim() || String(stderr ?? "").trim();
  return parseInstantCliOutput(output);
}

async function pushTempSchema(appId: string, adminToken: string, schemaPath: string): Promise<void> {
  const npxCmd = resolveNpxCommand();
  const baseArgs = [
    "instant-cli@latest",
    "push",
    "schema",
    "--app",
    appId,
    "--token",
    adminToken,
    "--yes",
  ];
  const args = process.platform === "win32" ? ["/c", "npx", ...baseArgs] : baseArgs;

  await execFileAsync(npxCmd, args, {
    env: {
      ...instantCliEnv(),
      INSTANT_SCHEMA_FILE_PATH: schemaPath,
    },
    cwd: repoRoot,
    timeout: CLI_TIMEOUT_MS,
    maxBuffer: 5 * 1024 * 1024,
  });
}

describe("domain e2e", () => {
  const testFn = hasInstantEnv() ? it : it.skip;

  testFn(
    "builds domain context and queries a temp Instant app",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ekairos-domain-e2e-"));
      const docsDir = path.join(tempDir, "docs");
      const procurementDir = path.join(docsDir, "procurement");
      const inventoryDir = path.join(docsDir, "inventory");
      await fs.mkdir(procurementDir, { recursive: true });
      await fs.mkdir(inventoryDir, { recursive: true });

      const rootDoc = `# domain: ekairos-domain-e2e
Type: platform
Focus: domain-e2e

## Overview
This domain validates end-to-end context generation and InstantDB queries.

## Responsibilities
- Compose procurement and inventory subdomains.
- Provide context strings for AI prompts.

## Navigation
- /requests - procurement request list.

## Entities
- $users: Auth identities for the platform.
- $files: Shared file storage.

## Subdomains
### procurement
Procurement requests and sourcing intake.

#### Entities
- procurement_requests: Procurement request header.

### inventory
Inventory catalog of purchasable items.

#### Entities
- inventory_items: Inventory items.
`;

      const procurementDoc = `# domain: procurement

## Overview
Procurement requests capture demand and connect to inventory items.

## Entities
- procurement_requests: Request header for sourcing.
  - Fields: title, status, createdAt.
`;

      const inventoryDoc = `# domain: inventory

## Overview
Inventory holds catalog items referenced by procurement requests.

## Entities
- inventory_items: Item catalog records.
  - Fields: sku, name, status.
`;

      await fs.writeFile(path.join(docsDir, "DOMAIN.md"), rootDoc, "utf-8");
      await fs.writeFile(path.join(procurementDir, "DOMAIN.md"), procurementDoc, "utf-8");
      await fs.writeFile(path.join(inventoryDir, "DOMAIN.md"), inventoryDoc, "utf-8");

      const inventoryDomain = domain({ name: "inventory", rootDir: inventoryDir }).schema({
        entities: {
          inventory_items: i.entity({
            sku: i.string().indexed(),
            name: i.string(),
            status: i.string().indexed(),
          }),
        },
        links: {},
        rooms: {},
      });

      const procurementDomain = domain({ name: "procurement", rootDir: procurementDir })
        .includes(inventoryDomain)
        .schema({
          entities: {
            procurement_requests: i.entity({
              title: i.string(),
              status: i.string().indexed(),
              createdAt: i.date().indexed(),
            }),
          },
          links: {
            procurementRequestsItems: {
              forward: {
                on: "procurement_requests",
                has: "many",
                label: "items",
              },
              reverse: {
                on: "inventory_items",
                has: "many",
                label: "requests",
              },
            },
          },
          rooms: {},
        });

      const appDomain = domain({ name: "ekairos-domain-e2e", rootDir: docsDir })
        .includes(procurementDomain)
        .schema({ entities: {}, links: {}, rooms: {} });

      const originalCwd = process.cwd();
      let context: ReturnType<typeof appDomain.context> | undefined;
      let contextString = "";
      try {
        process.chdir(docsDir);
        configureRuntime({ domain: { domain: appDomain } });
        context = appDomain.context();
        contextString = appDomain.contextString();
      } finally {
        process.chdir(originalCwd);
      }

      if (!context) {
        throw new Error("domain context was not generated");
      }

      expect(context.name).toBe("ekairos-domain-e2e");
      expect(context.registry.map((entry) => entry.name).sort()).toEqual([
        "inventory",
        "procurement",
      ]);
      expect(contextString).toContain("end-to-end context generation");
      expect(contextString).toContain("procurement_requests");
      expect(contextString).toContain("inventory_items");

      const schemaPath = path.join(tempDir, "instant.schema.ts");
      const schemaSource = [
        "import { i } from \\\"@instantdb/core\\\";",
        "import { domain } from \\\"@ekairos/domain\\\";",
        "",
        "const inventoryDomain = domain(\\\"inventory\\\").schema({",
        "  entities: {",
        "    inventory_items: i.entity({",
        "      sku: i.string().indexed(),",
        "      name: i.string(),",
        "      status: i.string().indexed(),",
        "    }),",
        "  },",
        "  links: {},",
        "  rooms: {},",
        "});",
        "",
        "const procurementDomain = domain(\\\"procurement\\\")",
        "  .includes(inventoryDomain)",
        "  .schema({",
        "    entities: {",
        "      procurement_requests: i.entity({",
        "        title: i.string(),",
        "        status: i.string().indexed(),",
        "        createdAt: i.date().indexed(),",
        "      }),",
        "    },",
        "    links: {",
        "      procurementRequestsItems: {",
        "        forward: { on: \\\"procurement_requests\\\", has: \\\"many\\\", label: \\\"items\\\" },",
        "        reverse: { on: \\\"inventory_items\\\", has: \\\"many\\\", label: \\\"requests\\\" },",
        "      },",
        "    },",
        "    rooms: {},",
        "  });",
        "",
        "const appDomain = domain(\\\"ekairos-domain-e2e\\\")",
        "  .includes(procurementDomain)",
        "  .schema({ entities: {}, links: {}, rooms: {} });",
        "",
        "const schema = appDomain.toInstantSchema();",
        "export default schema;",
        "",
      ].join("\\n");

      await fs.writeFile(schemaPath, schemaSource, "utf-8");

      try {
        const { appId, adminToken } = await createTempInstantApp(
          `ekairos-domain-e2e-${Date.now()}`
        );
        await pushTempSchema(appId, adminToken, schemaPath);

        const db = init({
          appId,
          adminToken,
          schema: appDomain.toInstantSchema(),
        } as any);

        const itemId = id();
        const requestId = id();

        await db.transact([
          db.tx.inventory_items[itemId].update({
            sku: "ITEM-001",
            name: "Laser Cutter",
            status: "active",
          }),
          db.tx.procurement_requests[requestId].update({
            title: "Acquire laser cutter",
            status: "draft",
            createdAt: new Date(),
          }),
          db.tx.procurement_requests[requestId].link({ items: [itemId] }),
        ]);

        const requestQuery = await db.query({
          procurement_requests: {
            $: { where: { id: requestId }, limit: 1 },
            items: {},
          },
        });

        const request = requestQuery.procurement_requests?.[0];
        expect(request?.items?.length).toBe(1);
        expect(request?.items?.[0]?.id).toBe(itemId);

        const itemQuery = await db.query({
          inventory_items: {
            $: { where: { id: itemId }, limit: 1 },
            requests: {},
          },
        });

        const item = itemQuery.inventory_items?.[0];
        expect(item?.requests?.length).toBe(1);
        expect(item?.requests?.[0]?.id).toBe(requestId);
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    },
  );
});
