import { EkairosRuntime } from "../runtime-handle.js"
import { id, init } from "@instantdb/admin"
import { i } from "@instantdb/core"
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde"

import { defineDomainAction, domain } from "../index.js"
import { executeRuntimeAction } from "../runtime.js"
import { readActionExecutionContext } from "./workflow.metadata.js"

export type RuntimeWorkflowEnv = {
  appId: string
  adminToken: string
  marker: string
}

export async function normalizeProbeLabelExecute(
  { input }: {
    env: RuntimeWorkflowEnv
    input: { label: string }
    runtime: RuntimeWorkflowTestRuntime
    domain?: any
    call: (...args: any[]) => Promise<any>
  },
) {
  "use step"

  const execution = await readActionExecutionContext()
  return {
    label: String(input.label ?? "").trim(),
    execution,
  }
}

export const normalizeProbeLabelAction = defineDomainAction<
  RuntimeWorkflowEnv,
  { label: string },
  {
    label: string
    execution: Awaited<ReturnType<typeof readActionExecutionContext>>
  },
  RuntimeWorkflowTestRuntime,
  any
>({
  name: "runtime.probe.normalizeLabel",
  execute: normalizeProbeLabelExecute,
})

export async function createProbeExecute(
  { env, input, runtime }: {
    env: RuntimeWorkflowEnv
    input: { probeId: string; label: string }
    runtime: RuntimeWorkflowTestRuntime
    domain?: any
    call: (...args: any[]) => Promise<any>
  },
) {
  "use step"

  const execution = await readActionExecutionContext()
  const domain = await runtime.use(runtimeWorkflowDomain)
  const normalized = await domain.actions.normalizeProbeLabel({
    label: input.label,
  })
  const rowId = id()

  await domain.db.transact([
    domain.db.tx.runtime_probe_rows[rowId].update({
      probeId: input.probeId,
      label: normalized.label,
      createdAt: new Date(),
    }),
  ])

  return {
    rowId,
    probeId: input.probeId,
    label: normalized.label,
    marker: env.marker,
    runtimeKey: runtime.key(),
    isRuntimeInstance: runtime instanceof RuntimeWorkflowTestRuntime,
    execution,
    normalizedExecution: normalized.execution,
  }
}

export const createProbeAction = defineDomainAction<
  RuntimeWorkflowEnv,
  { probeId: string; label: string },
  {
    rowId: string
    probeId: string
    label: string
    marker: string
    runtimeKey: string
    isRuntimeInstance: boolean
    execution: Awaited<ReturnType<typeof readActionExecutionContext>>
    normalizedExecution: Awaited<ReturnType<typeof readActionExecutionContext>>
  },
  RuntimeWorkflowTestRuntime,
  any
>({
  name: "runtime.probe.create",
  execute: createProbeExecute,
})

export async function readProbeExecute(
  { env, input, runtime }: {
    env: RuntimeWorkflowEnv
    input: { probeId: string }
    runtime: RuntimeWorkflowTestRuntime
    domain?: any
    call: (...args: any[]) => Promise<any>
  },
) {
  "use step"

  const execution = await readActionExecutionContext()
  const domain = await runtime.use(runtimeWorkflowDomain)
  const query = await domain.db.query({
    runtime_probe_rows: {
      $: { where: { probeId: input.probeId }, limit: 1 },
    },
  })

  const row = query.runtime_probe_rows?.[0]
  return {
    probeId: row?.probeId ?? null,
    label: row?.label ?? null,
    marker: env.marker,
    runtimeKey: runtime.key(),
    isRuntimeInstance: runtime instanceof RuntimeWorkflowTestRuntime,
    execution,
  }
}

export const readProbeAction = defineDomainAction<
  RuntimeWorkflowEnv,
  { probeId: string },
  {
    probeId: string | null
    label: string | null
    marker: string
    runtimeKey: string
    isRuntimeInstance: boolean
    execution: Awaited<ReturnType<typeof readActionExecutionContext>>
  },
  RuntimeWorkflowTestRuntime,
  any
>({
  name: "runtime.probe.read",
  execute: readProbeExecute,
})

export const runtimeWorkflowDomain = domain("runtime.workflow.integration")
  .schema({
    entities: {
      runtime_probe_rows: i.entity({
        probeId: i.string().indexed(),
        label: i.string(),
        createdAt: i.date().indexed(),
      }),
    },
    links: {},
    rooms: {},
  })
  .withActions({
    normalizeProbeLabel: normalizeProbeLabelAction,
    createProbe: createProbeAction,
    readProbe: readProbeAction,
  })

export class RuntimeWorkflowTestRuntime extends EkairosRuntime<
  RuntimeWorkflowEnv,
  typeof runtimeWorkflowDomain,
  ReturnType<typeof init>
> {
  static [WORKFLOW_SERIALIZE](instance: RuntimeWorkflowTestRuntime) {
    return this.serializeRuntime(instance)
  }

  static [WORKFLOW_DESERIALIZE](data: { env: RuntimeWorkflowEnv }) {
    return this.deserializeRuntime(data) as RuntimeWorkflowTestRuntime
  }

  protected getDomain() {
    return runtimeWorkflowDomain
  }

  protected async resolveDb(env: RuntimeWorkflowEnv) {
    return init({
      appId: env.appId,
      adminToken: env.adminToken,
      schema: runtimeWorkflowDomain.toInstantSchema(),
      useDateObjects: true,
    } as any)
  }

  public key() {
    return `${this.env.appId}:${this.env.marker}`
  }
}

export async function executeRuntimeActionWorkflow(
  runtime: RuntimeWorkflowTestRuntime,
  params: { probeId: string; label: string },
) {
  "use workflow"

  const created = await executeRuntimeAction({
    runtime,
    action: createProbeAction,
    input: params,
  })

  const read = await executeRuntimeAction({
    runtime,
    action: readProbeAction,
    input: { probeId: params.probeId },
  })

  return {
    rootRuntimeKey: runtime.key(),
    rootMarker: runtime.env.marker,
    created,
    read,
  }
}

export async function scopedDomainActionsWorkflow(
  runtime: RuntimeWorkflowTestRuntime,
  params: { probeId: string; label: string },
) {
  "use workflow"

  const scoped = await runtime.use(runtimeWorkflowDomain)
  const created = await scoped.actions.createProbe(params)
  const read = await scoped.actions.readProbe({ probeId: params.probeId })

  return {
    rootRuntimeKey: runtime.key(),
    rootMarker: runtime.env.marker,
    created,
    read,
  }
}
