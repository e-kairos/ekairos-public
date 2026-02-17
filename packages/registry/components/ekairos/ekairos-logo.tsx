"use client"

import React from "react"
import { Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"

export interface EkairosLogoProps {
  showIcon?: boolean
  showLabel?: boolean
  iconClassName?: string
  labelClassName?: string
  className?: string
  size?: "sm" | "md" | "lg"
}

const sizeConfig = {
  sm: {
    icon: "size-4",
    label: "text-sm",
    gap: "gap-1.5"
  },
  md: {
    icon: "size-5",
    label: "text-base",
    gap: "gap-2"
  },
  lg: {
    icon: "size-6",
    label: "text-lg",
    gap: "gap-2.5"
  }
}

export function EkairosLogo({
  showIcon = true,
  showLabel = true,
  iconClassName,
  labelClassName,
  className,
  size = "md"
}: EkairosLogoProps) {
  // Ensure at least one element is shown
  const displayIcon = showIcon !== false
  const displayLabel = showLabel !== false || !displayIcon

  const config = sizeConfig[size]

  return (
    <div className={cn("flex items-center", config.gap, className)}>
      {displayIcon && (
        <Sparkles className={cn("text-primary", config.icon, iconClassName)} />
      )}
      {displayLabel && (
        <span className={cn("font-semibold tracking-tight", config.label, labelClassName)}>
          ekairos
        </span>
      )}
    </div>
  )
}

