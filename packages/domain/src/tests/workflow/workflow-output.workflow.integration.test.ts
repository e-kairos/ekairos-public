/* @vitest-environment node */

import { describe, expect, it } from "vitest"
import { start } from "workflow/api"

import {
  workflowOutputRoundTrip,
  WorkflowOutputRuntime,
} from "./workflow-output.workflow-fixtures.js"

describe("workflow output domain actions", () => {
  it("round-trips workflow output contracts as serde instances across steps", async () => {
    // given: a workflow runtime whose domain action returns a serde-backed
    // output instance and a resource id that will flow through the workflow.
    const runtime = new WorkflowOutputRuntime({
      marker: `workflow-output-${Date.now()}`,
    })
    const resourceId = `resource-${Date.now()}`

    // when: the workflow creates the resource and inspects it after crossing a
    // workflow step boundary.
    const run = await start(workflowOutputRoundTrip, [
      runtime,
      { resourceId },
    ])
    const result = await run.returnValue

    // then: both direct and inspected values remain serde instances at runtime
    // while retaining the expected serialized identity.
    expect(result.directLabel).toBe(`${runtime.env.marker}:${resourceId}`)
    expect(result.directInstance).toBe(true)
    expect(result.inspected.label).toBe(`${runtime.env.marker}:${resourceId}`)
    expect(result.inspected.isWorkflowResource).toBe(true)
  })
})
