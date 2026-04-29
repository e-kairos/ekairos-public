import { join, resolve } from "node:path"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import { defineConfig } from "vitest/config"

async function importWorkflowVitestDependency<T>(specifier: string): Promise<T> {
  const require = createRequire(import.meta.url)
  const vitestEntry = require.resolve("@workflow/vitest")
  const packageRoot = join(vitestEntry, "..", "..")
  const nodeModulesRoot = join(packageRoot, "..", "..")
  const target = join(nodeModulesRoot, specifier, "dist", "index.js")
  return (await import(pathToFileURL(target).href)) as T
}

const { workflowTransformPlugin } = await importWorkflowVitestDependency<
  typeof import("@workflow/rollup")
>("@workflow/rollup")

export default defineConfig({
  resolve: {
    alias: [
      { find: "@ekairos/domain/runtime", replacement: resolve(__dirname, "..", "domain", "src", "runtime.ts") },
      { find: "@ekairos/domain", replacement: resolve(__dirname, "..", "domain", "src", "index.ts") },
      { find: "@ekairos/events/runtime", replacement: resolve(__dirname, "..", "events", "src", "runtime.ts") },
      { find: "@ekairos/events", replacement: resolve(__dirname, "..", "events", "src", "index.ts") },
      { find: "@ekairos/sandbox", replacement: resolve(__dirname, "..", "sandbox", "src", "index.ts") },
      { find: "@ekairos/sandbox/schema", replacement: resolve(__dirname, "..", "sandbox", "src", "schema.ts") },
    ],
  },
  plugins: [
    workflowTransformPlugin({
      exclude: [join(process.cwd(), ".workflow-vitest") + "/"],
    }),
  ],
  test: {
    environment: "node",
    testTimeout: 6 * 60 * 1000,
    hookTimeout: 6 * 60 * 1000,
    reporters: ["default"],
    include: ["src/tests/**/*.workflow.integration.test.ts"],
    globalSetup: ["./vitest.workflow.setup.mts"],
    setupFiles: ["./vitest.workflow.env.mts"],
  },
})
