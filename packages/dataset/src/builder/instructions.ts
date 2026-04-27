import type { DatasetSchemaInput } from "./types"

export function buildFileDefaultInstructions(schema?: DatasetSchemaInput) {
  if (schema) {
    return "Create a dataset from the source file and ensure each output row matches the provided dataset schema exactly."
  }
  return "Create a dataset representing the source content as structured rows."
}

export function buildRawSourceInstructions(sourceKind: "file" | "text") {
  if (sourceKind === "text") {
    return "Create a dataset representing the raw text content as structured rows without applying business transformations."
  }
  return "Create a dataset representing the raw file content as structured rows without applying business transformations."
}

export function buildTransformInstructions(sourceCount: number, userInstructions?: string, schema?: DatasetSchemaInput) {
  const explicit = String(userInstructions ?? "").trim()
  if (explicit) return explicit
  if (sourceCount > 1) {
    if (schema) {
      return "Combine the source datasets into a new dataset that matches the provided output schema exactly."
    }
    return "Combine the source datasets into one coherent dataset."
  }
  if (schema) {
    return "Transform the source dataset into a new dataset that matches the provided output schema exactly."
  }
  return "Transform the source dataset into a new useful dataset."
}

export function buildObjectOutputInstructions(userInstructions?: string) {
  const base = String(userInstructions ?? "").trim()
  const objectContract = [
    "Output mode is object.",
    "Produce exactly one JSONL row in output.jsonl.",
    "That row must be {\"type\":\"row\",\"data\":<the final object>}.",
    "Do not emit multiple rows, headers, summaries, or metadata rows.",
  ].join("\n")

  if (!base) return objectContract
  return [base, "", objectContract].join("\n")
}
