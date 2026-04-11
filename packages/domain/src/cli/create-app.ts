import { spawn } from "node:child_process"
import { access, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { PlatformApi } from "@instantdb/platform"
import { i } from "@instantdb/core"
import { domain } from "../index.js"

type CreateDomainAppParams = {
  directory: string
  framework: "next"
  install: boolean
  force?: boolean
  packageManager?: string
  workspacePath?: string
  instantToken?: string
  orgId?: string
  appId?: string
  adminToken?: string
}

type CreateDomainAppResult = {
  ok: true
  directory: string
  framework: "next"
  installed: boolean
  packageManager: string
  provisioned: boolean
  appId: string | null
  adminToken: string | null
  nextSteps: string[]
}

const TEMPLATE_NEXT_VERSION = "15.5.7"
const TEMPLATE_REACT_VERSION = "19.2.1"
const TEMPLATE_TYPESCRIPT_VERSION = "^5.9.2"
const TEMPLATE_INSTANT_VERSION = "0.22.126"
const TEMPLATE_WORKFLOW_VERSION = "4.1.0-beta.55"
const TEMPLATE_WORLD_LOCAL_VERSION = "4.1.0-beta.31"

function trimOrEmpty(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function toPosix(value: string) {
  return value.replace(/\\/g, "/")
}

async function detectPackageManager(explicit?: string, workspacePath?: string) {
  const normalized = trimOrEmpty(explicit).toLowerCase()
  if (normalized) return normalized

  for (const root of [trimOrEmpty(workspacePath), process.cwd()].filter(Boolean)) {
    if (await pathExists(join(root, "pnpm-lock.yaml"))) return "pnpm"
    if (await pathExists(join(root, "yarn.lock"))) return "yarn"
    if (await pathExists(join(root, "bun.lockb"))) return "bun"
  }

  const agent = trimOrEmpty(process.env.npm_config_user_agent)
  if (agent.startsWith("pnpm/")) return "pnpm"
  if (agent.startsWith("yarn/")) return "yarn"
  if (agent.startsWith("bun/")) return "bun"
  return "npm"
}

async function pathExists(pathname: string) {
  try {
    await access(pathname)
    return true
  } catch {
    return false
  }
}

async function ensureWritableTargetDirectory(targetDir: string, force = false) {
  await mkdir(targetDir, { recursive: true })
  const entries = await readdir(targetDir)
  if (entries.length === 0) return
  if (!force) {
    throw new Error(`Target directory is not empty: ${targetDir}`)
  }

  await rm(targetDir, { recursive: true, force: true })
  await mkdir(targetDir, { recursive: true })
}

async function readDomainPackageVersion() {
  const packageJsonPath = new URL("../../package.json", import.meta.url)
  const raw = await readFile(packageJsonPath, "utf8")
  const parsed = JSON.parse(raw) as { version?: string }
  return trimOrEmpty(parsed.version) || "latest"
}

function createScaffoldSchema() {
  const scaffoldDomain = domain("ekairos.app").schema({
    entities: {
      app_tasks: i.entity({
        title: i.string().indexed(),
        status: i.string().indexed(),
        createdAt: i.number().indexed(),
      }),
      app_task_comments: i.entity({
        body: i.string(),
        createdAt: i.number().indexed(),
      }),
    },
    links: {
      taskComments: {
        forward: { on: "app_tasks", has: "many", label: "comments" },
        reverse: { on: "app_task_comments", has: "one", label: "task" },
      },
    },
    rooms: {},
  })

  return scaffoldDomain.toInstantSchema()
}

function createScaffoldPerms() {
  return {
    attrs: {
      allow: { create: "true" },
    },
    app_tasks: {
      bind: ["isLoggedIn", "auth.id != null"],
      allow: {
        view: "true",
        create: "isLoggedIn",
        update: "isLoggedIn",
        delete: "false",
      },
    },
    app_task_comments: {
      bind: ["isLoggedIn", "auth.id != null"],
      allow: {
        view: "true",
        create: "isLoggedIn",
        update: "isLoggedIn",
        delete: "false",
      },
    },
  } as any
}

function installCommandFor(packageManager: string) {
  if (packageManager === "pnpm") return "pnpm install"
  if (packageManager === "yarn") return "yarn install"
  if (packageManager === "bun") return "bun install"
  return "npm install"
}

function runScriptCommandFor(packageManager: string, script: string) {
  if (packageManager === "pnpm") return `pnpm ${script}`
  if (packageManager === "yarn") return `yarn ${script}`
  if (packageManager === "bun") return `bun run ${script}`
  return `npm run ${script}`
}

async function provisionInstantApp(params: {
  directory: string
  instantToken: string
  orgId?: string
}) {
  const api = new PlatformApi({
    auth: { token: params.instantToken },
  })

  const created = await api.createApp({
    title: `ekairos-${trimOrEmpty(params.directory.split(/[\\/]/).pop()) || "app"}`,
    orgId: trimOrEmpty(params.orgId) || undefined,
    schema: createScaffoldSchema(),
    perms: createScaffoldPerms(),
  })

  const appId = trimOrEmpty(created?.app?.id)
  const adminToken = trimOrEmpty((created?.app as any)?.adminToken)
  if (!appId || !adminToken) {
    throw new Error("Instant app provisioning did not return appId/adminToken")
  }

  return {
    appId,
    adminToken,
  }
}

async function runInstall(targetDir: string, packageManager: string) {
  const command =
    packageManager === "yarn"
      ? "yarn"
      : packageManager === "bun"
        ? "bun"
        : packageManager === "pnpm"
          ? "pnpm"
          : "npm"

  const args =
    command === "yarn"
      ? ["install"]
      : command === "bun"
        ? ["install"]
        : command === "pnpm"
          ? ["install"]
          : ["install"]

  await new Promise<void>((resolveInstall, rejectInstall) => {
    const child = spawn(command, args, {
      cwd: targetDir,
      env: process.env,
      shell: process.platform === "win32",
      stdio: "pipe",
    })

    let stderr = ""
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })

    child.on("error", rejectInstall)
    child.on("close", (code) => {
      if (code === 0) {
        resolveInstall()
        return
      }
      rejectInstall(
        new Error(
          stderr.trim() || `${command} install failed with exit code ${code ?? "unknown"}`,
        ),
      )
    })
  })
}

async function writeScaffoldFiles(targetDir: string, files: Record<string, string>) {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(targetDir, relativePath)
    await mkdir(dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, content, "utf8")
  }
}

function resolveDomainDependencyVersion(
  version: string,
  targetDir: string,
  workspacePath?: string,
) {
  const workspaceRoot = trimOrEmpty(workspacePath)
  if (!workspaceRoot) {
    return `^${version}`
  }

  const packageRoot = resolve(workspaceRoot, "packages/domain")
  const relativePath = toPosix(relative(targetDir, packageRoot))
  if (!relativePath) return "file:."
  const prefixed = relativePath.startsWith(".") ? relativePath : `./${relativePath}`
  return `file:${prefixed}`
}

function buildNextTemplateFiles(params: {
  targetDir: string
  domainVersion: string
  packageManager: string
  workspacePath?: string
}) {
  const domainDependency = resolveDomainDependencyVersion(
    params.domainVersion,
    params.targetDir,
    params.workspacePath,
  )

  const packageJson = {
    name: trimOrEmpty(params.targetDir.split(/[\\/]/).pop()) || "ekairos-app",
    private: true,
    version: "0.1.0",
    type: "module",
    scripts: {
      build: "next build",
      dev: "next dev",
      start: "next start",
      typecheck: "tsc --noEmit",
    },
    dependencies: {
      "@ekairos/domain": domainDependency,
      "@instantdb/admin": TEMPLATE_INSTANT_VERSION,
      "@instantdb/core": TEMPLATE_INSTANT_VERSION,
      "@workflow/world-local": TEMPLATE_WORLD_LOCAL_VERSION,
      next: TEMPLATE_NEXT_VERSION,
      react: TEMPLATE_REACT_VERSION,
      "react-dom": TEMPLATE_REACT_VERSION,
      workflow: TEMPLATE_WORKFLOW_VERSION,
    },
    devDependencies: {
      "@types/node": "^24.5.0",
      "@types/react": "^19.2.2",
      "@types/react-dom": "^19.2.2",
      typescript: TEMPLATE_TYPESCRIPT_VERSION,
    },
    packageManager:
      params.packageManager === "pnpm"
        ? "pnpm@10"
        : params.packageManager === "yarn"
          ? "yarn@1"
          : undefined,
  }

  return {
    ".gitignore": [".next", "node_modules", ".env.local", ".workflow-data"].join("\n"),
    ".env.example": [
      "NEXT_PUBLIC_INSTANT_APP_ID=",
      "INSTANT_ADMIN_TOKEN=",
      "",
      "# Optional: use this only while provisioning new apps with the CLI.",
      "INSTANT_PERSONAL_ACCESS_TOKEN=",
    ].join("\n"),
    "DOMAIN.md": [
      "# Ekairos App Domain",
      "",
      "This scaffold ships a small task domain to prove the full loop:",
      "- inspect the domain through the well-known endpoint",
      "- create tasks and comments through domain actions",
      "- query nested data through InstaQL",
      "",
      "Actions:",
      "- `createTask` -> create one task",
      "- `addTaskComment` -> attach one comment to a task",
      "- `seedDemo` -> create demo data fast",
    ].join("\n"),
    "instant.schema.ts": [
      'import appDomain from "./src/domain";',
      "",
      "const schema = appDomain.toInstantSchema();",
      "",
      "export default schema;",
    ].join("\n"),
    "next-env.d.ts": [
      '/// <reference types="next" />',
      '/// <reference types="next/image-types/global" />',
      "",
      "// This file is managed by Next.js.",
    ].join("\n"),
    "next.config.ts": [
      'import type { NextConfig } from "next";',
      'import { withWorkflow } from "workflow/next";',
      'import { withRuntime } from "@ekairos/domain/next";',
      "",
      "const nextConfig: NextConfig = {",
      "  transpilePackages: [\"@ekairos/domain\"],",
      "};",
      "",
      "export default withRuntime(withWorkflow(nextConfig) as any, {",
      '  bootstrapModule: "./src/runtime.ts",',
      "});",
    ].join("\n"),
    "package.json": `${JSON.stringify(packageJson, null, 2)}\n`,
    "tsconfig.json": [
      "{",
      '  "compilerOptions": {',
      '    "target": "ES2022",',
      '    "lib": ["dom", "dom.iterable", "es2022"],',
      '    "allowJs": false,',
      '    "skipLibCheck": true,',
      '    "strict": true,',
      '    "noEmit": true,',
      '    "esModuleInterop": true,',
      '    "module": "esnext",',
      '    "moduleResolution": "bundler",',
      '    "resolveJsonModule": true,',
      '    "isolatedModules": true,',
      '    "jsx": "preserve",',
      '    "incremental": true,',
      '    "baseUrl": ".",',
      '    "paths": {',
      '      "@/*": ["./src/*"]',
      "    }",
      "  },",
      '  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],',
      '  "exclude": ["node_modules"]',
      "}",
    ].join("\n"),
    "src/app/globals.css": [
      ":root {",
      "  color-scheme: light;",
      "  --bg: #f4f1ea;",
      "  --panel: #fffdf7;",
      "  --ink: #171717;",
      "  --muted: #5c5a52;",
      "  --accent: #0f766e;",
      "  --border: #d8d2c6;",
      "}",
      "",
      "* {",
      "  box-sizing: border-box;",
      "}",
      "",
      "html,",
      "body {",
      "  margin: 0;",
      "  min-height: 100%;",
      "  background: radial-gradient(circle at top, #fffaf0, var(--bg));",
      "  color: var(--ink);",
      '  font-family: "Segoe UI", sans-serif;',
      "}",
      "",
      "body {",
      "  min-height: 100vh;",
      "}",
      "",
      "main {",
      "  max-width: 980px;",
      "  margin: 0 auto;",
      "  padding: 48px 24px 72px;",
      "}",
      "",
      ".hero {",
      "  display: grid;",
      "  gap: 24px;",
      "}",
      "",
      ".eyebrow {",
      "  color: var(--accent);",
      "  font-size: 12px;",
      "  font-weight: 700;",
      "  letter-spacing: 0.2em;",
      "  text-transform: uppercase;",
      "}",
      "",
      "h1 {",
      "  margin: 0;",
      "  font-size: clamp(2.5rem, 6vw, 4.8rem);",
      "  line-height: 0.92;",
      "}",
      "",
      "p {",
      "  margin: 0;",
      "  color: var(--muted);",
      "  line-height: 1.65;",
      "}",
      "",
      ".grid {",
      "  display: grid;",
      "  gap: 18px;",
      "  margin-top: 32px;",
      "}",
      "",
      ".card {",
      "  background: var(--panel);",
      "  border: 1px solid var(--border);",
      "  border-radius: 20px;",
      "  padding: 20px;",
      "  box-shadow: 0 18px 45px rgba(23, 23, 23, 0.06);",
      "}",
      "",
      "pre {",
      "  overflow: auto;",
      "  border-radius: 14px;",
      "  padding: 14px;",
      "  background: #171717;",
      "  color: #f6f6f6;",
      "  font-size: 13px;",
      "}",
      "",
      "code {",
      '  font-family: "Cascadia Code", monospace;',
      "}",
      "",
      "@media (min-width: 860px) {",
      "  .grid {",
      "    grid-template-columns: repeat(2, minmax(0, 1fr));",
      "  }",
      "}",
    ].join("\n"),
    "src/app/layout.tsx": [
      'import "./globals.css";',
      'import type { ReactNode } from "react";',
      "",
      "export const metadata = {",
      '  title: "Ekairos App",',
      '  description: "Scaffolded Ekairos domain app",',
      "};",
      "",
      "export default function RootLayout({ children }: { children: ReactNode }) {",
      "  return (",
      '    <html lang="en">',
      "      <body>{children}</body>",
      "    </html>",
      "  );",
      "}",
    ].join("\n"),
    "src/app/page.tsx": [
      'const seededCommand = "npx @ekairos/domain seedDemo --baseUrl=http://localhost:3000 --admin --pretty";',
      'const queryCommand = "npx @ekairos/domain query @query.json5 --baseUrl=http://localhost:3000 --admin --pretty";',
      "",
      "export default function HomePage() {",
      '  const hasRuntime = Boolean(process.env.NEXT_PUBLIC_INSTANT_APP_ID && process.env.INSTANT_ADMIN_TOKEN);',
      "",
      "  return (",
      "    <main>",
      '      <section className="hero">',
      '        <div className="eyebrow">Ekairos Domain Scaffold</div>',
      "        <h1>From zero to domain CLI in one hop.</h1>",
      "        <p>",
      "          This app already exposes the Ekairos domain endpoint, ships a sample task domain, and",
      "          includes step-safe actions plus a workflow example.",
      "        </p>",
      "      </section>",
      "",
      '      <section className="grid">',
      '        <article className="card">',
      '          <h2>Runtime</h2>',
      "          <p>",
      '            {hasRuntime ? "Instant runtime credentials detected." : "Add NEXT_PUBLIC_INSTANT_APP_ID and INSTANT_ADMIN_TOKEN in .env.local."}',
      "          </p>",
      "        </article>",
      "",
      '        <article className="card">',
      '          <h2>First Action</h2>',
      "          <pre><code>{seededCommand}</code></pre>",
      "        </article>",
      "",
      '        <article className="card">',
      '          <h2>Nested Query</h2>',
      "          <pre><code>{queryCommand}</code></pre>",
      "        </article>",
      "",
      '        <article className="card">',
      '          <h2>Workflow File</h2>',
      "          <p>Check <code>src/workflows/demo.workflow.ts</code> for a durable entrypoint that calls domain actions.</p>",
      "        </article>",
      "      </section>",
      "    </main>",
      "  );",
      "}",
    ].join("\n"),
    "src/domain.ts": [
      'import { randomUUID } from "node:crypto";',
      'import { defineDomainAction, domain } from "@ekairos/domain";',
      'import { i } from "@instantdb/core";',
      "",
      "const baseDomain = domain(\"ekairos.app\")",
      "  .schema({",
      "    entities: {",
      "      app_tasks: i.entity({",
      "        title: i.string().indexed(),",
      "        status: i.string().indexed(),",
      "        createdAt: i.number().indexed(),",
      "      }),",
      "      app_task_comments: i.entity({",
      "        body: i.string(),",
      "        createdAt: i.number().indexed(),",
      "      }),",
      "    },",
      "    links: {",
      "      taskComments: {",
      '        forward: { on: "app_tasks", has: "many", label: "comments" },',
      '        reverse: { on: "app_task_comments", has: "one", label: "task" },',
      "      },",
      "    },",
      "    rooms: {},",
      "  });",
      "",
      "export const createTaskAction = defineDomainAction({",
      '  name: "app.task.create",',
      "  async execute({ runtime, input }) {",
      '    "use step";',
      "    const scoped = await runtime.use(appDomain);",
      "    const taskId = randomUUID();",
      "    await scoped.db.transact([",
      "      scoped.db.tx.app_tasks[taskId].update({",
      '        title: String((input as any)?.title ?? "").trim() || "Untitled task",',
      '        status: String((input as any)?.status ?? "").trim() || "draft",',
      "        createdAt: Date.now(),",
      "      }),",
      "    ]);",
      "    return { taskId };",
      "  },",
      "});",
      "",
      "export const addTaskCommentAction = defineDomainAction({",
      '  name: "app.task.comment.add",',
      "  async execute({ runtime, input }) {",
      '    "use step";',
      "    const scoped = await runtime.use(appDomain);",
      "    const commentId = randomUUID();",
      '    const taskId = String((input as any)?.taskId ?? "").trim();',
      "    if (!taskId) throw new Error(\"taskId is required\");",
      "    await scoped.db.transact([",
      "      scoped.db.tx.app_task_comments[commentId].update({",
      '        body: String((input as any)?.body ?? "").trim() || "Empty comment",',
      "        createdAt: Date.now(),",
      "      }),",
      "      scoped.db.tx.app_task_comments[commentId].link({ task: taskId }),",
      "    ]);",
      "    return { commentId, taskId };",
      "  },",
      "});",
      "",
      "export const seedDemoAction = defineDomainAction({",
      '  name: "app.demo.seed",',
      "  async execute({ runtime }) {",
      '    "use step";',
      "    const scoped = await runtime.use(appDomain);",
      '    const created = await scoped.actions.createTask({ title: "Ship the first Ekairos loop", status: "ready" });',
      "    await scoped.actions.addTaskComment({",
      "      taskId: created.taskId,",
      '      body: "Query me with app_tasks -> comments to validate the full CLI path.",',
      "    });",
      "    return created;",
      "  },",
      "});",
      "",
      "export const appDomain = baseDomain.actions({",
      "  addTaskComment: addTaskCommentAction,",
      "  createTask: createTaskAction,",
      "  seedDemo: seedDemoAction,",
      "});",
      "",
      "export default appDomain;",
    ].join("\n"),
    "src/runtime.ts": [
      'import "server-only";',
      "",
      'import { init } from "@instantdb/admin";',
      'import { EkairosRuntime } from "@ekairos/domain";',
      'import { configureRuntime } from "@ekairos/domain/runtime";',
      'import appDomain from "./domain";',
      "",
      "export type AppRuntimeEnv = {",
      "  actorEmail?: string | null;",
      "  actorId?: string;",
      "  adminToken?: string;",
      "  appId?: string;",
      "};",
      "",
      "function resolveRuntimeEnv(env: AppRuntimeEnv = {}): Required<Pick<AppRuntimeEnv, \"appId\" | \"adminToken\">> & AppRuntimeEnv {",
      '  const appId = String(env.appId ?? process.env.NEXT_PUBLIC_INSTANT_APP_ID ?? "").trim();',
      '  const adminToken = String(env.adminToken ?? process.env.INSTANT_ADMIN_TOKEN ?? "").trim();',
      "  if (!appId || !adminToken) {",
      '    throw new Error("Missing NEXT_PUBLIC_INSTANT_APP_ID or INSTANT_ADMIN_TOKEN. Copy .env.example to .env.local and fill both values.");',
      "  }",
      "  return {",
      "    ...env,",
      "    appId,",
      "    adminToken,",
      "  };",
      "}",
      "",
      "export class AppRuntime extends EkairosRuntime<AppRuntimeEnv, typeof appDomain> {",
      "  protected getDomain() {",
      "    return appDomain;",
      "  }",
      "",
      "  protected async resolveDb(env: AppRuntimeEnv) {",
      "    const resolved = resolveRuntimeEnv(env);",
      "    return init({",
      "      appId: resolved.appId,",
      "      adminToken: resolved.adminToken,",
      "      schema: appDomain.toInstantSchema(),",
      "      useDateObjects: true,",
      "    } as any);",
      "  }",
      "}",
      "",
      "export function createRuntime(env: AppRuntimeEnv = {}) {",
      "  return new AppRuntime(resolveRuntimeEnv(env));",
      "}",
      "",
      "export const runtimeConfig = configureRuntime<AppRuntimeEnv>({",
      "  runtime: async (env) => {",
      "    const runtime = createRuntime(env);",
      "    return { db: await runtime.db() };",
      "  },",
      "  domain: {",
      "    domain: appDomain,",
      "  },",
      "});",
    ].join("\n"),
    "src/workflows/demo.workflow.ts": [
      'import { executeRuntimeAction } from "@ekairos/domain/runtime";',
      'import { createTaskAction, addTaskCommentAction } from "../domain";',
      'import { createRuntime } from "../runtime";',
      "",
      "export type DemoWorkflowInput = {",
      "  title: string;",
      "  comment?: string;",
      "};",
      "",
      "export async function runDemoWorkflow(input: DemoWorkflowInput) {",
      '  "use workflow";',
      "  const runtime = createRuntime();",
      "  const created = await executeRuntimeAction({",
      "    runtime,",
      "    action: createTaskAction,",
      "    input: { title: input.title, status: \"workflow\" },",
      "  });",
      "",
      '  const comment = String(input.comment ?? "").trim();',
      "  if (comment) {",
      "    await executeRuntimeAction({",
      "      runtime,",
      "      action: addTaskCommentAction,",
      "      input: { taskId: (created as any).taskId, body: comment },",
      "    });",
      "  }",
      "",
      "  return created;",
      "}",
    ].join("\n"),
  }
}

export async function createDomainApp(
  params: CreateDomainAppParams,
): Promise<CreateDomainAppResult> {
  if (params.framework !== "next") {
    throw new Error("Only --next is supported right now.")
  }

  const targetDir = resolve(params.directory || ".")
  await ensureWritableTargetDirectory(targetDir, params.force)

  const packageManager = await detectPackageManager(params.packageManager, params.workspacePath)
  const domainVersion = await readDomainPackageVersion()

  const explicitAppId = trimOrEmpty(params.appId)
  const explicitAdminToken = trimOrEmpty(params.adminToken)
  const shouldProvision =
    Boolean(trimOrEmpty(params.instantToken)) &&
    (!explicitAppId || !explicitAdminToken)

  const provisioned = shouldProvision
    ? await provisionInstantApp({
        directory: targetDir,
        instantToken: trimOrEmpty(params.instantToken),
        orgId: params.orgId,
      })
    : null

  const appId = explicitAppId || provisioned?.appId || null
  const adminToken = explicitAdminToken || provisioned?.adminToken || null

  const files = buildNextTemplateFiles({
    targetDir,
    domainVersion,
    packageManager,
    workspacePath: params.workspacePath,
  })
  await writeScaffoldFiles(targetDir, files)

  if (appId && adminToken) {
    await writeFile(
      join(targetDir, ".env.local"),
      [
        `NEXT_PUBLIC_INSTANT_APP_ID=${appId}`,
        `INSTANT_ADMIN_TOKEN=${adminToken}`,
        "",
      ].join("\n"),
      "utf8",
    )
  }

  if (params.install) {
    await runInstall(targetDir, packageManager)
  }

  const nextSteps = [
    `cd ${targetDir}`,
    params.install
      ? runScriptCommandFor(packageManager, "dev")
      : `${installCommandFor(packageManager)} && ${runScriptCommandFor(packageManager, "dev")}`,
    "npx @ekairos/domain inspect --baseUrl=http://localhost:3000 --admin --pretty",
    "npx @ekairos/domain seedDemo --baseUrl=http://localhost:3000 --admin --pretty",
    "npx @ekairos/domain query \"{ app_tasks: { comments: {} } }\" --baseUrl=http://localhost:3000 --admin --pretty",
  ]

  return {
    ok: true,
    directory: targetDir,
    framework: params.framework,
    installed: params.install,
    packageManager,
    provisioned: Boolean(provisioned),
    appId,
    adminToken,
    nextSteps,
  }
}
