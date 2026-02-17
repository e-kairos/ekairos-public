export type PreparedSource = {
  kind: "file" | "dataset" | "text"
  id: string
  path: string
  name?: string
  mimeType?: string
}

export type StructurePromptContext = {
  datasetId: string
  mode: "auto" | "schema"
  output: "rows" | "object"
  outputSchema?: any
  sources: PreparedSource[]
  workstation: string
  outputPath: string
  sandboxProvider?: string
  sandboxRuntime?: string
  sandboxEphemeral?: boolean
  sandboxVolumeName?: string
  sandboxVolumeMountPath?: string
  sandboxSnapshot?: string
  sandboxImage?: string
}

export function buildStructurePrompt(ctx: StructurePromptContext): string {
  const goalText =
    ctx.output === "rows"
      ? "Generate a JSONL dataset (output.jsonl) where each line is a JSON object: {\"type\":\"row\",\"data\":{...}}."
      : "Generate a single JSON object result that matches the output schema (when provided)."

  const lines: string[] = []
  lines.push("## ROLE")
  lines.push("You are an AI system that produces structured outputs from mixed sources (files, text, and existing datasets).")
  lines.push("")
  lines.push("## GOAL")
  lines.push(goalText)
  lines.push("")
  lines.push("## CONTEXT")
  lines.push(`DatasetId: ${ctx.datasetId}`)
  lines.push("")
  lines.push("## SOURCES")
  for (const s of ctx.sources) {
    lines.push(`- kind: ${s.kind}`)
    lines.push(`  id: ${s.id}`)
    lines.push(`  path: ${s.path}`)
    if (s.name) lines.push(`  name: ${s.name}`)
    if (s.mimeType) lines.push(`  mimeType: ${s.mimeType}`)
  }
  lines.push("")
  lines.push("## SANDBOX")
  if (ctx.sandboxProvider) lines.push(`Provider: ${ctx.sandboxProvider}`)
  if (ctx.sandboxRuntime) lines.push(`Runtime: ${ctx.sandboxRuntime}`)
  if (ctx.sandboxEphemeral !== undefined) lines.push(`Ephemeral: ${ctx.sandboxEphemeral ? "true" : "false"}`)
  if (ctx.sandboxVolumeName || ctx.sandboxVolumeMountPath) {
    lines.push(`Volume: ${ctx.sandboxVolumeName ?? "unknown"} -> ${ctx.sandboxVolumeMountPath ?? "unknown"}`)
  }
  if (ctx.sandboxSnapshot) lines.push(`Snapshot: ${ctx.sandboxSnapshot}`)
  if (ctx.sandboxImage) lines.push(`Image: ${ctx.sandboxImage}`)
  lines.push(`Workstation: ${ctx.workstation}`)
  lines.push(`OutputPath: ${ctx.outputPath}`)
  lines.push("")

  if (ctx.mode === "schema" && ctx.outputSchema) {
    lines.push("## OUTPUT SCHEMA (JSON Schema)")
    lines.push(JSON.stringify(ctx.outputSchema, null, 2))
    lines.push("")
  }

  lines.push("## INSTRUCTIONS")
  if (ctx.mode === "auto") {
    lines.push("1) Inspect the Sources. If needed, use executeCommand to open/read files and explore structure (do not guess). Keep stdout concise.")
    lines.push("2) Propose an output JSON Schema (lowerCamelCase field names). You may add derived fields if helpful, but justify them. Then call generateSchema.")
    if (ctx.output === "rows") {
      lines.push("3) Use executeCommand to read the sources and write output.jsonl at OutputPath. Each line must be {\"type\":\"row\",\"data\":{...}}. Keep prints concise.")
      lines.push("4) Call complete to validate and persist the output.jsonl to Instant Storage and mark the dataset completed.")
    } else {
      lines.push("3) Produce the final JSON object. If needed, use executeCommand to compute it. Then you MUST call complete. Prefer resultJson (inline JSON) for small objects; use resultPath only if the object is large.")
    }
  } else {
    if (ctx.output === "rows") {
      lines.push("1) Use executeCommand to read the sources and write output.jsonl at OutputPath. Each line must be {\"type\":\"row\",\"data\":{...}}. Keep prints concise.")
      lines.push("2) Call complete to validate and persist the output.jsonl to Instant Storage and mark the dataset completed.")
    } else {
      lines.push("1) Produce the final JSON object. If needed, use executeCommand to compute it. Then you MUST call complete. Prefer resultJson (inline JSON) for small objects; use resultPath only if the object is large.")
    }
  }
  lines.push("")
  lines.push("## RULES")
  lines.push("- Field names must be lowerCamelCase.")
  lines.push("- Do not leak secrets. Do not print large raw datasets to stdout.")

  return lines.join("\n")
}

