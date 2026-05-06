import { existsSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { resolveFilePreviewScriptPath } from "../file/filepreview"

describe("file preview script resolution", () => {
  it("resolves packaged Python preview scripts without CommonJS require", () => {
    const scriptPath = resolveFilePreviewScriptPath("file_metadata.py")

    expect(scriptPath).toContain("file_metadata.py")
    expect(existsSync(scriptPath)).toBe(true)
  })
})
