import { describe, it, expect } from "vitest"
import { Sandbox } from "@vercel/sandbox"
import { generateFilePreview } from "../filepreview"
import path from "path"
import { config as dotenvConfig } from "dotenv"
import { readFile } from "fs/promises"

dotenvConfig({ path: path.resolve(process.cwd(), ".env.local") })


describe("File preview metadata", () =>
{
    it("extracts metadata for real client dataset file CSV", async () =>
    {
        const sandbox = await Sandbox.create({
            runtime: "python3.13",
            timeout: 2 * 60 * 1000,
        })

        try
        {
            const fileId = `real-client-bid-${Date.now()}.csv`
            const sandboxPath = `/vercel/sandbox/${fileId}`
            const localCsvPath = path.resolve(__dirname, "real-client-bid-presentation-1.csv")
            const csvBuffer = await readFile(localCsvPath)

            await sandbox.writeFiles([
                {
                    path: sandboxPath,
                    content: Buffer.from(csvBuffer),
                },
            ])

            const preview = await generateFilePreview(sandbox, fileId, "dataset-real-client-test")

            expect(preview.metadata).toBeDefined()
            expect(preview.metadata?.stdout).toContain("row_count_estimate")
            expect(preview.totalRows).toBe(735)
        }
        finally
        {
            await sandbox.stop()
        }
    }, 120_000)

    it("extracts metadata for real client dataset file XLSX", async () =>
    {
        const sandbox = await Sandbox.create({
            runtime: "python3.13",
            timeout: 2 * 60 * 1000,
        })

        try
        {
            const pipInstall = await sandbox.runCommand({
                cmd: "pip",
                args: ["install", "openpyxl", "--quiet"],
            })
            await pipInstall.stderr()

            const fileId = `real-client-items-${Date.now()}.xlsx`
            const sandboxPath = `/vercel/sandbox/${fileId}`
            const localXlsxPath = path.resolve(__dirname, "real-client-items.xlsx")
            const xlsxBuffer = await readFile(localXlsxPath)

            await sandbox.writeFiles([
                {
                    path: sandboxPath,
                    content: Buffer.from(xlsxBuffer),
                },
            ])

            const preview = await generateFilePreview(sandbox, fileId, "dataset-real-client-xlsx-test")

            expect(preview.metadata).toBeDefined()
            expect(preview.metadata?.stdout).toContain("row_count_estimate")
            expect(preview.totalRows).toBe(38674)
            
            console.log("XLSX Preview Head:", preview.head?.stdout)
            console.log("XLSX Preview Mid:", preview.mid?.stdout)
            console.log("XLSX Preview Tail:", preview.tail?.stdout)
        }
        finally
        {
            await sandbox.stop()
        }
    }, 120_000)

    it("extracts metadata for real client complex table XLSX", async () =>
    {
        const sandbox = await Sandbox.create({
            runtime: "python3.13",
            timeout: 2 * 60 * 1000,
        })

        try
        {
            const pipInstall = await sandbox.runCommand({
                cmd: "pip",
                args: ["install", "openpyxl", "--quiet"],
            })
            await pipInstall.stderr()

            const fileId = `real-client-complex-table-${Date.now()}.xlsx`
            const sandboxPath = `/vercel/sandbox/${fileId}`
            const localXlsxPath = path.resolve(__dirname, "real-client-complex-table.xlsx")
            const xlsxBuffer = await readFile(localXlsxPath)

            await sandbox.writeFiles([
                {
                    path: sandboxPath,
                    content: Buffer.from(xlsxBuffer),
                },
            ])

            const preview = await generateFilePreview(sandbox, fileId, "dataset-real-client-complex-xlsx-test")

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
            await sandbox.stop()
        }
    }, 120_000)
})

