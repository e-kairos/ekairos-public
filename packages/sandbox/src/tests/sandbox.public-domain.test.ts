import { describe, expect, it } from "vitest"

import { sandboxDomain as publicSandboxDomain } from "../public"
import { sandboxDomain as fullSandboxDomain } from "../actions"

describe("sandbox public/full domain composition", () => {
  it("keeps the public domain as a client-safe subset and extends it on the full domain", () => {
    const publicSchema = publicSandboxDomain.instantSchema()
    const fullSchema = fullSandboxDomain.instantSchema()

    expect(Object.keys(publicSchema.entities)).toContain("sandbox_sandboxes")
    expect(Object.keys(publicSchema.entities)).not.toContain("sandbox_processes")
    expect(publicSandboxDomain.actions()).toEqual([])

    expect(Object.keys(fullSchema.entities)).toContain("sandbox_sandboxes")
    expect(Object.keys(fullSchema.entities)).toContain("sandbox_processes")
    expect(fullSandboxDomain.actions().map((action) => action.name)).toContain(
      "sandbox.runCommandProcess",
    )
  })
})
