/* @vitest-environment node */

import { expect, it } from "vitest";
import { start } from "workflow/api";

import {
  RuntimeWorkflowTestRuntime,
  scopedDomainActionsWorkflow,
} from "../runtime.workflow-fixtures.js";
import {
  describeRuntimeWorkflow,
  useRuntimeWorkflowTestApp,
} from "./runtime.workflow-test-app.js";

describeRuntimeWorkflow("workflow scoped domain actions", () => {
  const app = useRuntimeWorkflowTestApp();

  it(
    "runs runtime.use(domain).actions through step-safe actions and keeps nested composition in-process",
    async () => {
      // given: a workflow runtime and scoped domain actions that call each other
      // in process through runtime.use(domain).actions.
      const { appId, adminToken } = app.credentials();
      const runtime = new RuntimeWorkflowTestRuntime({
        appId,
        adminToken,
        marker: `runtime-marker-scoped-${Date.now()}`,
      });
      const probeId = `probe-scoped-${Date.now()}`;
      const label = "  scoped workflow action  ";

      // when: the workflow executes the scoped domain action composition.
      const run = await start(scopedDomainActionsWorkflow, [
        runtime,
        { probeId, label },
      ]);

      const result = await run.returnValue;

      // then: created and read actions keep the same runtime identity while each
      // workflow step records its own step id.
      expect(result.rootRuntimeKey).toBe(runtime.key());
      expect(result.rootMarker).toBe(runtime.env.marker);

      expect(result.created.isRuntimeInstance).toBe(true);
      expect(result.created.runtimeKey).toBe(runtime.key());
      expect(result.created.marker).toBe(runtime.env.marker);
      expect(result.created.probeId).toBe(probeId);
      expect(result.created.label).toBe("scoped workflow action");
      expect(result.created.execution.inWorkflow).toBe(true);
      expect(result.created.execution.inStep).toBe(true);
      expect(result.created.execution.workflowRunId).toBe(run.runId);
      expect(result.created.execution.stepId).toBeTruthy();
      expect(result.created.normalizedExecution.inWorkflow).toBe(true);
      expect(result.created.normalizedExecution.inStep).toBe(true);
      expect(result.created.normalizedExecution.workflowRunId).toBe(run.runId);
      expect(result.created.normalizedExecution.stepId).toBe(result.created.execution.stepId);

      expect(result.read.probeId).toBe(probeId);
      expect(result.read.label).toBe("scoped workflow action");
      expect(result.read.execution.inWorkflow).toBe(true);
      expect(result.read.execution.inStep).toBe(true);
      expect(result.read.execution.workflowRunId).toBe(run.runId);
      expect(result.read.execution.stepId).toBeTruthy();
      expect(result.read.execution.stepId).not.toBe(result.created.execution.stepId);
    },
    5 * 60 * 1000,
  );
});
