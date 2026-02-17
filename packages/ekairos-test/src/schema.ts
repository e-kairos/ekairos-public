import { i } from "@instantdb/core";
import { domain, type DomainSchemaResult } from "@ekairos/domain";

export const ekairosTestDomain: DomainSchemaResult = domain("ekairos.testing")
  .schema({
    entities: {
      test_runs: i.entity({
        runId: i.string().unique().indexed(),
        projectId: i.string().optional().indexed(),
        domainName: i.string().optional().indexed(),
        runner: i.string().indexed(),
        status: i.string().indexed(), // running | passed | failed | cancelled
        command: i.string().optional(),
        startedAt: i.date().indexed(),
        finishedAt: i.date().optional().indexed(),
        metadata: i.json().optional(),
      }),
      test_cases: i.entity({
        runId: i.string().indexed(),
        caseId: i.string().indexed(),
        title: i.string().optional(),
        file: i.string().optional().indexed(),
        status: i.string().indexed(), // running | passed | failed | skipped
        startedAt: i.date().optional().indexed(),
        finishedAt: i.date().optional().indexed(),
        durationMs: i.number().optional(),
        metadata: i.json().optional(),
      }),
      test_events: i.entity({
        runId: i.string().indexed(),
        caseId: i.string().optional().indexed(),
        kind: i.string().indexed(), // lifecycle | log | assertion | workflow | thread
        channel: i.string().optional().indexed(),
        createdAt: i.date().indexed(),
        message: i.string().optional(),
        payload: i.json().optional(),
      }),
      test_artifacts: i.entity({
        runId: i.string().indexed(),
        caseId: i.string().optional().indexed(),
        kind: i.string().indexed(), // screenshot | video | trace | html | json
        path: i.string().indexed(),
        mimeType: i.string().optional().indexed(),
        sizeBytes: i.number().optional(),
        createdAt: i.date().indexed(),
        payload: i.json().optional(),
      }),
      test_code_refs: i.entity({
        runId: i.string().indexed(),
        caseId: i.string().optional().indexed(),
        file: i.string().indexed(),
        line: i.number().optional(),
        column: i.number().optional(),
        symbol: i.string().optional().indexed(),
        createdAt: i.date().indexed(),
        payload: i.json().optional(),
      }),
    },
    links: {
      testRunCases: {
        forward: { on: "test_cases", has: "one", label: "run" },
        reverse: { on: "test_runs", has: "many", label: "cases" },
      },
      testRunEvents: {
        forward: { on: "test_events", has: "one", label: "run" },
        reverse: { on: "test_runs", has: "many", label: "events" },
      },
      testRunArtifacts: {
        forward: { on: "test_artifacts", has: "one", label: "run" },
        reverse: { on: "test_runs", has: "many", label: "artifacts" },
      },
      testRunCodeRefs: {
        forward: { on: "test_code_refs", has: "one", label: "run" },
        reverse: { on: "test_runs", has: "many", label: "codeRefs" },
      },
    },
    rooms: {},
  });

export type EkairosTestDomain = typeof ekairosTestDomain;

export function createAppTestingDomain(params: {
  appDomain: DomainSchemaResult;
  testDomain?: DomainSchemaResult;
  name?: string;
}): DomainSchemaResult {
  return domain(params.name ?? "app.testing")
    .includes(params.appDomain)
    .includes(params.testDomain ?? ekairosTestDomain)
    .schema({
      entities: {},
      links: {},
      rooms: {},
    });
}
