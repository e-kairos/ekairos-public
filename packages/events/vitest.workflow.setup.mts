import { mkdir } from "node:fs/promises"
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


export async function setup() {
  const [{ BaseBuilder, createBaseBuilderConfig }, { initDataDir }] = await Promise.all([
    importWorkflowVitestDependency<typeof import("@workflow/builders")>("@workflow/builders"),
    importWorkflowVitestDependency<typeof import("@workflow/world-local")>("@workflow/world-local"),
  ])

  class EventsVitestWorkflowBuilder extends BaseBuilder {
    constructor(
      workingDir: string,
      private readonly outDir: string,
    ) {
      super({
        ...createBaseBuilderConfig({
          workingDir,
          dirs: ["src/tests/workflow"],
        }),
        buildTarget: "next",
        suppressCreateWorkflowsBundleLogs: true,
        suppressCreateWebhookBundleLogs: true,
        suppressCreateManifestLogs: true,
      })
    }

    get shouldLogBaseBuilderInfo() {
      return false
    }

    async build() {
      const inputFiles = await this.getInputFiles()
      await mkdir(this.outDir, { recursive: true })
      await this.createWorkflowsBundle({
        outfile: join(this.outDir, "workflows.mjs"),
        bundleFinalOutput: false,
        format: "esm",
        inputFiles,
      })
      await this.createStepsBundle({
        outfile: join(this.outDir, "steps.mjs"),
        externalizeNonSteps: false,
        rewriteTsExtensions: true,
        format: "esm",
        inputFiles,
      })
    }
  }

  const cwd = process.cwd()
  const outDir = join(cwd, ".workflow-vitest")
  const builder = new EventsVitestWorkflowBuilder(cwd, outDir)
  await builder.build()
  await initDataDir(join(cwd, ".workflow-data"))
}
