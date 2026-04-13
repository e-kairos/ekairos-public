import { describe, expectTypeOf, it } from "vitest"

import type { ContextReactorParams } from "../reactors/types"

describe("ContextReactorParams public contract", () => {
  it("exposes provider-neutral actionSpecs instead of toolsForModel", () => {
    type Params = ContextReactorParams<Record<string, never>>

    expectTypeOf<Params>().toHaveProperty("actions")
    expectTypeOf<Params>().toHaveProperty("actionSpecs")
    expectTypeOf<Params>().not.toHaveProperty("toolsForModel")
  })
})
