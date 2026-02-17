import { i } from "@instantdb/core"
import { domain, type DomainSchemaResult } from "@ekairos/domain"

// Port de `ekairos-core/src/lib/domain/sandbox/schema.ts`
export const sandboxDomain: DomainSchemaResult = domain("sandbox").schema({
  entities: {
    sandbox_sandboxes: i.entity({
      externalSandboxId: i.string().optional().indexed(),
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
  },
  links: {},
  rooms: {},
})

