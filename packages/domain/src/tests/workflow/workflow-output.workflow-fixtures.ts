import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde"

import {
  defineDomainAction,
  domain,
  EkairosRuntime,
  workflow as workflowOutput,
  type DomainActionExecuteParams,
} from "../../index.js"

export type WorkflowOutputEnv = {
  marker: string
}

type WorkflowOutputDb = {
  readonly kind: "workflow-output-db"
}

type SerializedWorkflowResource = {
  version: 1
  resourceId: string
  marker: string
}

class WorkflowResource {
  constructor(
    readonly resourceId: string,
    readonly marker: string,
  ) {}

  label() {
    return `${this.marker}:${this.resourceId}`
  }

  static [WORKFLOW_SERIALIZE](
    instance: WorkflowResource,
  ): SerializedWorkflowResource {
    return {
      version: 1,
      resourceId: instance.resourceId,
      marker: instance.marker,
    }
  }

  static [WORKFLOW_DESERIALIZE](
    data: SerializedWorkflowResource,
  ): WorkflowResource {
    return new WorkflowResource(data.resourceId, data.marker)
  }
}

export async function createWorkflowResourceExecute({
  env,
  input,
}: DomainActionExecuteParams<
  WorkflowOutputEnv,
  { resourceId: string },
  WorkflowOutputRuntime
>) {
  "use step"
  return new WorkflowResource(input.resourceId, env.marker)
}

export const createWorkflowResourceAction = defineDomainAction({
  name: "workflowOutput.createResource",
  description: "Create a workflow-serializable resource.",
  inputSchema: {} as unknown,
  output: workflowOutput(WorkflowResource),
  execute: createWorkflowResourceExecute,
})

export const workflowOutputDomain = domain("workflow.output.integration")
  .schema({
    entities: {},
    links: {},
    rooms: {},
  })
  .withActions({
    createWorkflowResource: createWorkflowResourceAction,
  })

export class WorkflowOutputRuntime extends EkairosRuntime<
  WorkflowOutputEnv,
  typeof workflowOutputDomain,
  WorkflowOutputDb
> {
  static [WORKFLOW_SERIALIZE](instance: WorkflowOutputRuntime) {
    return this.serializeRuntime(instance)
  }

  static [WORKFLOW_DESERIALIZE](data: { env: WorkflowOutputEnv }) {
    return this.deserializeRuntime(data) as WorkflowOutputRuntime
  }

  protected getDomain() {
    return workflowOutputDomain
  }

  protected resolveDb(): WorkflowOutputDb {
    return { kind: "workflow-output-db" }
  }
}

export async function inspectWorkflowResource(resource: WorkflowResource) {
  "use step"
  return {
    label: resource.label(),
    isWorkflowResource: resource instanceof WorkflowResource,
  }
}

export async function workflowOutputRoundTrip(
  runtime: WorkflowOutputRuntime,
  input: { resourceId: string },
) {
  "use workflow"

  const scoped = await runtime.use(workflowOutputDomain)
  const resource = await scoped.actions.createWorkflowResource(input)
  const inspected = await inspectWorkflowResource(resource)

  return {
    directLabel: resource.label(),
    directInstance: resource instanceof WorkflowResource,
    inspected,
  }
}
