import React, { memo, useCallback, useMemo } from "react"
import { cn } from "@/lib/utils"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Info } from "lucide-react"

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
    details: "Cadenas de pensamiento extensas. Mayor costo y posible mayor latencia.",
  },
]

function Bars({ level }: { level: ReasoningLevel }) {
  const on = "bg-primary border-primary"
  const off = "bg-transparent border-border"
  return (
    <div className="flex items-end gap-[2px]">
      <span className={["inline-block h-[6px] w-[6px] rounded-[2px] border", level !== "off" ? on : off].join(" ")}></span>
      <span className={["inline-block h-[9px] w-[6px] rounded-[2px] border", level === "medium" || level === "high" ? on : off].join(" ")}></span>
      <span className={["inline-block h-[12px] w-[6px] rounded-[2px] border", level === "high" ? on : off].join(" ")}></span>
    </div>
  )
}

const BarsMemo = memo(Bars)
BarsMemo.displayName = "Bars"

export const PromptReasoningButton = memo(function PromptReasoningButton({ value, onChange }: { value?: ReasoningLevel; onChange?: (v: ReasoningLevel) => void }) {
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

  let activeClass: string | undefined = undefined
  if (active) {
    activeClass = "border-accent"
  }

  return (
    <TooltipProvider>
      <Select value={level} onValueChange={handleChange}>
        <Tooltip>
          <TooltipTrigger asChild>
            <SelectTrigger
              aria-label="Razonamiento"
              title="Razonamiento"
              className={cn(
                "h-9 w-auto min-w-0 shrink-0 flex items-center justify-center gap-2 !rounded-lg border px-2 py-0",
                "border-border bg-background text-foreground",
                "hover:bg-accent/30 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-0",
                "disabled:opacity-50 disabled:pointer-events-none",
                "[&>svg]:hidden [&>span]:line-clamp-none",
                activeClass,
              )}
            >
              <SelectValue asChild>
                <div className="flex items-center gap-2">
                  <BarsMemo level={level} />
                  <span className="text-xs font-medium whitespace-nowrap">{current.name}</span>
                </div>
              </SelectValue>
            </SelectTrigger>
          </TooltipTrigger>
          <TooltipContent sideOffset={6}>
            <div className="max-w-64">
              <div className="font-medium">Razonamiento: {current.name}</div>
              <div className="opacity-90">
                {current.headline}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {current.details}
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
        <SelectContent position="popper">
          {MODES.map(function(mode) {
            return (
              <SelectItem key={mode.value} value={mode.value} className="pr-10">
                <div className="flex w-full items-center gap-3">
                  <div className="mt-0.5">
                    <BarsMemo level={mode.value} />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium leading-none">{mode.name}</div>
                    <div className="text-xs text-muted-foreground leading-snug">{mode.headline}</div>
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



