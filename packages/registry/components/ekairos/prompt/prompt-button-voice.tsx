import React from "react"
import { Mic } from "lucide-react"
import { PromptButton } from "@/components/ekairos/prompt/prompt-button"

export function PromptVoiceButton({ onClick, disabled }: { onClick?: () => void; disabled?: boolean }) {
  return (
    <PromptButton title="Mandar audio" ariaLabel="Mandar audio" onClick={onClick} disabled={disabled}>
      <Mic className="h-4 w-4" />
    </PromptButton>
  )
}

export default PromptVoiceButton



