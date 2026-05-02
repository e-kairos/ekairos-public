import React from "react"
import { ArrowUp, Square, Loader2, X } from "lucide-react"
import { PromptButton } from "./prompt-button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export type ChatStatus = "idle" | "submitted" | "streaming" | "error"

function SendTooltip({
  label,
  children,
}: {
  label: string
  children: React.ReactElement
}) {
  return (
    <TooltipProvider delayDuration={220}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function PromptSendButton({ disabled, status, variant, onStop }: { disabled?: boolean; status?: ChatStatus; variant?: "default" | "filled"; onStop?: () => void }) {
  let Icon = <ArrowUp className="h-4 w-4" />
  if (status === "submitted") { Icon = <Loader2 className="h-4 w-4 animate-spin" /> }
  else if (status === "streaming") { Icon = <Square className="h-3.5 w-3.5" /> }
  else if (status === "error") { Icon = <X className="h-4 w-4" /> }

  if (status === "streaming" && onStop) {
    return (
      <SendTooltip label="Detener">
        <button
          type="button"
          aria-label="Detener respuesta"
          onClick={onStop}
          className="qa-chat-send inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-destructive text-destructive-foreground shadow-[0_8px_22px_-14px_hsl(var(--destructive)/0.8)] transition-[opacity,transform,box-shadow] hover:opacity-90 active:translate-y-px"
        >
          {Icon}
        </button>
      </SendTooltip>
    )
  }

  if (variant === "filled") {
    return (
      <SendTooltip label="Enviar">
        <button
          type="submit"
          aria-label="Enviar"
          disabled={Boolean(disabled)}
          className="qa-chat-send inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-foreground text-background shadow-[0_8px_22px_-14px_rgba(15,23,42,0.7)] transition-[opacity,transform,box-shadow] hover:opacity-90 hover:shadow-[0_10px_26px_-14px_rgba(15,23,42,0.78)] active:translate-y-px disabled:pointer-events-none disabled:opacity-30"
        >
          {Icon}
        </button>
      </SendTooltip>
    )
  }

  return (
    <PromptButton
      type="submit"
      title="Enviar"
      ariaLabel="Enviar"
      disabled={Boolean(disabled)}
      className="qa-chat-send"
    >
      {Icon}
    </PromptButton>
  )
}

export default PromptSendButton


