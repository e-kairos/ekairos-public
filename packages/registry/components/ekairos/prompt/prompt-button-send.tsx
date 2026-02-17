import React from "react"
import { ArrowUp, Square, Loader2, X } from "lucide-react"
import { PromptButton } from "@/components/ekairos/prompt/prompt-button"

export type ChatStatus = "idle" | "submitted" | "streaming" | "error"

export function PromptSendButton({ disabled, status }: { disabled?: boolean; status?: ChatStatus }) {
  let Icon = <ArrowUp className="h-4 w-4" />
  if (status === "submitted") { Icon = <Loader2 className="h-4 w-4 animate-spin" /> }
  else if (status === "streaming") { Icon = <Square className="h-4 w-4" /> }
  else if (status === "error") { Icon = <X className="h-4 w-4" /> }
  return (
    <PromptButton type="submit" title="Enviar" ariaLabel="Enviar" disabled={Boolean(disabled)}>
      {Icon}
    </PromptButton>
  )
}

export default PromptSendButton



