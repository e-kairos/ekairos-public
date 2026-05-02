import React, { memo, useCallback, useMemo } from "react"
import { cn } from "@/lib/utils"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

export type ReasoningLevel = "off" | "low" | "medium" | "high"

interface ModeDef {
  value: ReasoningLevel
  name: string
  headline: string
  details: string
}

const MODES: ModeDef[] = [
  {
    value: "off",
    name: "Apagado",
    headline: "Sin razonamiento adicional",
    details: "Respuestas más rápidas y económicas. No incluye pasos intermedios ni justificaciones.",
  },
  {
    value: "low",
    name: "Básico",
    headline: "Razonamiento ligero",
    details: "Buen equilibrio entre costo y calidad. Traza breve cuando es útil.",
  },
  {
    value: "medium",
    name: "Equilibrado",
    headline: "Estructura y justificaciones moderadas",
    details: "Ideal para tareas con varios pasos. Precisión y contexto razonables.",
  },
  {
    value: "high",
    name: "Profundo",
    headline: "Análisis detallado",
    details: "Resumen de razonamiento mas detallado. Mayor costo y posible mayor latencia.",
  },
]

function Bars({ level }: { level: ReasoningLevel }) {
  const on = "border-primary/50 bg-primary/35"
  const off = "border-border bg-transparent"
  return (
    <div className="flex items-end gap-px" aria-hidden>
      <span className={cn("inline-block h-[5px] w-[3px] border", level !== "off" ? on : off)} />
      <span className={cn("inline-block h-[8px] w-[3px] border", level === "medium" || level === "high" ? on : off)} />
      <span className={cn("inline-block h-[11px] w-[3px] border", level === "high" ? on : off)} />
    </div>
  )
}

const BarsMemo = memo(Bars)
BarsMemo.displayName = "Bars"

export const PromptReasoningButton = memo(function PromptReasoningButton({ value, onChange, disabled, variant }: { value?: ReasoningLevel; onChange?: (v: ReasoningLevel) => void; disabled?: boolean; variant?: "default" | "ghost" }) {
  const isGhost = variant === "ghost"
  const level: ReasoningLevel = value || "low"

  const handleChange = useCallback((next: string) => {
    if (onChange) {
      onChange(next as ReasoningLevel)
    }
  }, [onChange])

  const active = useMemo(() => {
    return level !== "off"
  }, [level])

  const current = useMemo(() => {
    const found = MODES.find(function(m) { return m.value === level })
    if (found) {
      return found
    }
    return MODES[1]
  }, [level])

  return (
    <TooltipProvider>
      <Select value={level} onValueChange={handleChange} disabled={disabled}>
        <Tooltip>
          <TooltipTrigger asChild>
            <SelectTrigger
              aria-label="Razonamiento"
              disabled={disabled}
              className={cn(
                "h-8 w-auto min-w-0 shrink-0 gap-1.5 !rounded-xl px-2.5 py-0 shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition-[background-color,border-color,box-shadow]",
                isGhost
                  ? "border-transparent bg-transparent text-muted-foreground shadow-none hover:border-border/65 hover:bg-muted/55 hover:text-foreground"
                  : "border-border/70 bg-background hover:border-border hover:bg-muted/40",
                active && "border-ring/45 bg-accent/35 text-foreground shadow-[0_4px_18px_-12px_hsl(var(--ring)/0.42)]",
                !active && level === "off" && "text-muted-foreground",
                "focus:outline-none focus:ring-2 focus:ring-ring/40 focus:ring-offset-0",
                "disabled:opacity-40 disabled:pointer-events-none",
                "[&>svg]:ml-0.5 [&>svg]:size-3 [&>svg]:shrink-0 [&>svg]:opacity-50 [&>svg]:text-muted-foreground",
                "[&>span]:line-clamp-none",
              )}
            >
              <SelectValue asChild>
                <div className="flex items-center gap-1.5">
                  <BarsMemo level={level} />
                  <span className="text-[11px] font-semibold tracking-tight whitespace-nowrap">{current.name}</span>
                </div>
              </SelectValue>
            </SelectTrigger>
          </TooltipTrigger>
          <TooltipContent sideOffset={8} className="max-w-72 px-3 py-2.5 leading-normal">
            <div className="space-y-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{current.name}</div>
              <div className="text-sm text-foreground">{current.headline}</div>
              <div className="text-xs leading-relaxed text-muted-foreground">{current.details}</div>
            </div>
          </TooltipContent>
        </Tooltip>
        <SelectContent position="popper" className="rounded-xl p-0 shadow-[0_18px_46px_-26px_rgba(15,23,42,0.5)]">
          {MODES.map(function(mode) {
            return (
              <SelectItem
                key={mode.value}
                value={mode.value}
                className="cursor-pointer rounded-none border-b border-border/45 py-2 pr-9 pl-2.5 first:rounded-t-xl last:rounded-b-xl last:border-b-0"
              >
                <div className="flex w-full items-start gap-2.5">
                  <div className="mt-0.5 shrink-0">
                    <BarsMemo level={mode.value} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-semibold leading-tight tracking-tight">{mode.name}</div>
                    <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{mode.headline}</div>
                  </div>
                </div>
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
    </TooltipProvider>
  )
})

PromptReasoningButton.displayName = "PromptReasoningButton"
export default PromptReasoningButton



