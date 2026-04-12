/* @vitest-environment node */

import { afterEach, describe, expect, it } from "vitest"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  createDomainApp,
  type CreateDomainAppProgressEvent,
} from "../cli/create-app.js"

const tempDirs: string[] = []

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (!dir) continue
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})

describe("create-app progress", () => {
  it("emits progress events and writes the scaffold without install", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "ek-domain-create-app-"))
    tempDirs.push(targetDir)

    const events: CreateDomainAppProgressEvent[] = []
    const result = await createDomainApp({
      directory: targetDir,
      framework: "next",
      install: false,
      packageManager: "pnpm",
      onProgress(event) {
        events.push(event)
      },
    })

    expect(result.ok).toBe(true)
    expect(result.installed).toBe(false)
    expect(events.some((event) => event.stage === "prepare-target" && event.status === "running")).toBe(true)
    expect(events.some((event) => event.stage === "write-files" && event.status === "completed")).toBe(true)
    expect(events.some((event) => event.stage === "complete" && event.status === "completed" && event.progress === 100)).toBe(true)

    const packageJson = await readFile(join(targetDir, "package.json"), "utf8")
    const runtimeFile = await readFile(join(targetDir, "src", "runtime.ts"), "utf8")
    const routeFile = await readFile(
      join(targetDir, "src", "app", "api", "ekairos", "domain", "route.ts"),
      "utf8",
    )

    expect(packageJson).toContain('"next"')
    expect(packageJson).toContain('"workflow": "^5.0.0-beta.1"')
    expect(packageJson).not.toContain("@workflow/world-local")
    expect(runtimeFile).toContain("export class AppRuntime")
    expect(runtimeFile).toContain("@ekairos/domain/runtime-handle")
    expect(routeFile).toContain("createRuntimeRouteHandler")
    expect(routeFile).toContain('from "@/runtime"')
    expect(routeFile).not.toContain("@ekairos/thread")
    expect(routeFile).not.toContain(".well-known")
  })
})
