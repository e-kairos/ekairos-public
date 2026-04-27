/* @vitest-environment node */

import { expect, it } from "vitest";
import { start } from "workflow/api";

import {
  executeRuntimeActionWorkflow,
  RuntimeWorkflowTestRuntime,
} from "../runtime.workflow-fixtures.js";
import {
  describeRuntimeWorkflow,
  useRuntimeWorkflowTestApp,
} from "./runtime.workflow-test-app.js";

describeRuntimeWorkflow("workflow executeRuntimeAction domain actions", () => {
  const app = useRuntimeWorkflowTestApp();

  it(
    "runs executeRuntimeAction through step-safe domain actions inside a workflow",
    async () => {
      // given: a workflow runtime backed by a temporary Instant app and a probe
      // id that will be written by the domain action.
      const { appId, adminToken } = app.credentials();
      const runtime = new RuntimeWorkflowTestRuntime({
        appId,
        adminToken,
        marker: `runtime-marker-execute-${Date.now()}`,
      });
      const probeId = `probe-execute-${Date.now()}`;
      const label = "  runtime action workflow  ";

      // when: the workflow invokes executeRuntimeAction, which crosses the
      // workflow step boundary before executing the domain action.
      const run = await start(executeRuntimeActionWorkflow, [
        runtime,
        { probeId, label },
      ]);

      const result = await run.returnValue;

      // then: all nested action outputs keep the same runtime identity and
      // workflow metadata, and the row is persisted in InstantDB.
      expect(result.rootRuntimeKey).toBe(runtime.key());
      expect(result.rootMarker).toBe(runtime.env.marker);

      expect(result.created.isRuntimeInstance).toBe(true);
      expect(result.created.runtimeKey).toBe(runtime.key());
      expect(result.created.marker).toBe(runtime.env.marker);
      expect(result.created.probeId).toBe(probeId);
      expect(result.created.label).toBe("runtime action workflow");
      expect(result.created.execution.inWorkflow).toBe(true);
      expect(result.created.execution.inStep).toBe(true);
      expect(result.created.execution.workflowRunId).toBe(run.runId);
      expect(result.created.execution.stepId).toBeTruthy();
      expect(result.created.normalizedExecution.inWorkflow).toBe(true);
      expect(result.created.normalizedExecution.inStep).toBe(true);
      expect(result.created.normalizedExecution.workflowRunId).toBe(run.runId);
      expect(result.created.normalizedExecution.stepId).toBe(result.created.execution.stepId);

      expect(result.read.isRuntimeInstance).toBe(true);
      expect(result.read.runtimeKey).toBe(runtime.key());
      expect(result.read.marker).toBe(runtime.env.marker);
      expect(result.read.probeId).toBe(probeId);
      expect(result.read.label).toBe("runtime action workflow");
      expect(result.read.execution.inWorkflow).toBe(true);
      expect(result.read.execution.inStep).toBe(true);
      expect(result.read.execution.workflowRunId).toBe(run.runId);
      expect(result.read.execution.stepId).toBeTruthy();

      const db = await runtime.db();
      const snapshot = await db.query({
        runtime_probe_rows: {
          $: { where: { probeId }, limit: 1 },
        },
      });

      const row = snapshot.runtime_probe_rows?.[0];
      expect(row?.probeId).toBe(probeId);
      expect(row?.label).toBe("runtime action workflow");
    },
    5 * 60 * 1000,
  );
});
