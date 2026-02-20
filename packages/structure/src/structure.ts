import { createThread, didToolExecute, INPUT_TEXT_ITEM_TYPE, WEB_CHANNEL } from "@ekairos/thread"
import {
  getDatasetOutputPath,
  getDatasetOutputSchemaPath,
  getDatasetWorkstation,
  getDaytonaVolumeMountPath,
  getDaytonaVolumeName,
} from "./datasetFiles.js"
import {
  structureDownloadRowsOutputToSandboxStep,
  structureReadRowsOutputPageFromSandboxStep,
  type StructureRowsOutputPagingCursor,
  type StructureRowsOutputSandboxRef,
} from "./rowsOutputPaging.js"
import { structureSplitRowsOutputToDatasetStep } from "./rowsOutputSplit.js"
import {
  createDatasetSandboxStep,
  readDatasetSandboxFileStep,
  readDatasetSandboxTextFileStep,
  runDatasetSandboxCommandStep,
  writeDatasetSandboxFilesStep,
  writeDatasetSandboxTextFileStep,
} from "./sandbox/steps.js"
import { readInstantFileStep } from "./file/steps.js"
import {
  structureGetContextStep,
  structureGetContextWithRowsOutputFileStep,
  structurePatchContextContentStep,
  structureReadRowsOutputJsonlStep,
} from "./dataset/steps.js"
import { getWorkflowMetadata } from "workflow"
import { buildStructurePrompt, PreparedSource } from "./prompts.js"
import { createExecuteCommandTool } from "./executeCommand.tool.js"
import { createGenerateSchemaTool } from "./generateSchema.tool.js"
import { createClearDatasetTool } from "./clearDataset.tool.js"
import { createCompleteRowsTool } from "./completeRows.tool.js"
import { createCompleteObjectTool } from "./completeObject.tool.js"
import { persistObjectResultFromStoryStep } from "./steps/persistObjectFromStory.step.js"
import { structureCommitFromEventsStep } from "./steps/commitFromEvents.step.js"
import type { SandboxConfig } from "@ekairos/sandbox"

export type StructureSource =
  | { kind: "file"; fileId: string }
  | { kind: "dataset"; datasetId: string }
  | { kind: "text"; text: string; mimeType?: string; name?: string }

export type StructureMode = "auto" | "schema"
export type StructureOutput = "rows" | "object"

export type StructureRowsReadResult = {
  rows: any[]
  cursor: StructureRowsOutputPagingCursor
  done: boolean
}

export type StructureRowsSplitResult = {
  /**
   * Child datasetId containing a JSONL `output.jsonl` with up to `limit` ROW entries.
   * Omitted when there are no more rows to split.
   */
  datasetId?: string
  rowsWritten: number
  cursor: StructureRowsOutputPagingCursor
  done: boolean
}

export type StructureRowsReader = {
  /**
   * Workflow-friendly rows reader.
   *
   * It lazily:
   * - ensures a sandbox
   * - downloads `/structure/<datasetId>/output.jsonl` into the sandbox (absolute dataset path)
   * - reads the file in pages using an explicit cursor
   */
  read(): Promise<StructureRowsReadResult>
  read(cursor?: Partial<StructureRowsOutputPagingCursor>, limit?: number): Promise<StructureRowsReadResult>
  read(params?: { cursor?: Partial<StructureRowsOutputPagingCursor>; limit?: number }): Promise<StructureRowsReadResult>

  /**
   * Split the rows output into a child dataset (jsonl) and return paging state.
   *
   * Unlike `read()`, this does not return `rows[]` (avoids moving payloads through params/results).
   */
  split(): Promise<StructureRowsSplitResult>
  split(cursor?: Partial<StructureRowsOutputPagingCursor>, limit?: number): Promise<StructureRowsSplitResult>
  split(params?: {
    cursor?: Partial<StructureRowsOutputPagingCursor>
    limit?: number
    datasetId?: string
  }): Promise<StructureRowsSplitResult>
}

export type StructureBuildResult = {
  datasetId: string
  reader: StructureRowsReader
  /**
   * Back-compat: in object output mode we still return the full context snapshot.
   * Rows mode intentionally does not return the context, to keep the API light.
   */
  dataset?: any
}

function createUuidV4(): string {
  // Pure JS uuidv4 (workflow-safe: avoids Node built-ins and @instantdb/admin)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === "x" ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

type SandboxState = {
  initialized: boolean
  sources: PreparedSource[]
}

type StructureStoryStored = {
  sandboxId?: string
  sandboxState?: SandboxState
}

type StructureStoryConfig = {
  datasetId: string
  sources: StructureSource[]
  instructions?: string
  mode: StructureMode
  output: StructureOutput
  outputSchema?: any
  sandboxId?: string
  model?: string
  sandboxConfig?: SandboxConfig
}

function assertRunningInsideWorkflow(params: { datasetId: string }) {
  const bypassRaw = String(process.env.STRUCTURE_ALLOW_NON_WORKFLOW ?? "")
    .trim()
    .toLowerCase()
  if (bypassRaw === "1" || bypassRaw === "true" || bypassRaw === "yes") {
    return { workflowRunId: `test-${Date.now()}` }
  }
  try {
    const meta = getWorkflowMetadata() as any
    const runId = meta?.workflowRunId
    if (!runId) {
      throw new Error("Missing workflowRunId")
    }
    return meta
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(
      `@ekairos/structure: structure().build() must be called from a "use workflow" function. ` +
        `datasetId=${params.datasetId}. getWorkflowMetadata failed: ${msg}`,
    )
  }
}

function guessTextFileExtension(mimeType?: string, name?: string): string {
  const n = String(name ?? "").toLowerCase()
  if (n.includes(".")) return n.substring(n.lastIndexOf("."))
  const mt = String(mimeType ?? "").toLowerCase()
  if (mt.includes("csv")) return ".csv"
  if (mt.includes("json")) return ".json"
  if (mt.includes("yaml") || mt.includes("yml")) return ".yaml"
  return ".txt"
}

function shouldSkipPipInstall(config?: SandboxConfig): boolean {
  const explicit = String(process.env.STRUCTURE_DAYTONA_SKIP_PIP_INSTALL ?? "").trim().toLowerCase()
  if (explicit === "1" || explicit === "true" || explicit === "yes") return true
  const declarative = String(process.env.STRUCTURE_DAYTONA_DECLARATIVE_IMAGE ?? "").trim().toLowerCase()
  if (declarative === "1" || declarative === "true" || declarative === "yes") return true
  const snapshot = String(process.env.STRUCTURE_DAYTONA_SNAPSHOT ?? "").trim()
  if (snapshot) return true

  const image = config?.daytona?.image
  if (typeof image === "string" && image.trim().toLowerCase().startsWith("declarative")) return true
  if (image && typeof image === "object") return true
  if (config?.daytona?.snapshot) return true
  return false
}

function getDefaultSandboxConfig(datasetId: string): SandboxConfig {
  const volumeName = getDaytonaVolumeName()
  const mountPath = getDaytonaVolumeMountPath()
  const volumes =
    volumeName && mountPath
      ? [
          {
            volumeName,
            mountPath,
          },
        ]
      : []

  return {
    provider: "daytona",
    runtime: "python3.13",
    timeoutMs: 10 * 60 * 1000,
    purpose: "structure.dataset",
    params: { datasetId },
    daytona: {
      image: "declarative",
      ephemeral: true,
      autoStopIntervalMin: 5,
      volumes,
    },
  }
}

function mergeSandboxConfig(base: SandboxConfig, override?: SandboxConfig): SandboxConfig {
  if (!override) return base
  const mergedParams = {
    ...(base.params ?? {}),
    ...(override.params ?? {}),
  }
  const mergedDaytona: SandboxConfig["daytona"] = {
    ...(base.daytona ?? {}),
    ...(override.daytona ?? {}),
  }
  if (override.daytona?.snapshot && !override.daytona?.image) {
    mergedDaytona.image = undefined
  }
  if (override.daytona && "volumes" in override.daytona) {
    mergedDaytona.volumes = override.daytona?.volumes
  }
  return {
    ...base,
    ...override,
    params: mergedParams,
    daytona: mergedDaytona,
  }
}

async function sandboxFileExists(env: any, sandboxId: string, path: string): Promise<boolean> {
  const res = await runDatasetSandboxCommandStep({
    env,
    sandboxId,
    cmd: "test",
    args: ["-f", path],
  })
  return res.exitCode === 0
}

async function sandboxFindFirstMatch(env: any, sandboxId: string, pattern: string): Promise<string | null> {
  const py = [
    "import sys, glob",
    "pattern = sys.argv[1]",
    "matches = glob.glob(pattern)",
    "print(matches[0] if matches else '')",
  ].join("\n")
  const res = await runDatasetSandboxCommandStep({
    env,
    sandboxId,
    cmd: "python",
    args: ["-c", py, pattern],
  })
  if (res.exitCode !== 0) return null
  const out = String(res.stdout ?? "").trim()
  return out ? out : null
}

async function ensureSandboxPrepared(params: {
  env: any
  datasetId: string
  sandboxId: string
  sources: StructureSource[]
  state: SandboxState
  sandboxConfig?: SandboxConfig
}): Promise<{ preparedSources: PreparedSource[]; workstation: string; outputPath: string }> {
  const { env, datasetId, sandboxId, sources, state } = params

  const workstation = getDatasetWorkstation(datasetId)
  const outputPath = getDatasetOutputPath(datasetId)

  if (state.initialized) {
    return { preparedSources: state.sources, workstation, outputPath }
  }

  const mkdirRes = await runDatasetSandboxCommandStep({ env, sandboxId, cmd: "mkdir", args: ["-p", workstation] })

  // Align with dataset sandbox behavior: install python deps up-front (once per dataset sandbox).
  // This avoids tool-level "install if used" heuristics and ensures scripts can import pandas.
  if (!shouldSkipPipInstall(params.sandboxConfig)) {
    const pipInstall = await runDatasetSandboxCommandStep({
      env,
      sandboxId,
      cmd: "python",
      // NOTE: pandas needs openpyxl to read .xlsx files.
      args: ["-m", "pip", "install", "pandas", "openpyxl", "--quiet", "--upgrade"],
    })
    const installStderr = pipInstall.stderr ?? ""
    if (installStderr && (installStderr.includes("ERROR") || installStderr.includes("FAILED"))) {
      throw new Error(`pip install failed: ${installStderr.substring(0, 300)}`)
    }
  }

  const prepared: PreparedSource[] = []

  for (let i = 0; i < sources.length; i++) {
    const src = sources[i] as any

    if (src.kind === "file") {
      const basePath = `${workstation}/file_${i}_${src.fileId}`
      const existingPath = await sandboxFindFirstMatch(env, sandboxId, `${basePath}*`)
      if (existingPath) {
        prepared.push({ kind: "file", id: src.fileId, path: existingPath })
        continue
      }

      const file = await readInstantFileStep({ env, fileId: src.fileId })
      const fileName = String(file.contentDisposition ?? "")
      const ext = fileName.includes(".") ? fileName.substring(fileName.lastIndexOf(".")) : ""
      const path = `${basePath}${ext}`

      await writeDatasetSandboxFilesStep({
        env,
        sandboxId,
        files: [{ path, contentBase64: file.contentBase64 }],
      })

      prepared.push({ kind: "file", id: src.fileId, path })
      continue
    }

    if (src.kind === "dataset") {
      const path = `${workstation}/dataset_${src.datasetId}.jsonl`

      const exists = await sandboxFileExists(env, sandboxId, path)
      if (!exists) {
        const content = await structureReadRowsOutputJsonlStep({ env, structureId: src.datasetId })
        if (!content.ok) {
          throw new Error(content.error)
        }

        await writeDatasetSandboxFilesStep({
          env,
          sandboxId,
          files: [{ path, contentBase64: content.data.contentBase64 }],
        })
      }

      prepared.push({ kind: "dataset", id: src.datasetId, path })
      continue
    }

    if (src.kind === "text") {
      const ext = guessTextFileExtension(src.mimeType, src.name)
      const textId = `text_${i}`
      const path = `${workstation}/${textId}${ext}`
      const exists = await sandboxFileExists(env, sandboxId, path)
      if (!exists) {
        await writeDatasetSandboxTextFileStep({ env, sandboxId, path, text: String(src.text ?? "") })
      }

      prepared.push({ kind: "text", id: textId, path, name: src.name, mimeType: src.mimeType })
      continue
    }
  }

  state.initialized = true
  state.sources = prepared

  return { preparedSources: prepared, workstation, outputPath }
}

async function readSchemaFromSandboxIfPresent(params: {
  env: any
  sandboxId: string
  datasetId: string
}): Promise<any | null> {
  const schemaPath = getDatasetOutputSchemaPath(params.datasetId)
  const exists = await runDatasetSandboxCommandStep({
    env: params.env,
    sandboxId: params.sandboxId,
    cmd: "test",
    args: ["-f", schemaPath],
  })
  if (exists.exitCode !== 0) return null

  const fileRead = await readDatasetSandboxFileStep({
    env: params.env,
    sandboxId: params.sandboxId,
    path: schemaPath,
  })
  // Decode inside step runtime (Node) to avoid `Buffer` usage in workflow runtime.
  const decoded = await readDatasetSandboxTextFileStep({
    env: params.env,
    sandboxId: params.sandboxId,
    path: schemaPath,
  })
  const jsonText = String(decoded.text ?? "").trim()
  if (!jsonText) return null
  try {
    const parsed = JSON.parse(jsonText)
    return parsed
  } catch {
    return null
  }
}

function createStructureStoryDefinition<Env extends { orgId: string }>(config: StructureStoryConfig): { datasetId: string; story: any } {
  const datasetId = config.datasetId
  const model = config.model ?? "openai/gpt-5.2"
  const defaultSandboxConfig = getDefaultSandboxConfig(datasetId)
  const resolvedSandboxConfig = mergeSandboxConfig(defaultSandboxConfig, config.sandboxConfig)

  const story = createThread<Env>("ekairos.structure")
    .context(async (stored: any, env: Env) => {
      const prev = (stored?.content as StructureStoryStored) ?? {}
      const sandboxState: SandboxState = prev.sandboxState ?? { initialized: false, sources: [] }
      const existingSandboxId = prev.sandboxId ?? config.sandboxId ?? ""

      let sandboxId = existingSandboxId
      if (!sandboxId) {
        const created = await createDatasetSandboxStep({
          env,
          ...resolvedSandboxConfig,
        })
        sandboxId = created.sandboxId
      }

      const { preparedSources, workstation, outputPath } = await ensureSandboxPrepared({
        env,
        datasetId,
        sandboxId,
        sources: config.sources,
        state: sandboxState,
        sandboxConfig: resolvedSandboxConfig,
      })

      if (config.mode === "schema" && config.outputSchema) {
      }

      const promptContext = {
        datasetId,
        mode: config.mode,
        output: config.output,
        outputSchema: config.outputSchema,
        sources: preparedSources,
        workstation,
        outputPath,
        sandboxProvider: resolvedSandboxConfig.provider ?? "daytona",
        sandboxRuntime: resolvedSandboxConfig.runtime ?? "python3.13",
        sandboxEphemeral: resolvedSandboxConfig.daytona?.ephemeral ?? true,
        sandboxVolumeName: resolvedSandboxConfig.daytona?.volumes?.[0]?.volumeName,
        sandboxVolumeMountPath: resolvedSandboxConfig.daytona?.volumes?.[0]?.mountPath,
        sandboxSnapshot: resolvedSandboxConfig.daytona?.snapshot,
        sandboxImage: resolvedSandboxConfig.daytona?.image,
      }

      const contextKey = `structure:${datasetId}`
      // IMPORTANT:
      // The Story engine keeps an in-memory context snapshot from *before* tool execution.
      // Tools may have updated `context.content` via steps in the same story turn.
      // To avoid clobbering those updates, re-read the latest persisted content here.
      const latest = await structureGetContextStep({ env, contextKey })
      const prevContent = latest.ok ? ((latest.data?.content ?? {}) as any) : ((stored?.content ?? {}) as any)
      const prevStructure = (prevContent?.structure ?? {}) as any

      const nextStructure: any = {
        ...prevStructure,
        kind: "ekairos.structure",
        version: 1,
        structureId: datasetId,
        orgId: (env as any)?.orgId,
        updatedAt: Date.now(),
        mode: config.mode,
        output: config.output,
        instructions: config.instructions,
        sources: config.sources,
      }

      if (config.mode === "schema" && config.outputSchema && !nextStructure.outputSchema) {
        nextStructure.outputSchema = config.outputSchema
      }

      // Auto mode: lift schema produced by tools from the sandbox, if present.
      if (config.mode === "auto" && !nextStructure.outputSchema) {
        const lifted = await readSchemaFromSandboxIfPresent({ env, sandboxId, datasetId })
        if (lifted) {
          nextStructure.outputSchema = lifted
          nextStructure.state = "schema_complete"
        }
      }

      // Ensure the prompt always reflects the currently known schema (schema mode or lifted auto schema).
      if (nextStructure.outputSchema) {
        ;(promptContext as any).outputSchema = nextStructure.outputSchema
      }

      return {
        ...prevContent,
        ...prev,
        sandboxId,
        sandboxState,
        promptContext,
        structure: nextStructure,
      }
    })
    .narrative(async (stored: any) => {
      const promptContext = (stored?.content as any)?.promptContext
      const base = buildStructurePrompt(promptContext)
      const userInstructions = String(config.instructions ?? "").trim()
      if (!userInstructions) {
        return base
      }
      return [
        "## USER INSTRUCTIONS",
        "The following instructions were provided by the user. Apply them in addition to (and with higher priority than) the default instructions.",
        "",
        userInstructions,
        "",
        base,
      ].join("\n")
    })
    .actions(async (stored: any, env: Env) => {
      const sandboxId = (stored?.content as any)?.sandboxId as string
      const output = config.output
      const content = (stored?.content ?? {}) as any
      const hasOutputSchema = Boolean(content?.structure?.outputSchema?.schema)

      const actions: any = {
        executeCommand: createExecuteCommandTool({ datasetId, sandboxId, env }),
        clear: createClearDatasetTool({ datasetId, sandboxId, env }),
      }

      // In auto() mode we force a two-phase flow:
      // 1) Model MUST call generateSchema (to persist schema into context)
      // 2) Only then do we expose complete
      if (config.mode === "auto" && !hasOutputSchema) {
        actions.generateSchema = createGenerateSchemaTool({ datasetId, sandboxId, env })
      } else {
        actions.complete =
          output === "rows"
            ? createCompleteRowsTool({ datasetId, sandboxId, env })
            : createCompleteObjectTool({ datasetId, sandboxId, env })
      }

      return actions
    })
    .shouldContinue(({ reactionEvent }: { reactionEvent: any }) => {
      return !didToolExecute(reactionEvent as any, "complete")
    })
    .model(model)

  return { datasetId, story }
}

export function structure<Env extends { orgId: string }>(
  env: Env,
  opts?: { datasetId?: string; sandboxConfig?: SandboxConfig },
) {
  const datasetId = opts?.datasetId ?? createUuidV4()
  const sources: StructureSource[] = []
  let instructions: string | undefined
  let mode: StructureMode = "auto"
  let output: StructureOutput = "rows"
  let outputSchema: any | undefined
  const sandboxConfig = opts?.sandboxConfig

  const api = {
    datasetId,

    from(...src: StructureSource[]) {
      sources.push(...src)
      return api
    },

    instructions(text?: string) {
      instructions = text
      return api
    },

    auto() {
      mode = "auto"
      outputSchema = undefined
      return api
    },

    schema(schema: any) {
      mode = "schema"
      outputSchema = schema
      return api
    },

    asRows() {
      output = "rows"
      return api
    },

    asObject() {
      output = "object"
      return api
    },

    async build(userPrompt?: string): Promise<StructureBuildResult> {
      // Guardrail: structure build MUST run inside workflow runtime ("use workflow").
      const workflowMeta = assertRunningInsideWorkflow({ datasetId })
      void workflowMeta?.workflowRunId

      const contextKey = `structure:${datasetId}`
      const storyConfig: StructureStoryConfig = {
        datasetId,
        sources: [...sources],
        instructions,
        mode,
        output,
        outputSchema,
        sandboxConfig,
      }

      const { story } = createStructureStoryDefinition<Env>(storyConfig)

      function makeUserMessageEvent(text: string) {
        return {
          id: createUuidV4(),
          type: INPUT_TEXT_ITEM_TYPE,
          channel: WEB_CHANNEL,
          createdAt: new Date().toISOString(),
          content: { parts: [{ type: "text", text }] },
        } as any
      }

      async function runStory(evt: any) {
        await story.react(evt, {
          env,
          context: { key: contextKey },
          options: { silent: true, preventClose: true, sendFinish: false, maxIterations: 40, maxModelSteps: 10 },
        })

        // Tools are intentionally pure: persist completion outputs post-react by reading tool results from events.
        const commit = await structureCommitFromEventsStep({ env, structureId: datasetId })
        if (!commit.ok) {
        }
      }

      async function getContextOrThrow() {
        const ctxResult = await structureGetContextStep({ env, contextKey })
        if (!ctxResult.ok) throw new Error(ctxResult.error)
        return ctxResult.data
      }

      async function isRowsCompleted() {
        const res = await structureGetContextWithRowsOutputFileStep({ env, contextKey })
        if (!res.ok) return false
        const f = res.data?.structure_output_file
        const linked = Array.isArray(f) ? f[0] : f
        return Boolean(linked?.url)
      }

      function isObjectCompleted(ctx: any) {
        const content = (ctx?.content ?? {}) as any
        return (
          content?.structure?.outputs?.object?.value !== undefined &&
          content?.structure?.outputs?.object?.value !== null
        )
      }

      await runStory(makeUserMessageEvent(userPrompt ?? "produce structured output"))
      let ctx = await getContextOrThrow()

      // Auto-mode: if schema is missing after the first pass, explicitly request investigation + generateSchema.
      if (mode === "auto") {
        const content = (ctx?.content ?? {}) as any
        const hasSchema = Boolean(content?.structure?.outputSchema?.schema)
        if (!hasSchema) {
          await runStory(
            makeUserMessageEvent(
              [
                "CRITICAL: You did not generate a schema yet.",
                "1) Investigate Sources using executeCommand (inspect paths, read files, infer structure).",
                "2) Call generateSchema.",
                "3) After schema is saved, produce the final output and call complete.",
              ].join("\n"),
            ),
          )
          ctx = await getContextOrThrow()
        }
      }

      const needsSecondPass = output === "rows" ? !(await isRowsCompleted()) : !isObjectCompleted(ctx)

      if (needsSecondPass) {
        const followUpText =
          output === "rows"
            ? "Finalize now: write output.jsonl to OutputPath and call complete."
            : "Finalize now: call complete with summary and resultJson (inline JSON)."

        await runStory(makeUserMessageEvent(followUpText))
        ctx = await getContextOrThrow()
      }

      const stillIncompleteAfterSecondPass =
        output === "rows" ? !(await isRowsCompleted()) : !isObjectCompleted(ctx)
      if (stillIncompleteAfterSecondPass) {
        const finalText =
          output === "rows"
            ? "CRITICAL: Do not do anything else. Ensure output.jsonl exists at OutputPath and immediately call complete."
            : "CRITICAL: Do not do anything else. Immediately call complete with summary and resultJson (inline JSON)."
        await runStory(makeUserMessageEvent(finalText))
        ctx = await getContextOrThrow()
      }

      if (output === "rows" && !(await isRowsCompleted())) {
        throw new Error("Rows output not completed")
      }
      if (output === "object" && !isObjectCompleted(ctx)) {
        const persisted = await persistObjectResultFromStoryStep({ env, datasetId })
        if (persisted.ok) {
          ctx = await getContextOrThrow()
        } else {
        }
      }

      if (output === "object" && !isObjectCompleted(ctx)) {
        throw new Error("Object output not completed")
      }

      let rowsSandboxRef: StructureRowsOutputSandboxRef | null = null
      const reader: StructureRowsReader = {
        read: async (cursorOrParams?: any, limit?: number) => {
          if (output !== "rows") {
            throw new Error("reader.read() is only supported for output=rows")
          }

          if (!rowsSandboxRef) {
            rowsSandboxRef = await structureDownloadRowsOutputToSandboxStep({
              env,
              structureId: datasetId,
            })
          }

          const params =
            cursorOrParams && typeof cursorOrParams === "object" && ("cursor" in cursorOrParams || "limit" in cursorOrParams)
              ? (cursorOrParams as { cursor?: Partial<StructureRowsOutputPagingCursor>; limit?: number })
              : ({ cursor: cursorOrParams as Partial<StructureRowsOutputPagingCursor> | undefined, limit } as const)

          const page = await structureReadRowsOutputPageFromSandboxStep({
            env,
            sandboxId: rowsSandboxRef.sandboxId,
            localPath: rowsSandboxRef.localPath,
            cursor: params?.cursor,
            limit: params?.limit ?? 200,
          })

          return {
            rows: page.rows,
            cursor: page.nextCursor,
            done: page.done,
          }
        },

        split: async (cursorOrParams?: any, limit?: number) => {
          if (output !== "rows") {
            throw new Error("reader.split() is only supported for output=rows")
          }

          if (!rowsSandboxRef) {
            rowsSandboxRef = await structureDownloadRowsOutputToSandboxStep({
              env,
              structureId: datasetId,
            })
          }

          const params =
            cursorOrParams && typeof cursorOrParams === "object" && ("cursor" in cursorOrParams || "limit" in cursorOrParams)
              ? (cursorOrParams as {
                  cursor?: Partial<StructureRowsOutputPagingCursor>
                  limit?: number
                  datasetId?: string
                })
              : ({
                  cursor: cursorOrParams as Partial<StructureRowsOutputPagingCursor> | undefined,
                  limit,
                  datasetId: undefined,
                } as const)

          const childDatasetId = params?.datasetId ?? createUuidV4()
          const res = await structureSplitRowsOutputToDatasetStep({
            env,
            sandboxId: rowsSandboxRef.sandboxId,
            localPath: rowsSandboxRef.localPath,
            cursor: params?.cursor,
            limit: params?.limit ?? 300,
            childDatasetId,
          })

          return {
            datasetId: res.datasetId,
            rowsWritten: res.rowsWritten,
            cursor: res.nextCursor,
            done: res.done,
          }
        },
      }

      return output === "object" ? { datasetId, reader, dataset: ctx } : { datasetId, reader }
    },
  }

  return api
}

