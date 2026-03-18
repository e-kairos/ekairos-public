import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { randomUUID } from "node:crypto"

const DEFAULT_MANIFEST_PATH = process.env.EKAIROS_RUNTIME_MANIFEST_PATH || ".ekairos/runtime.json"
const INSTANT_API_BASE_URL = "https://api.instantdb.com"

export async function readJsonFile(filePath) {
  const content = await readFile(filePath, "utf8")
  return JSON.parse(content)
}

export async function writeJsonFile(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8")
}

export async function readRuntimeManifest(manifestPath) {
  return await readJsonFile(manifestPath || DEFAULT_MANIFEST_PATH)
}

function authorizedHeaders(manifest) {
  const headers = {
    "content-type": "application/json",
    "app-id": String(manifest?.instant?.appId ?? ""),
  }
  const scopedToken = String(manifest?.instant?.token ?? "").trim()
  if (scopedToken) {
    headers["as-token"] = scopedToken
  }
  return headers
}

async function jsonOrThrow(response) {
  const text = await response.text()
  let parsed = {}
  try {
    parsed = text ? JSON.parse(text) : {}
  } catch {
    parsed = { raw: text }
  }
  if (!response.ok) {
    throw new Error(JSON.stringify({ status: response.status, body: parsed }))
  }
  return parsed
}

export async function instantQuery(query, manifestPath) {
  const manifest = await readRuntimeManifest(manifestPath)
  const response = await fetch(`${manifest?.instant?.apiBaseUrl || INSTANT_API_BASE_URL}/admin/query`, {
    method: "POST",
    headers: authorizedHeaders(manifest),
    body: JSON.stringify({ query }),
  })
  return await jsonOrThrow(response)
}

export async function instantTransact(steps, manifestPath) {
  const manifest = await readRuntimeManifest(manifestPath)
  const response = await fetch(`${manifest?.instant?.apiBaseUrl || INSTANT_API_BASE_URL}/admin/transact`, {
    method: "POST",
    headers: authorizedHeaders(manifest),
    body: JSON.stringify({
      steps,
      "throw-on-missing-attrs?": true,
    }),
  })
  return await jsonOrThrow(response)
}

export async function instantUploadFile(params) {
  const manifest = await readRuntimeManifest(params.manifestPath)
  const headers = {
    "app-id": String(manifest?.instant?.appId ?? ""),
    path: String(params.path),
  }
  const scopedToken = String(manifest?.instant?.token ?? "").trim()
  if (scopedToken) {
    headers["as-token"] = scopedToken
  }
  if (params.contentType) {
    headers["content-type"] = params.contentType
  }
  if (params.contentDisposition) {
    headers["content-disposition"] = params.contentDisposition
  }
  const response = await fetch(`${manifest?.instant?.apiBaseUrl || INSTANT_API_BASE_URL}/admin/storage/upload`, {
    method: "PUT",
    headers,
    body: params.buffer,
  })
  return await jsonOrThrow(response)
}

export function normalizeQueryRows(result) {
  if (!result || typeof result !== "object") return []
  const entries = Object.entries(result)
  if (entries.length === 0) return []

  if (entries.length === 1) {
    const [key, value] = entries[0]
    if (Array.isArray(value)) {
      return value.map((row) => (row && typeof row === "object" ? row : { value: row }))
    }
    if (value && typeof value === "object") {
      return [value]
    }
    return [{ [key]: value }]
  }

  const rows = []
  for (const [key, value] of entries) {
    if (Array.isArray(value)) {
      for (const row of value) {
        if (row && typeof row === "object") {
          rows.push({ __entity: key, ...row })
        } else {
          rows.push({ __entity: key, value: row })
        }
      }
      continue
    }
    if (value && typeof value === "object") {
      rows.push({ __entity: key, ...value })
      continue
    }
    rows.push({ __entity: key, value })
  }
  return rows
}

export function rowsToJsonl(rows) {
  return rows
    .map((row) => JSON.stringify({ type: "row", data: row }))
    .join("\n")
    .concat(rows.length > 0 ? "\n" : "")
}

export function countJsonlRows(text) {
  return String(text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter((entry) => entry?.type === "row").length
}

export function newId() {
  return randomUUID()
}
