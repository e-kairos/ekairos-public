import { spawn } from "node:child_process"
import { access, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { PlatformApi } from "@instantdb/platform"
import { i } from "@instantdb/core"
import { domain } from "../index.js"

export type CreateDomainAppProgressStage =
  | "prepare-target"
  | "detect-package-manager"
  | "resolve-version"
  | "provision-instant"
  | "write-files"
  | "write-env"
  | "install"
  | "complete"

export type CreateDomainAppProgressEvent = {
  stage: CreateDomainAppProgressStage
  status: "running" | "completed" | "log"
  message: string
  progress?: number
}

export type CreateDomainAppParams = {
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
  onProgress?: (event: CreateDomainAppProgressEvent) => void | Promise<void>
}

export type CreateDomainAppResult = {
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
const TEMPLATE_WORKFLOW_VERSION = "^5.0.0-beta.1"

function trimOrEmpty(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

async function emitProgress(
  onProgress: CreateDomainAppParams["onProgress"],
  event: CreateDomainAppProgressEvent,
) {
  if (!onProgress) return
  await onProgress(event)
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

async function runInstall(
  targetDir: string,
  packageManager: string,
  onProgress?: CreateDomainAppParams["onProgress"],
) {
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
    const emitChunk = (() => {
      let buffer = ""
      return async (chunk: string) => {
        buffer += chunk
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() ?? ""
        for (const line of lines) {
          const text = line.trim()
          if (!text) continue
          await emitProgress(onProgress, {
            stage: "install",
            status: "log",
            message: text,
          })
        }
      }
    })()

    const child = spawn(command, args, {
      cwd: targetDir,
      env: process.env,
      shell: process.platform === "win32",
      stdio: "pipe",
    })

    let stderr = ""
    child.stdout.on("data", (chunk) => {
      void emitChunk(chunk.toString())
    })
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString()
      stderr += text
      void emitChunk(text)
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
    return version
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
        ? "pnpm@10.15.1"
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
      "This scaffold ships a small task domain and a live domain showcase UI:",
      "- inspect the domain through the well-known endpoint",
      "- fetch the manifest and data directly from the app UI",
      "- create tasks and seed demo data through domain actions",
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
      "",
      "const nextConfig: NextConfig = {",
      "  transpilePackages: [\"@ekairos/domain\"],",
      "};",
      "",
      "export default withWorkflow(nextConfig) as NextConfig;",
    ].join("\n"),
    "src/app/api/ekairos/domain/route.ts": [
      'import { createRuntimeRouteHandler } from "@ekairos/domain/next";',
      'import { createRuntime } from "@/runtime";',
      "",
      "export const { GET, POST } = createRuntimeRouteHandler({",
      "  createRuntime,",
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
      "  --bg: #efe7da;",
      "  --panel: #fffdf7;",
      "  --panel-strong: #fff8ec;",
      "  --ink: #1d1b19;",
      "  --muted: #60584d;",
      "  --accent: #0f766e;",
      "  --accent-soft: #d9f3ef;",
      "  --border: #d7cebf;",
      "  --danger: #b42318;",
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
      "  background:",
      "    radial-gradient(circle at top, #fff8ee 0%, rgba(255, 248, 238, 0.7) 28%, transparent 65%),",
      "    linear-gradient(180deg, #f7f0e4 0%, var(--bg) 100%);",
      "  color: var(--ink);",
      '  font-family: "Segoe UI", sans-serif;',
      "}",
      "",
      "body {",
      "  min-height: 100vh;",
      "}",
      "",
      "button,",
      "input {",
      "  font: inherit;",
      "}",
      "",
      "main {",
      "  max-width: 1180px;",
      "  margin: 0 auto;",
      "  padding: 48px 24px 72px;",
      "}",
      "",
      ".hero {",
      "  display: grid;",
      "  gap: 18px;",
      "  max-width: 860px;",
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
      "h1,",
      "h2 {",
      "  margin: 0;",
      "  line-height: 0.96;",
      "}",
      "",
      "h1 {",
      "  font-size: clamp(2.7rem, 6vw, 5.4rem);",
      "}",
      "",
      "h2 {",
      "  font-size: 1.4rem;",
      "}",
      "",
      "p {",
      "  margin: 0;",
      "  color: var(--muted);",
      "  line-height: 1.65;",
      "}",
      "",
      ".shell {",
      "  display: grid;",
      "  gap: 20px;",
      "  margin-top: 32px;",
      "}",
      "",
      ".stat-grid {",
      "  display: grid;",
      "  gap: 16px;",
      "  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));",
      "}",
      "",
      ".grid {",
      "  display: grid;",
      "  gap: 20px;",
      "}",
      "",
      ".showcase-grid {",
      "  align-items: start;",
      "}",
      "",
      ".panel-tall,",
      ".panel-wide,",
      ".stat-card {",
      "  min-height: 100%;",
      "}",
      "",
      ".card {",
      "  background: linear-gradient(180deg, var(--panel) 0%, var(--panel-strong) 100%);",
      "  border: 1px solid var(--border);",
      "  border-radius: 24px;",
      "  padding: 22px;",
      "  box-shadow: 0 18px 45px rgba(23, 23, 23, 0.06);",
      "}",
      "",
      ".stat-card strong {",
      "  display: block;",
      "  margin-top: 8px;",
      "  font-size: 2rem;",
      "}",
      "",
      ".panel-head {",
      "  display: flex;",
      "  align-items: flex-start;",
      "  justify-content: space-between;",
      "  gap: 16px;",
      "  margin-bottom: 12px;",
      "}",
      "",
      ".manifest-list,",
      ".action-list,",
      ".task-list,",
      ".comment-list {",
      "  display: grid;",
      "  gap: 12px;",
      "}",
      "",
      ".manifest-list {",
      "  margin: 18px 0;",
      "}",
      "",
      ".manifest-list > div {",
      "  display: flex;",
      "  justify-content: space-between;",
      "  gap: 16px;",
      "  border-bottom: 1px dashed var(--border);",
      "  padding-bottom: 10px;",
      "}",
      "",
      ".manifest-label {",
      "  color: var(--muted);",
      "  font-weight: 600;",
      "}",
      "",
      ".field {",
      "  display: grid;",
      "  gap: 8px;",
      "  margin: 18px 0;",
      "}",
      "",
      ".field span {",
      "  font-size: 0.92rem;",
      "  font-weight: 600;",
      "}",
      "",
      ".input {",
      "  width: 100%;",
      "  border: 1px solid var(--border);",
      "  border-radius: 16px;",
      "  padding: 14px 16px;",
      "  background: #fff;",
      "  color: var(--ink);",
      "}",
      "",
      ".button-row {",
      "  display: flex;",
      "  flex-wrap: wrap;",
      "  gap: 12px;",
      "  margin-bottom: 18px;",
      "}",
      "",
      ".button {",
      "  appearance: none;",
      "  border: 0;",
      "  border-radius: 999px;",
      "  padding: 12px 18px;",
      "  background: var(--ink);",
      "  color: #fffdf7;",
      "  display: inline-flex;",
      "  align-items: center;",
      "  justify-content: center;",
      "  gap: 10px;",
      "  cursor: pointer;",
      "  transition: transform 120ms ease, opacity 120ms ease, background 120ms ease;",
      "}",
      "",
      ".button:hover:not(:disabled) {",
      "  transform: translateY(-1px);",
      "}",
      "",
      ".button:disabled {",
      "  cursor: wait;",
      "  opacity: 0.72;",
      "}",
      "",
      ".button.ghost {",
      "  background: transparent;",
      "  color: var(--ink);",
      "  border: 1px solid var(--border);",
      "}",
      "",
      ".spinner {",
      "  width: 14px;",
      "  height: 14px;",
      "  border-radius: 999px;",
      "  border: 2px solid rgba(255, 253, 247, 0.35);",
      "  border-top-color: currentColor;",
      "  animation: spin 0.8s linear infinite;",
      "}",
      "",
      ".button.ghost .spinner {",
      "  border-color: rgba(29, 27, 25, 0.18);",
      "  border-top-color: currentColor;",
      "}",
      "",
      ".status-pill {",
      "  display: inline-flex;",
      "  align-items: center;",
      "  justify-content: center;",
      "  padding: 6px 10px;",
      "  border-radius: 999px;",
      "  background: var(--accent-soft);",
      "  color: var(--accent);",
      "  font-size: 12px;",
      "  font-weight: 700;",
      "  letter-spacing: 0.04em;",
      "  text-transform: uppercase;",
      "}",
      "",
      ".task-card {",
      "  display: grid;",
      "  gap: 10px;",
      "  padding: 16px;",
      "  border-radius: 18px;",
      "  border: 1px solid var(--border);",
      "  background: rgba(255, 255, 255, 0.72);",
      "}",
      "",
      ".task-head {",
      "  display: flex;",
      "  align-items: center;",
      "  justify-content: space-between;",
      "  gap: 12px;",
      "}",
      "",
      ".comment-item {",
      "  display: flex;",
      "  align-items: flex-start;",
      "  gap: 10px;",
      "  color: var(--muted);",
      "}",
      "",
      ".comment-dot {",
      "  width: 8px;",
      "  height: 8px;",
      "  margin-top: 8px;",
      "  border-radius: 999px;",
      "  background: var(--accent);",
      "  flex: 0 0 auto;",
      "}",
      "",
      ".action-item {",
      "  display: grid;",
      "  gap: 4px;",
      "  padding: 12px 14px;",
      "  border-radius: 16px;",
      "  background: rgba(15, 118, 110, 0.06);",
      "}",
      "",
      ".muted {",
      "  color: var(--muted);",
      "}",
      "",
      ".empty-state,",
      ".error-banner {",
      "  border-radius: 18px;",
      "  padding: 16px;",
      "}",
      "",
      ".empty-state {",
      "  background: rgba(15, 118, 110, 0.06);",
      "  color: var(--muted);",
      "}",
      "",
      ".error-banner {",
      "  background: rgba(180, 35, 24, 0.08);",
      "  color: var(--danger);",
      "  border: 1px solid rgba(180, 35, 24, 0.16);",
      "}",
      "",
      "pre {",
      "  overflow: auto;",
      "  border-radius: 16px;",
      "  padding: 14px;",
      "  background: #171717;",
      "  color: #f6f6f6;",
      "  font-size: 13px;",
      "  line-height: 1.5;",
      "}",
      "",
      "code {",
      '  font-family: "Cascadia Code", monospace;',
      "}",
      "",
      "@keyframes spin {",
      "  to { transform: rotate(360deg); }",
      "}",
      "",
      "@media (min-width: 940px) {",
      "  .showcase-grid {",
      "    grid-template-columns: 1.05fr 0.95fr;",
      "  }",
      "",
      "  .panel-wide {",
      "    grid-column: 1 / -1;",
      "  }",
      "}",
      "",
      "@media (max-width: 720px) {",
      "  main {",
      "    padding: 32px 16px 56px;",
      "  }",
      "",
      "  .task-head,",
      "  .manifest-list > div,",
      "  .panel-head {",
      "    grid-template-columns: 1fr;",
      "    display: grid;",
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
      'import DomainShowcase from "./domain-showcase";',
      "",
      'export const dynamic = "force-dynamic";',
      "",
      "export default function HomePage() {",
      "  return (",
      "    <main>",
      '      <section className="hero">',
      '        <div className="eyebrow">Ekairos Domain Scaffold</div>',
      "        <h1>See your domain. Query it. Trigger an action.</h1>",
      "        <p>",
      "          This template turns the app itself into a live domain showroom: it reads the manifest,",
      "          queries nested data, and lets you execute actions from the UI with direct API calls.",
      "        </p>",
      "      </section>",
      "",
      "      <DomainShowcase />",
      "    </main>",
      "  );",
      "}",
    ].join("\n"),
    "src/app/domain-showcase.tsx": [
      '"use client";',
      "",
      'import { useEffect, useMemo, useState } from "react";',
      "",
      "type ManifestAction = {",
      "  name: string;",
      "  key?: string | null;",
      "  description?: string | null;",
      "};",
      "",
      "type DomainManifest = {",
      "  ok?: boolean;",
      "  instant?: { appId?: string | null };",
      "  auth?: { required?: boolean };",
      "  contextString?: string | null;",
      "  domain?: { entities?: string[]; links?: string[]; rooms?: string[] };",
      "  actions?: ManifestAction[];",
      "};",
      "",
      "type TaskComment = {",
      "  id?: string;",
      "  body?: string;",
      "  createdAt?: number;",
      "};",
      "",
      "type TaskRow = {",
      "  id?: string;",
      "  title?: string;",
      "  status?: string;",
      "  createdAt?: number;",
      "  comments?: TaskComment[] | TaskComment;",
      "};",
      "",
      "async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {",
      "  const response = await fetch(input, {",
      "    ...init,",
      "    headers: {",
      '      "content-type": "application/json",',
      "      ...(init?.headers ?? {}),",
      "    },",
      "    cache: 'no-store',",
      "  });",
      "  const text = await response.text();",
      "  if (!response.ok) {",
      "    throw new Error(text || `request_failed:${response.status}`);",
      "  }",
      "  return (text ? JSON.parse(text) : null) as T;",
      "}",
      "",
      "function asArray<T>(value: T | T[] | null | undefined): T[] {",
      "  if (!value) return [];",
      "  return Array.isArray(value) ? value : [value];",
      "}",
      "",
      "function formatTime(value?: number) {",
      "  if (!value) return 'now';",
      "  try {",
      "    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));",
      "  } catch {",
      "    return String(value);",
      "  }",
      "}",
      "",
      "export default function DomainShowcase() {",
      "  const [manifest, setManifest] = useState<DomainManifest | null>(null);",
      "  const [tasks, setTasks] = useState<TaskRow[]>([]);",
      "  const [draftTitle, setDraftTitle] = useState('Ship a polished domain demo');",
      "  const [loadingAction, setLoadingAction] = useState<string | null>(null);",
      "  const [loadingData, setLoadingData] = useState(true);",
      "  const [error, setError] = useState<string | null>(null);",
      "  const [lastResult, setLastResult] = useState<unknown>(null);",
      "",
      "  const counts = useMemo(() => ({",
      "    entities: manifest?.domain?.entities?.length ?? 0,",
      "    links: manifest?.domain?.links?.length ?? 0,",
      "    actions: manifest?.actions?.length ?? 0,",
      "    tasks: tasks.length,",
      "  }), [manifest, tasks]);",
      "",
      "  async function refresh() {",
      "    setLoadingData(true);",
      "    setError(null);",
      "    try {",
      "      const manifestData = await requestJson<DomainManifest>('/api/ekairos/domain', { method: 'GET' });",
      "      setManifest(manifestData);",
      "",
      "      const queryData = await requestJson<{ data?: { app_tasks?: TaskRow[] } }>('/api/ekairos/domain', {",
      "        method: 'POST',",
      "        body: JSON.stringify({",
      "          op: 'query',",
      "          query: {",
      "            app_tasks: {",
      "              $: { order: { createdAt: 'desc' }, limit: 20 },",
      "              comments: {},",
      "            },",
      "          },",
      "        }),",
      "      });",
      "",
      "      setTasks(Array.isArray(queryData?.data?.app_tasks) ? queryData.data.app_tasks : []);",
      "    } catch (nextError) {",
      "      setError(nextError instanceof Error ? nextError.message : String(nextError));",
      "    } finally {",
      "      setLoadingData(false);",
      "    }",
      "  }",
      "",
      "  useEffect(() => {",
      "    void refresh();",
      "  }, []);",
      "",
      "  async function runAction(action: string, input: Record<string, unknown>) {",
      "    setLoadingAction(action);",
      "    setError(null);",
      "    try {",
      "      const result = await requestJson('/api/ekairos/domain', {",
      "        method: 'POST',",
      "        body: JSON.stringify({ op: 'action', action, input }),",
      "      });",
      "      setLastResult(result);",
      "      await refresh();",
      "    } catch (nextError) {",
      "      setError(nextError instanceof Error ? nextError.message : String(nextError));",
      "    } finally {",
      "      setLoadingAction(null);",
      "    }",
      "  }",
      "",
      "  return (",
      '    <section className="shell">',
      '      <div className="stat-grid">',
      '        <article className="card stat-card"><span className="eyebrow">Entities</span><strong>{counts.entities}</strong></article>',
      '        <article className="card stat-card"><span className="eyebrow">Links</span><strong>{counts.links}</strong></article>',
      '        <article className="card stat-card"><span className="eyebrow">Actions</span><strong>{counts.actions}</strong></article>',
      '        <article className="card stat-card"><span className="eyebrow">Tasks</span><strong>{counts.tasks}</strong></article>',
      "      </div>",
      "",
      '      <div className="grid showcase-grid">',
      '        <article className="card panel-tall">',
      '          <div className="panel-head">',
      '            <div>',
      '              <span className="eyebrow">Domain Manifest</span>',
      '              <h2>Live contract</h2>',
      "            </div>",
      "            <button className=\"button ghost\" onClick={() => void refresh()} disabled={loadingData}>",
      '              {loadingData ? <span className="spinner" aria-hidden="true" /> : null}',
      "              Refresh",
      "            </button>",
      "          </div>",
      '          <p className="muted">The UI calls the same Ekairos runtime route your CLI uses.</p>',
      '          <div className="manifest-list">',
      '            <div><span className="manifest-label">App ID</span><span>{manifest?.instant?.appId ?? "not configured yet"}</span></div>',
      '            <div><span className="manifest-label">Auth</span><span>{manifest?.auth?.required ? "required" : "open"}</span></div>',
      '            <div><span className="manifest-label">Entities</span><span>{(manifest?.domain?.entities ?? []).join(", ") || "none"}</span></div>',
      '            <div><span className="manifest-label">Links</span><span>{(manifest?.domain?.links ?? []).join(", ") || "none"}</span></div>',
      "          </div>",
      '          <pre><code>{manifest?.contextString ?? "Context string will appear here after the first fetch."}</code></pre>',
      "        </article>",
      "",
      '        <article className="card panel-tall">',
      '          <div className="panel-head">',
      '            <div>',
      '              <span className="eyebrow">Action Demo</span>',
      '              <h2>Trigger the domain</h2>',
      "            </div>",
      "          </div>",
      '          <p className="muted">Use the API directly. Click one action and watch the data refresh below.</p>',
      '          <label className="field">',
      '            <span>Task title</span>',
      '            <input',
      '              className="input"',
      '              value={draftTitle}',
      '              onChange={(event) => setDraftTitle(event.target.value)}',
      '              placeholder="Name your first task"',
      "            />",
      "          </label>",
      '          <div className="button-row">',
      "            <button",
      '              className="button"',
      "              disabled={loadingAction !== null}",
      "              onClick={() => void runAction('app.task.create', { title: draftTitle, status: 'manual' })}",
      "            >",
      '              {loadingAction === "app.task.create" ? <span className="spinner" aria-hidden="true" /> : null}',
      "              Create Task",
      "            </button>",
      "            <button",
      '              className="button ghost"',
      "              disabled={loadingAction !== null}",
      "              onClick={() => void runAction('app.demo.seed', {})}",
      "            >",
      '              {loadingAction === "app.demo.seed" ? <span className="spinner" aria-hidden="true" /> : null}',
      "              Seed Demo",
      "            </button>",
      "          </div>",
      '          <div className="action-list">',
      '            {(manifest?.actions ?? []).map((action) => (',
      '              <div className="action-item" key={action.name}>',
      '                <strong>{action.key ?? action.name}</strong>',
      '                <span>{action.description ?? action.name}</span>',
      "              </div>",
      "            ))}",
      "          </div>",
      '          <pre><code>{lastResult ? JSON.stringify(lastResult, null, 2) : "Action results will appear here."}</code></pre>',
      "        </article>",
      "",
      '        <article className="card panel-wide">',
      '          <div className="panel-head">',
      '            <div>',
      '              <span className="eyebrow">Query Result</span>',
      '              <h2>Nested task data</h2>',
      "            </div>",
      '            <span className="status-pill">{loadingData ? "syncing" : `${tasks.length} rows`}</span>',
      "          </div>",
      '          <p className="muted">This list comes from a direct `op: "query"` call to the domain API.</p>',
      '          {tasks.length === 0 ? <div className="empty-state">No tasks yet. Click <strong>Seed Demo</strong> to populate the canvas.</div> : null}',
      '          <div className="task-list">',
      '            {tasks.map((task, index) => (',
      '              <article className="task-card" key={task.id ?? `${task.title ?? "task"}-${index}`}>',
      '                <div className="task-head">',
      '                  <strong>{task.title ?? "Untitled task"}</strong>',
      '                  <span className="status-pill">{task.status ?? "draft"}</span>',
      "                </div>",
      '                <span className="muted">{formatTime(task.createdAt)}</span>',
      '                <div className="comment-list">',
      '                  {asArray(task.comments).map((comment, commentIndex) => (',
      '                    <div className="comment-item" key={comment.id ?? `${index}-${commentIndex}`}>',
      '                      <span className="comment-dot" />',
      '                      <span>{comment.body ?? "Empty comment"}</span>',
      "                    </div>",
      "                  ))}",
      "                </div>",
      "              </article>",
      "            ))}",
      "          </div>",
      "        </article>",
      "      </div>",
      "",
      '      {error ? <div className="error-banner">{error}</div> : null}',
      "    </section>",
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
      "export const createTaskAction = defineDomainAction<",
      "  Record<string, unknown>,",
      "  { title?: string; status?: string },",
      "  { taskId: string },",
      "  any",
      ">({",
      '  name: "app.task.create",',
      "  async execute({ runtime, input }): Promise<{ taskId: string }> {",
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
      "export const addTaskCommentAction = defineDomainAction<",
      "  Record<string, unknown>,",
      "  { taskId?: string; body?: string },",
      "  { commentId: string; taskId: string },",
      "  any",
      ">({",
      '  name: "app.task.comment.add",',
      "  async execute({ runtime, input }): Promise<{ commentId: string; taskId: string }> {",
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
      "export const seedDemoAction = defineDomainAction<",
      "  Record<string, unknown>,",
      "  Record<string, never>,",
      "  { taskId: string },",
      "  any",
      ">({",
      '  name: "app.demo.seed",',
      "  async execute({ runtime }): Promise<{ taskId: string }> {",
      '    "use step";',
      "    const scoped = await runtime.use(appDomain);",
      "    const taskId = randomUUID();",
      "    const commentId = randomUUID();",
      "    await scoped.db.transact([",
      "      scoped.db.tx.app_tasks[taskId].update({",
      '        title: "Ship the first Ekairos loop",',
      '        status: "ready",',
      "        createdAt: Date.now(),",
      "      }),",
      "      scoped.db.tx.app_task_comments[commentId].update({",
      '        body: "Query me with app_tasks -> comments to validate the full CLI path.",',
      "        createdAt: Date.now(),",
      "      }),",
      "      scoped.db.tx.app_task_comments[commentId].link({ task: taskId }),",
      "    ]);",
      "    return { taskId };",
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
      'import { init } from "@instantdb/admin";',
      'import { EkairosRuntime } from "@ekairos/domain/runtime-handle";',
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
      "export class AppRuntime extends EkairosRuntime<AppRuntimeEnv, typeof appDomain, any> {",
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
      "    } as any) as any;",
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
      "  const created = (await executeRuntimeAction({",
      "    runtime,",
      '    action: "app.task.create",',
      "    input: { title: input.title, status: \"workflow\" },",
      "  })) as { taskId: string };",
      "",
      '  const comment = String(input.comment ?? "").trim();',
      "  if (comment) {",
      "    await executeRuntimeAction({",
      "      runtime,",
      '      action: "app.task.comment.add",',
      "      input: { taskId: created.taskId, body: comment },",
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
  await emitProgress(params.onProgress, {
    stage: "prepare-target",
    status: "running",
    message: `Preparing ${targetDir}`,
    progress: 5,
  })
  await ensureWritableTargetDirectory(targetDir, params.force)
  await emitProgress(params.onProgress, {
    stage: "prepare-target",
    status: "completed",
    message: "Target ready",
    progress: 12,
  })

  await emitProgress(params.onProgress, {
    stage: "detect-package-manager",
    status: "running",
    message: "Detecting package manager",
    progress: 16,
  })
  const packageManager = await detectPackageManager(params.packageManager, params.workspacePath)
  await emitProgress(params.onProgress, {
    stage: "detect-package-manager",
    status: "completed",
    message: `Using ${packageManager}`,
    progress: 22,
  })

  await emitProgress(params.onProgress, {
    stage: "resolve-version",
    status: "running",
    message: "Resolving @ekairos/domain version",
    progress: 26,
  })
  const domainVersion = await readDomainPackageVersion()
  await emitProgress(params.onProgress, {
    stage: "resolve-version",
    status: "completed",
    message: `Version ${domainVersion}`,
    progress: 30,
  })

  const explicitAppId = trimOrEmpty(params.appId)
  const explicitAdminToken = trimOrEmpty(params.adminToken)
  const shouldProvision =
    Boolean(trimOrEmpty(params.instantToken)) &&
    (!explicitAppId || !explicitAdminToken)

  let provisioned: Awaited<ReturnType<typeof provisionInstantApp>> | null = null
  if (shouldProvision) {
    await emitProgress(params.onProgress, {
      stage: "provision-instant",
      status: "running",
      message: "Provisioning Instant app",
      progress: 38,
    })
    provisioned = await provisionInstantApp({
      directory: targetDir,
      instantToken: trimOrEmpty(params.instantToken),
      orgId: params.orgId,
    })
    await emitProgress(params.onProgress, {
      stage: "provision-instant",
      status: "completed",
      message: `Provisioned ${provisioned.appId}`,
      progress: 50,
    })
  }

  const appId = explicitAppId || provisioned?.appId || null
  const adminToken = explicitAdminToken || provisioned?.adminToken || null

  await emitProgress(params.onProgress, {
    stage: "write-files",
    status: "running",
    message: "Writing scaffold files",
    progress: 58,
  })
  const files = buildNextTemplateFiles({
    targetDir,
    domainVersion,
    packageManager,
    workspacePath: params.workspacePath,
  })
  await writeScaffoldFiles(targetDir, files)
  await emitProgress(params.onProgress, {
    stage: "write-files",
    status: "completed",
    message: "Scaffold files written",
    progress: 72,
  })

  if (appId && adminToken) {
    await emitProgress(params.onProgress, {
      stage: "write-env",
      status: "running",
      message: "Writing .env.local",
      progress: 78,
    })
    await writeFile(
      join(targetDir, ".env.local"),
      [
        `NEXT_PUBLIC_INSTANT_APP_ID=${appId}`,
        `INSTANT_ADMIN_TOKEN=${adminToken}`,
        "",
      ].join("\n"),
      "utf8",
    )
    await emitProgress(params.onProgress, {
      stage: "write-env",
      status: "completed",
      message: ".env.local ready",
      progress: 84,
    })
  }

  if (params.install) {
    await emitProgress(params.onProgress, {
      stage: "install",
      status: "running",
      message: `Installing dependencies with ${packageManager}`,
      progress: 88,
    })
    await runInstall(targetDir, packageManager, params.onProgress)
    await emitProgress(params.onProgress, {
      stage: "install",
      status: "completed",
      message: "Dependencies installed",
      progress: 96,
    })
  }

  const nextSteps = [
    `cd ${targetDir}`,
    params.install
      ? runScriptCommandFor(packageManager, "dev")
      : `${installCommandFor(packageManager)} && ${runScriptCommandFor(packageManager, "dev")}`,
    "Open http://localhost:3000 and click Seed Demo in the showcase UI",
    "npx @ekairos/domain inspect --baseUrl=http://localhost:3000 --admin --pretty",
    "npx @ekairos/domain seedDemo --baseUrl=http://localhost:3000 --admin --pretty",
    "npx @ekairos/domain query \"{ app_tasks: { comments: {} } }\" --baseUrl=http://localhost:3000 --admin --pretty",
  ]

  const result: CreateDomainAppResult = {
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

  await emitProgress(params.onProgress, {
    stage: "complete",
    status: "completed",
    message: "App scaffolded successfully",
    progress: 100,
  })

  return result
}
