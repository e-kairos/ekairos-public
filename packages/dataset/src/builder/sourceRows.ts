import type { DomainSchemaResult } from "@ekairos/domain"

export function rowsToJsonl(rows: any[]): string {
  return rows
    .map((row) =>
      JSON.stringify({
        type: "row",
        data: row,
      }),
    )
    .join("\n")
    .concat(rows.length > 0 ? "\n" : "")
}

export function normalizeQueryRows(result: any): any[] {
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

  const rows: any[] = []
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

export function getDomainDescriptor(domain: DomainSchemaResult) {
  const meta = (domain as any)?.meta ?? {}
  const context = typeof (domain as any)?.context === "function" ? (domain as any).context() : {}
  const name = String(meta?.name ?? context?.name ?? "domain")
  const packageName = String(meta?.packageName ?? "")
  return {
    domainName: name,
    ...(packageName ? { domainPackageName: packageName } : {}),
  }
}
