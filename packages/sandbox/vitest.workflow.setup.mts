import { rm } from "node:fs/promises"
import { resolve } from "node:path"
import { config as dotenvConfig } from "dotenv"
import { buildWorkflowTests } from "@workflow/vitest"

export async function setup() {
  const workspaceRoot = resolve(process.cwd(), "..", "..")
  dotenvConfig({ path: resolve(workspaceRoot, ".env.local"), quiet: true })
  dotenvConfig({ path: resolve(workspaceRoot, ".env"), quiet: true })
  await rm(resolve(process.cwd(), ".workflow-data"), { recursive: true, force: true })
  await buildWorkflowTests()
}
