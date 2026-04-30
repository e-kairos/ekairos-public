import { i } from "@instantdb/core"
import { domain } from "@ekairos/domain"

import { sandboxDomain as publicSandboxDomain } from "./public.js"

export const sandboxSchemaDomain = domain("sandbox")
  .includes(publicSandboxDomain)
  .withSchema({
    entities: {
      sandbox_sandboxes: i.entity({
        externalSandboxId: i.string().optional().indexed(),
        sandboxUserId: i.string().optional().indexed(),
        provider: i.string().indexed(),
        providerConfig: i.json().optional(),
        params: i.json().optional(),
      }),
      sandbox_processes: i.entity({
        kind: i.string().indexed(),
        mode: i.string().indexed(),
        status: i.string().indexed(),
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
          on: "$streams",
          has: "many",
          label: "sandboxProcesses",
        },
      },
    },
    rooms: {},
  })

export const sandboxDomain = sandboxSchemaDomain
