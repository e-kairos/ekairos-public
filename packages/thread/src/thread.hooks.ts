function stripTrailingSlash(value: string) {
  return value.replace(/\/$/, "")
}

export function getClientResumeHookUrl(): string | undefined {
  const direct = process.env.EKAIROS_CLIENT_RESUME_HOOK_URL
  if (typeof direct === "string" && direct.trim()) return direct.trim()

  const base = process.env.EKAIROS_CLIENT_BASE_URL
  if (typeof base === "string" && base.trim()) {
    return `${stripTrailingSlash(base.trim())}/api/ekairos/resume-hook`
  }

  return undefined
}

/**
 * Deterministic hook token for approving an `auto: false` tool call.
 *
 * External systems can resume the hook with:
 * `resumeHook(toolApprovalHookToken({ executionId, toolCallId }), { approved: true })`
 */
export function toolApprovalHookToken(params: {
  executionId: string
  toolCallId: string
}) {
  return `ekairos_thread:tool-approval:${params.executionId}:${params.toolCallId}`
}

/**
 * Deterministic webhook token for approving an `auto: false` tool call.
 *
 * When using Workflow DevKit, the webhook is available at:
 * `/.well-known/workflow/v1/webhook/:token`
 */
export function toolApprovalWebhookToken(params: {
  executionId: string
  toolCallId: string
}) {
  return `ekairos_thread:tool-approval-webhook:${params.executionId}:${params.toolCallId}`
}
