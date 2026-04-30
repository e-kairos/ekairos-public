import { i } from "@instantdb/core"
import { domain } from "@ekairos/domain"

// Browser-safe public sandbox schema. The full runtime domain imports and extends this.
export const sandboxSchemaDomain = domain("sandbox").withSchema({
  entities: {
    sandbox_sandboxes: i.entity({
      sandboxUrl: i.string().optional(),
      status: i.string().indexed(),
      timeout: i.number().optional(),
      runtime: i.string().optional(),
      vcpus: i.number().optional(),
      ports: i.json().optional(),
      purpose: i.string().optional().indexed(),
      createdAt: i.number().indexed(),
      updatedAt: i.number().optional().indexed(),
      shutdownAt: i.number().optional().indexed(),
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
  },
  rooms: {},
})

export const sandboxDomain = sandboxSchemaDomain
