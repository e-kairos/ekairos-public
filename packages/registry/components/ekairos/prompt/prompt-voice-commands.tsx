import React from "react"
import { Pause, Play, Square, X } from "lucide-react"
import { PromptButton } from "@/components/ekairos/prompt/prompt-button"

export type VoiceState = "recording" | "paused"

export interface PromptVoiceCommandsProps {
  state?: VoiceState
  onStop?: () => void
  onPause?: () => void
  onResume?: () => void
  onCancel?: () => void
}

export function PromptVoiceCommands({ state, onStop, onPause, onResume, onCancel }: PromptVoiceCommandsProps) {
  const currentState: VoiceState = state ? state : "recording"
  const isPaused = currentState === "paused"

  return (
    <div className="flex items-center gap-2">
      <PromptButton title="Detener" ariaLabel="Detener grabación" onClick={onStop}>
        <Square className="h-4 w-4" />
      </PromptButton>
      {isPaused ? (
        <PromptButton title="Reanudar" ariaLabel="Reanudar grabación" onClick={onResume}>
          <Play className="h-4 w-4" />
        </PromptButton>
      ) : (
        <PromptButton title="Pausar" ariaLabel="Pausar grabación" onClick={onPause}>
          <Pause className="h-4 w-4" />
        </PromptButton>
      )}
      <PromptButton title="Cancelar" ariaLabel="Cancelar grabación" onClick={onCancel}>
        <X className="h-4 w-4" />
      </PromptButton>
    </div>
  )
}

export default PromptVoiceCommands



