import { defineConfig } from "vitest/config"
import { resolve } from "node:path"
import { config as dotenvConfig } from "dotenv"
import { workflow } from "@workflow/vitest"

const workspaceRoot = resolve(process.cwd(), "..", "..", "..")
dotenvConfig({ path: resolve(workspaceRoot, ".env.local"), quiet: true })
dotenvConfig({ path: resolve(workspaceRoot, ".env"), quiet: true })

export default defineConfig({
  plugins: [workflow()],
  test: {
    environment: "node",
    testTimeout: 6 * 60 * 1000,
    hookTimeout: 6 * 60 * 1000,
    reporters: ["default"],
    include: ["src/tests/**/*.workflow.integration.test.ts"],
    fileParallelism: false,
    globalSetup: ["./vitest.workflow.setup.mts"],
    setupFiles: ["./vitest.workflow.env.mts"],
  },
})
