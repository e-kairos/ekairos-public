import { i } from "@instantdb/core";

const migrationSchema = i.schema({
  entities: {
    migration_runs: i.entity({
      orgId: i.string().indexed(),
      status: i.string().indexed(),
      startedAt: i.date().indexed(),
      endedAt: i.date().optional(),
      targetAppId: i.string().indexed(),
      targetAdminToken: i.string(),
      migrationAppId: i.string().indexed(),
      migrationAdminToken: i.string(),
      summary: i.json().optional(),
    }),
    migration_steps: i.entity({
      runId: i.string().indexed(),
      name: i.string().indexed(),
      status: i.string().indexed(),
      startedAt: i.date().indexed(),
      endedAt: i.date().optional(),
      detail: i.json().optional(),
    }),
    migration_artifacts: i.entity({
      runId: i.string().indexed(),
      stepName: i.string().indexed(),
      kind: i.string().indexed(),
      label: i.string().indexed(),
      contentType: i.string().optional(),
      sizeBytes: i.number().optional(),
      sha256: i.string().optional(),
      chunked: i.boolean().optional(),
      inlineContent: i.string().optional(),
      createdAt: i.date().indexed(),
    }),
    migration_payload_chunks: i.entity({
      artifactId: i.string().indexed(),
      runId: i.string().indexed(),
      chunkIndex: i.number().indexed(),
      content: i.string(),
      createdAt: i.date().indexed(),
    }),
    migration_reports: i.entity({
      runId: i.string().indexed(),
      status: i.string().indexed(),
      report: i.json(),
      createdAt: i.date().indexed(),
    }),
  },
  links: {
    migrationRunSteps: {
      forward: { on: "migration_runs", has: "many", label: "steps" },
      reverse: { on: "migration_steps", has: "one", label: "run" },
    },
    migrationRunArtifacts: {
      forward: { on: "migration_runs", has: "many", label: "artifacts" },
      reverse: { on: "migration_artifacts", has: "one", label: "run" },
    },
    migrationArtifactChunks: {
      forward: { on: "migration_artifacts", has: "many", label: "chunks" },
      reverse: { on: "migration_payload_chunks", has: "one", label: "artifact" },
    },
    migrationRunReports: {
      forward: { on: "migration_runs", has: "many", label: "reports" },
      reverse: { on: "migration_reports", has: "one", label: "run" },
    },
  },
});

export default migrationSchema;
