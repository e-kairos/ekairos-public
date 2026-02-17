import React from "react"
import { Globe } from "lucide-react"
import { PromptButton } from "@/components/ekairos/prompt/prompt-button"

export function PromptWebButton({ active, onToggle }: { active?: boolean; onToggle?: () => void }) {
  return (
    <PromptButton
      title={active ? "Web habilitado" : "Habilitar búsqueda web"}
      ariaLabel="Búsqueda web"
      active={Boolean(active)}
      onClick={onToggle}
    >
      <Globe className="h-4 w-4" />
    </PromptButton>
  )
}

export default PromptWebButton



