import React from "react"
import { cn } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export interface PromptButtonProps {
  children?: React.ReactNode
  className?: string
  title?: string
  ariaLabel?: string
  type?: "button" | "submit"
  disabled?: boolean
  active?: boolean
  onClick?: () => void
  /** Used by compact prompts: hairline border, flatter chrome. */
  variant?: "default" | "ghost"
}

export function PromptButton({ children, className, title, ariaLabel, type, disabled, active, onClick, variant = "default" }: PromptButtonProps) {
  const buttonType = type ? type : "button"
  const isActive = Boolean(active)
  const isGhost = variant === "ghost"
  const tooltipLabel = title || ariaLabel

  const button = (
    <button
      type={buttonType}
      aria-label={ariaLabel || title}
      disabled={disabled}
      data-active={isActive ? "true" : "false"}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border px-0 shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition-[color,background-color,border-color,box-shadow,transform]",
        isGhost
          ? "border-transparent bg-transparent text-muted-foreground shadow-none hover:border-border/65 hover:bg-muted/55 hover:text-foreground"
          : "border-border/70 bg-background text-foreground hover:border-border hover:bg-muted/45 hover:shadow-[0_4px_14px_-10px_rgba(15,23,42,0.38)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-0",
        "disabled:opacity-40 disabled:pointer-events-none",
        "active:translate-y-px",
        "data-[active=true]:border-ring/45 data-[active=true]:bg-accent/40 data-[active=true]:text-accent-foreground data-[active=true]:shadow-[0_4px_18px_-12px_hsl(var(--ring)/0.45)]",
        className
      )}
    >
      {children}
    </button>
  )

  if (!tooltipLabel) {
    return button
  }

  return (
    <TooltipProvider delayDuration={220}>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>{tooltipLabel}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export default PromptButton



