import { describe, it, expect } from "vitest"
import { generateFilePreview } from "../filepreview"
import path from "path"
import { config as dotenvConfig } from "dotenv"
import { readFile } from "fs/promises"
import {
    createDatasetSandboxStep,
    runDatasetSandboxCommandStep,
    stopDatasetSandboxStep,
    writeDatasetSandboxFilesStep,
} from "../../sandbox/steps"

dotenvConfig({ path: path.resolve(process.cwd(), ".env.local") })


describe.skip("File preview metadata (moved to src/tests)", () =>
{
    it("extracts metadata for real client dataset file CSV", async () =>
    {
        const env = { orgId: process.env.EKAIROS_ORG_ID as string }
        const created = await createDatasetSandboxStep({ env, runtime: "python3.13", timeoutMs: 2 * 60 * 1000 })

        try
        {
            const fileId = `real-client-bid-${Date.now()}.csv`
            const sandboxPath = `/vercel/sandbox/${fileId}`
            const localCsvPath = path.resolve(__dirname, "real-client-bid-presentation-1.csv")
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

            const preview = await generateFilePreview(env, created.sandboxId, sandboxPath, "dataset-real-client-test")

            expect(preview.metadata).toBeDefined()
            expect(preview.metadata?.stdout).toContain("row_count_estimate")
            expect(preview.totalRows).toBe(735)
        }
        finally
        {
            await stopDatasetSandboxStep({ env, sandboxId: created.sandboxId })
        }
    }, 120_000)

    it("extracts metadata for real client dataset file XLSX", async () =>
    {
        const env = { orgId: process.env.EKAIROS_ORG_ID as string }
        const created = await createDatasetSandboxStep({ env, runtime: "python3.13", timeoutMs: 2 * 60 * 1000 })

        try
        {
            await runDatasetSandboxCommandStep({
                env,
                sandboxId: created.sandboxId,
                cmd: "pip",
                args: ["install", "openpyxl", "--quiet"],
            })

            const fileId = `real-client-items-${Date.now()}.xlsx`
            const sandboxPath = `/vercel/sandbox/${fileId}`
            const localXlsxPath = path.resolve(__dirname, "real-client-items.xlsx")
            const xlsxBuffer = await readFile(localXlsxPath)

            await writeDatasetSandboxFilesStep({
                env,
                sandboxId: created.sandboxId,
                files: [
                    {
                        path: sandboxPath,
                        contentBase64: Buffer.from(xlsxBuffer).toString("base64"),
                    },
                ],
            })

            const preview = await generateFilePreview(env, created.sandboxId, sandboxPath, "dataset-real-client-xlsx-test")

            expect(preview.metadata).toBeDefined()
            expect(preview.metadata?.stdout).toContain("row_count_estimate")
            expect(preview.totalRows).toBe(38674)
            
            console.log("XLSX Preview Head:", preview.head?.stdout)
            console.log("XLSX Preview Mid:", preview.mid?.stdout)
            console.log("XLSX Preview Tail:", preview.tail?.stdout)
        }
        finally
        {
            await stopDatasetSandboxStep({ env, sandboxId: created.sandboxId })
        }
    }, 120_000)

    it("extracts metadata for real client complex table XLSX", async () =>
    {
        const env = { orgId: process.env.EKAIROS_ORG_ID as string }
        const created = await createDatasetSandboxStep({ env, runtime: "python3.13", timeoutMs: 2 * 60 * 1000 })

        try
        {
            await runDatasetSandboxCommandStep({
                env,
                sandboxId: created.sandboxId,
                cmd: "pip",
                args: ["install", "openpyxl", "--quiet"],
            })

            const fileId = `real-client-complex-table-${Date.now()}.xlsx`
            const sandboxPath = `/vercel/sandbox/${fileId}`
            const localXlsxPath = path.resolve(__dirname, "real-client-complex-table.xlsx")
            const xlsxBuffer = await readFile(localXlsxPath)

            await writeDatasetSandboxFilesStep({
                env,
                sandboxId: created.sandboxId,
                files: [
                    {
                        path: sandboxPath,
                        contentBase64: Buffer.from(xlsxBuffer).toString("base64"),
                    },
                ],
            })

            const preview = await generateFilePreview(env, created.sandboxId, sandboxPath, "dataset-real-client-complex-xlsx-test")

            expect(preview.metadata).toBeDefined()
            expect(preview.metadata?.stdout).toContain("row_count_estimate")
            // You may want to refine the expected row count below if you know it in advance
            expect(typeof preview.totalRows).toBe("number")
            expect(preview.totalRows).toBeGreaterThan(0)
            
            console.log("Complex XLSX Preview Head:", preview.head?.stdout)
            console.log("Complex XLSX Preview Mid:", preview.mid?.stdout)
            console.log("Complex XLSX Preview Tail:", preview.tail?.stdout)
        }
        finally
        {
            await stopDatasetSandboxStep({ env, sandboxId: created.sandboxId })
        }
    }, 120_000)
})

