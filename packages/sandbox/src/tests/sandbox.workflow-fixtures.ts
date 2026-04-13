import { EkairosRuntime } from "@ekairos/domain/runtime"
import { init } from "@instantdb/admin"
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde"

import { sandboxDomain } from "../actions"

export type SandboxWorkflowEnv = {
  appId: string
  adminToken: string
  marker: string
}

export class SandboxWorkflowTestRuntime extends EkairosRuntime<
  SandboxWorkflowEnv,
  typeof sandboxDomain,
  ReturnType<typeof init>
> {
  static [WORKFLOW_SERIALIZE](instance: SandboxWorkflowTestRuntime) {
    return this.serializeRuntime(instance)
  }

  static [WORKFLOW_DESERIALIZE](data: { env: SandboxWorkflowEnv }) {
    return this.deserializeRuntime(data) as SandboxWorkflowTestRuntime
  }

  protected getDomain() {
    return sandboxDomain
  }

  protected resolveDb(env: SandboxWorkflowEnv) {
    return init({
      appId: env.appId,
      adminToken: env.adminToken,
      schema: sandboxDomain.toInstantSchema(),
      useDateObjects: true,
    } as any)
  }
}

export async function sandboxProcessWorkflow(
  runtime: SandboxWorkflowTestRuntime,
  params: { spriteName: string },
) {
  "use workflow"

  const sandbox = await runtime.use(sandboxDomain)
  let sandboxId: string | undefined
  try {
    const created = await sandbox.actions.createSandbox({
      provider: "sprites",
      runtime: "node22",
      purpose: "vitest-workflow-sandbox",
      sprites: {
        name: params.spriteName,
        waitForCapacity: true,
        urlSettings: { auth: "public" },
        deleteOnStop: true,
      },
    })
    if (!created.ok) throw new Error(created.error)
    sandboxId = created.data.sandboxId

    const run = await sandbox.actions.runCommandProcess({
      sandboxId,
      command: "sh",
      args: ["-lc", "echo workflow-sandbox-stdout; echo workflow-sandbox-stderr 1>&2"],
      kind: "command",
      mode: "foreground",
      metadata: { test: "sandbox.workflow.integration" },
    })
    if (!run.ok) throw new Error(run.error)

    const stream = await sandbox.actions.readProcessStream({ processId: run.data.processId })
    if (!stream.ok) throw new Error(stream.error)

    const stdoutText = stream.data.chunks
      .filter((chunk) => chunk.type === "stdout")
      .map((chunk) => String(chunk.data?.text ?? ""))
      .join("")
    const stderrText = stream.data.chunks
      .filter((chunk) => chunk.type === "stderr")
      .map((chunk) => String(chunk.data?.text ?? ""))
      .join("")

    return {
      sandboxId,
      processId: run.data.processId,
      streamId: run.data.streamId,
      streamClientId: run.data.streamClientId,
      result: run.data.result,
      chunkTypes: stream.data.chunks.map((chunk) => chunk.type),
      stdoutText,
      stderrText,
    }
  } finally {
    if (sandboxId) {
      const stopped = await sandbox.actions.stopSandbox({ sandboxId })
      if (!stopped.ok) throw new Error(stopped.error)
    }
  }
}
