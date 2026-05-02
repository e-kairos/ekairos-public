import React from "react"
import { Paperclip } from "lucide-react"
import { PromptButton } from "./prompt-button"

export function PromptAttachButton({ onClick, disabled, variant }: { onClick?: () => void; disabled?: boolean; variant?: "default" | "ghost" }) {
  return (
    <PromptButton title="Adjuntar" ariaLabel="Adjuntar" onClick={onClick} disabled={disabled} variant={variant}>
      <Paperclip className="h-4 w-4" />
    </PromptButton>
  )
}

export default PromptAttachButton



