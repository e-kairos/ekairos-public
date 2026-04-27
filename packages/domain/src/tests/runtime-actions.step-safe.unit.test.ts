/* @vitest-environment node */

import { describe, expect, it } from "vitest";

import { defineDomainAction, domain } from "../index.ts";
import { readActionExecutionContext } from "./workflow.metadata.ts";
import {
  DomainRuntime,
  type RuntimeActionEnv,
} from "./runtime-actions.test-fixtures.ts";

describe("runtime action step-safe execution outside workflows", () => {
  it("executes step-marked actions outside workflow context as normal functions", async () => {
    // given: a domain action marked with "use step" that inspects the workflow
    // execution context before touching the runtime-scoped domain.
    const baseStepSafeDomain = domain("step-safe").schema({
      entities: {},
      links: {},
      rooms: {},
    });

    let stepSafeDomain: any;
    stepSafeDomain = baseStepSafeDomain.withActions({
      inspectExecution: defineDomainAction<
        RuntimeActionEnv,
        { title: string },
        {
          title: string;
          runtimeCall: number;
          inWorkflow: boolean;
          inStep: boolean;
          workflowRunId: string | null;
          stepId: string | null;
        },
        DomainRuntime<any>,
        any
      >({
        name: "step.safe.inspect",
        async execute({ input, runtime }) {
          "use step";
          const execution = await readActionExecutionContext();
          const scoped = await runtime.use(stepSafeDomain);
          return {
            title: String(input.title).trim(),
            runtimeCall: scoped.db.runtimeCall,
            inWorkflow: execution.inWorkflow,
            inStep: execution.inStep,
            workflowRunId: execution.workflowRunId,
            stepId: execution.stepId,
          };
        },
      }),
    });

    const runtime = new DomainRuntime(
      { orgId: "org_123", actorId: "user_1" },
      stepSafeDomain,
      5,
    );
    const scoped = await runtime.use(stepSafeDomain);

    // when: the action runs as a regular function outside a workflow.
    const result = await scoped.actions.inspectExecution({ title: "  hello step  " });

    // then: the step marker does not require a workflow context and metadata is
    // reported as outside-workflow.
    expect(result).toEqual({
      title: "hello step",
      runtimeCall: 5,
      inWorkflow: false,
      inStep: false,
      workflowRunId: null,
      stepId: null,
    });
  });
});
