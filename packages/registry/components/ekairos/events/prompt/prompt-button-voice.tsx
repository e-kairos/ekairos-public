import React from "react"
import { Mic } from "lucide-react"
import { PromptButton } from "./prompt-button"

export function PromptVoiceButton({ onClick, disabled, variant }: { onClick?: () => void; disabled?: boolean; variant?: "default" | "ghost" }) {
  return (
    <PromptButton title="Mandar audio" ariaLabel="Mandar audio" onClick={onClick} disabled={disabled} variant={variant}>
      <Mic className="h-4 w-4" />
    </PromptButton>
  )
}

export default PromptVoiceButton



