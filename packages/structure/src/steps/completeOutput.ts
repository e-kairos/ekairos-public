function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null
  return value as Record<string, unknown>
}

function readPart(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value)
  if (!record) return null
  const nestedPart = asRecord(record.part)
  return nestedPart ?? record
}

function readCompleteOutputFromPart(value: unknown): unknown | null {
  const part = readPart(value)
  if (!part) return null

  if (part.type === "tool-complete" && part.state === "output-available") {
    return part.output ?? null
  }

  if (part.type !== "action") return null

  const content = asRecord(part.content)
  if (
    content?.status !== "completed" ||
    content?.actionName !== "complete"
  ) {
    return null
  }

  return content.output ?? null
}

export function findLatestCompleteToolOutput(events: unknown[]): unknown | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = asRecord(events[i])
    const content = asRecord(event?.content)
    const parts = Array.isArray(content?.parts) ? content.parts : null
    if (!parts) continue

    for (let j = parts.length - 1; j >= 0; j--) {
      const output = readCompleteOutputFromPart(parts[j])
      if (output !== null) return output
    }
  }

  return null
}

