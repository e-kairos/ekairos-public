import { it, expect } from "vitest"
import { config as dotenvConfig } from "dotenv"
import path from "path"
import { readFile } from "fs/promises"
import { configureDatasetTestRuntime } from "./_runtime"
import {
  createDatasetSandboxStep,
  stopDatasetSandboxStep,
  writeDatasetSandboxFilesStep,
} from "../sandbox/steps"
import { generateFilePreview } from "../file/filepreview"
import { describeInstant, hasInstantAdmin, setupInstantTestEnv } from "./_env"

// Load env from repo root (tests run with cwd = packages/dataset)
dotenvConfig({ path: path.resolve(__dirname, "..", "..", "..", "..", ".env.local") })
dotenvConfig({ path: path.resolve(__dirname, "..", "..", "..", "..", ".env") })

await setupInstantTestEnv("dataset-file-preview")
if (hasInstantAdmin()) {
  await configureDatasetTestRuntime()
}

describeInstant("File preview (sample.csv)", () => {
  it("extracts metadata", async () => {
    const env = { orgId: "test-org" }
    const created = await createDatasetSandboxStep({
      env,
      runtime: "python3.13",
      timeoutMs: 2 * 60 * 1000,
    })

    try {
      const sandboxPath = "/vercel/sandbox/sample.csv"
      const localCsvPath = path.resolve(__dirname, "fixtures", "sample.csv")
      const csvBuffer = await readFile(localCsvPath)

      await writeDatasetSandboxFilesStep({
        env,
        sandboxId: created.sandboxId,
        files: [
          {
            path: sandboxPath,
            contentBase64: Buffer.from(csvBuffer).toString("base64"),
          },
        ],
      })

      const preview = await generateFilePreview(env, created.sandboxId, sandboxPath, "dataset-sample-test")
      expect(preview.metadata).toBeDefined()
      expect(typeof preview.totalRows).toBe("number")
      expect(preview.totalRows).toBeGreaterThan(0)
    } finally {
      await stopDatasetSandboxStep({ env, sandboxId: created.sandboxId })
    }
  }, 120_000)
})

