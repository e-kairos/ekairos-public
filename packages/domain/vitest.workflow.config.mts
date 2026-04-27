import { defineConfig } from "vitest/config"
import { join } from "node:path"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"

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
    include: ["src/tests/workflow/**/*.workflow.integration.test.ts"],
    globalSetup: ["./vitest.workflow.setup.mts"],
    setupFiles: ["./vitest.workflow.env.mts"],
  },
})
