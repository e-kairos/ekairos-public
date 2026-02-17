import React from "react"
import { Paperclip } from "lucide-react"
import { PromptButton } from "@/components/ekairos/prompt/prompt-button"

export function PromptAttachButton({ onClick }: { onClick?: () => void }) {
  return (
    <PromptButton title="Adjuntar" ariaLabel="Adjuntar" onClick={onClick}>
      <Paperclip className="h-4 w-4" />
    </PromptButton>
  )
}

export default PromptAttachButton



