import React from "react"
import { Globe } from "lucide-react"
import { PromptButton } from "./prompt-button"

export function PromptWebButton({ active, onToggle, disabled, variant }: { active?: boolean; onToggle?: () => void; disabled?: boolean; variant?: "default" | "ghost" }) {
  return (
    <PromptButton
      title={active ? "Web habilitado" : "Habilitar búsqueda web"}
      ariaLabel="Búsqueda web"
      active={Boolean(active)}
      onClick={onToggle}
      disabled={disabled}
      variant={variant}
    >
      <Globe className="h-4 w-4" />
    </PromptButton>
  )
}

export default PromptWebButton



