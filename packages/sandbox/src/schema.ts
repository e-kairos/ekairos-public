import { i } from "@instantdb/core"
import { domain, type DomainSchemaResult } from "@ekairos/domain"

// Port de `ekairos-core/src/lib/domain/sandbox/schema.ts`
export const sandboxDomain: DomainSchemaResult = domain("sandbox").schema({
  entities: {
    sandbox_sandboxes: i.entity({
      externalSandboxId: i.string().optional().indexed(),
      sandboxUserId: i.string().optional().indexed(),
      provider: i.string().indexed(),
      sandboxUrl: i.string().optional(),
      status: i.string().indexed(),
      timeout: i.number().optional(),
      runtime: i.string().optional(),
      vcpus: i.number().optional(),
      ports: i.json().optional(),
      purpose: i.string().optional().indexed(),
      params: i.json().optional(),
      createdAt: i.number().indexed(),
      updatedAt: i.number().optional().indexed(),
      shutdownAt: i.number().optional().indexed(),
    }),
    sandbox_processes: i.entity({
      kind: i.string().indexed(), // command | service | codex-app-server | dev-server | test-runner | watcher
      mode: i.string().indexed(), // foreground | background
      status: i.string().indexed(), // starting | running | detached | exited | failed | killed | lost
      provider: i.string().indexed(),
      command: i.string(),
      args: i.json().optional(),
      cwd: i.string().optional(),
      env: i.json().optional(),
      exitCode: i.number().optional().indexed(),
      signal: i.string().optional(),
      externalProcessId: i.string().optional().indexed(),
      streamId: i.string().optional().indexed(),
      streamClientId: i.string().optional().indexed(),
      streamStartedAt: i.number().optional().indexed(),
      streamFinishedAt: i.number().optional().indexed(),
      streamAbortReason: i.string().optional(),
      startedAt: i.number().indexed(),
      updatedAt: i.number().optional().indexed(),
      exitedAt: i.number().optional().indexed(),
      metadata: i.json().optional(),
    }),
  },
  links: {
    sandbox_user: {
      forward: {
        on: "sandbox_sandboxes",
        has: "one",
        label: "user",
      },
      reverse: {
        on: "$users",
        has: "many",
        label: "sandboxes",
      },
    },
    sandboxProcessSandbox: {
      forward: {
        on: "sandbox_processes",
        has: "one",
        label: "sandbox",
      },
      reverse: {
        on: "sandbox_sandboxes",
        has: "many",
        label: "processes",
      },
    },
    sandboxProcessStream: {
      forward: {
        on: "sandbox_processes",
        has: "one",
        label: "stream",
      },
      reverse: {
        on: "$streams" as any,
        has: "many",
        label: "sandboxProcesses",
      },
    },
  },
  rooms: {},
})

