import React from "react"
import { Globe } from "lucide-react"
import { PromptButton } from "@/components/ekairos/prompt/prompt-button"

export function PromptWebButton({ active, onToggle, disabled }: { active?: boolean; onToggle?: () => void; disabled?: boolean }) {
  return (
    <PromptButton
      title={active ? "Web habilitado" : "Habilitar búsqueda web"}
      ariaLabel="Búsqueda web"
      active={Boolean(active)}
      onClick={onToggle}
      disabled={disabled}
    >
      <Globe className="h-4 w-4" />
    </PromptButton>
  )
}

export default PromptWebButton



