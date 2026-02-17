dotenvConfig({ path: path.resolve(process.cwd(), ".env.local") })

import { describe, it, expect } from "vitest"
import { config as dotenvConfig } from "dotenv"
import * as path from "path"
import { promises as fs } from "fs"
import { init } from "@instantdb/admin"
import { parseAndStoreDocument, processBatchDocuments } from "../document-parser"

const adminDb = init({
    appId: process.env.NEXT_PUBLIC_INSTANT_APP_ID as string,
    adminToken: process.env.INSTANT_APP_ADMIN_TOKEN as string
})

describe("DocumentParser", () => {
    it("parses-and-stores-pdf-document", async () => {
        const pdfPath = path.resolve(__dirname, "sample.pdf")
        const pdfBuffer = await fs.readFile(pdfPath)
        const storagePath = `/tests/documents/${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`
        
        const uploadResult = await adminDb.storage.uploadFile(storagePath, pdfBuffer, {
            contentType: "application/pdf",
            contentDisposition: "sample.pdf",
        })

        const fileId = uploadResult?.data?.id as string
        if (!fileId) {
            throw new Error("PDF file upload failed")
        }

        const documentId = await parseAndStoreDocument(
            adminDb,
            pdfBuffer,
            "sample.pdf",
            storagePath,
            fileId
        )

        expect(documentId).toBeTruthy()

        const documentQuery = await adminDb.query({
            documents: {
                $: {
                    where: { id: documentId }
                }
            }
        })

        expect(documentQuery.documents).toHaveLength(1)
        const document = documentQuery.documents[0]
        
        expect(document.content).toBeTruthy()
        expect(document.content.pages).toBeTruthy()
        expect(Array.isArray(document.content.pages)).toBe(true)
        expect(document.content.pages.length).toBeGreaterThan(0)
        
        const firstPage = document.content.pages[0]
        expect(firstPage.id).toBeTruthy()
        expect(firstPage.text).toBeTruthy()
        expect(typeof firstPage.text).toBe("string")
        expect(firstPage.text.length).toBeGreaterThan(0)
        
        expect(document.processedAt).toBeTruthy()
        
        console.log("Document parsed successfully with", document.content.pages.length, "pages")
        console.log("First 200 chars:", document.content.pages[0].text.substring(0, 200))
    }, 180000)
})

