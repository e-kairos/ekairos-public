import { existsSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  getEmbeddedFilePreviewScriptBase64,
  resolveFilePreviewScriptPath,
} from "../file/filepreview"

describe("file preview script resolution", () => {
  it("resolves packaged Python preview scripts without CommonJS require", () => {
    const scriptPath = resolveFilePreviewScriptPath("file_metadata.py")

    expect(scriptPath).toContain("file_metadata.py")
    expect(existsSync(scriptPath)).toBe(true)
  })

  it("embeds Python preview scripts for traced serverless bundles", () => {
    const content = Buffer.from(
      getEmbeddedFilePreviewScriptBase64("file_metadata.py"),
      "base64",
    ).toString("utf8")

    expect(content).toContain("json")
    expect(content).toContain("row_count_estimate")
  })
})
