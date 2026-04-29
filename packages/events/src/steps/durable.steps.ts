import type {
  ContextDurableWorkflowPayload,
  ContextReactFinalResult,
} from "../context.engine.js"
import { getContextDurableWorkflow } from "../context.durable.js"

export type ContextDurableWorkflowStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"

export type ContextReturnValueHookPayload<Context = any> =
  | {
      ok: true
      result: ContextReactFinalResult<Context>
    }
  | {
      ok: false
      error: {
        name?: string
        message: string
        stack?: string
      }
    }

export async function startContextDurableWorkflow(params: {
  payload: ContextDurableWorkflowPayload<any, any, any>
}): Promise<{ runId: string }> {
  "use step"

  const workflow = getContextDurableWorkflow()
  if (typeof workflow !== "function") {
    const contextKey = String(params.payload.contextKey || "(missing)")
    throw new Error(
      [
        "ContextEngine.react(..., { durable: true }) needs a registered durable context workflow.",
        "Call configureContextDurableWorkflow(contextDurableWorkflow) during server/workflow bootstrap.",
        "If you want inline execution inside the current workflow step, pass durable: false.",
        `Context key: ${contextKey}.`,
      ].join(" "),
    )
  }

  const { start } = await import("workflow/api")
  const run = await start(workflow as any, [params.payload])

  return { runId: String(run.runId) }
}

export async function readContextDurableWorkflowStatus(params: {
  runId: string
}): Promise<ContextDurableWorkflowStatus> {
  "use step"

  const { getRun } = await import("workflow/api")
  const run = getRun(params.runId)
  return (await run.status) as ContextDurableWorkflowStatus
}

export async function readContextDurableWorkflowReturnValue(params: {
  runId: string
}): Promise<ContextReactFinalResult<any>> {
  "use step"

  const { getRun } = await import("workflow/api")
  const run = getRun(params.runId)
  return (await run.returnValue) as ContextReactFinalResult<any>
}

export async function resumeContextReturnValueHook(params: {
  token: string
  payload: ContextReturnValueHookPayload
}): Promise<void> {
  "use step"

  const { resumeHook } = await import("workflow/api")
  await resumeHook(params.token, params.payload)
}
