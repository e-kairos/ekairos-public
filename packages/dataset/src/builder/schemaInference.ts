import Ajv from "ajv"

import type { DatasetSchemaInput } from "./types.js"

const ajv = new Ajv({ allErrors: true, strict: false })

function inferJsonSchemaType(value: unknown): any {
  if (value === null) return { type: "null" }
  if (Array.isArray(value)) return { type: "array" }
  switch (typeof value) {
    case "number":
      return { type: "number" }
    case "boolean":
      return { type: "boolean" }
    case "object":
      return { type: "object", additionalProperties: true }
    default:
      return { type: "string" }
  }
}

export function inferDatasetSchema(
  rows: any[],
  title = "DatasetRow",
  description = "One dataset row",
): DatasetSchemaInput {
  const properties: Record<string, any> = {}
  const required: string[] = []
  const keys = new Set<string>()

  for (const row of rows) {
    if (!row || typeof row !== "object") continue
    for (const key of Object.keys(row)) {
      keys.add(key)
    }
  }

  for (const key of keys) {
    const values = rows.map((row) => (row && typeof row === "object" ? row[key] : undefined))
    const firstDefined = values.find((value) => value !== undefined)
    properties[key] = {
      ...inferJsonSchemaType(firstDefined),
      description: `${key} value`,
    }
    if (values.every((value) => value !== undefined)) {
      required.push(key)
    }
  }

  return {
    title,
    description,
    schema: {
      type: "object",
      additionalProperties: false,
      properties,
      required,
    },
  }
}

export function validateRows(rows: any[], schema: DatasetSchemaInput) {
  const validator = ajv.compile(schema.schema)
  for (const row of rows) {
    const valid = validator(row)
    if (!valid) {
      const error = validator.errors?.map((entry) => entry.message || "validation_error").join("; ")
      throw new Error(error || "dataset_schema_validation_failed")
    }
  }
}
