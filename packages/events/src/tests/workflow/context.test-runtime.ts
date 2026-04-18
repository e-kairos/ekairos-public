import { init } from "@instantdb/admin"
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde"
import { EkairosRuntime } from "@ekairos/domain"

import { eventsDomain } from "../../schema.ts"

export type EventsTestRuntimeEnv<Extra extends Record<string, unknown> = {}> = Extra & {
  appId: string
  adminToken: string
}

export class EventsTestRuntime<
  Extra extends Record<string, unknown> = {},
> extends EkairosRuntime<
  EventsTestRuntimeEnv<Extra>,
  typeof eventsDomain,
  ReturnType<typeof init>
> {
  static [WORKFLOW_SERIALIZE](instance: EventsTestRuntime<any>) {
    return { env: instance.env }
  }

  static [WORKFLOW_DESERIALIZE](data: { env: EventsTestRuntimeEnv<any> }) {
    return new EventsTestRuntime(data.env)
  }

  protected getDomain() {
    return eventsDomain
  }

  protected async resolveDb(env: EventsTestRuntimeEnv<Extra>) {
    return init({
      appId: env.appId,
      adminToken: env.adminToken,
      schema: eventsDomain.toInstantSchema(),
      useDateObjects: true,
    } as any)
  }
}
