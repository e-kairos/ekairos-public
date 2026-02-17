"use client"

import React from "react"
import { cn } from "@/lib/utils"
import type { VoiceState } from "@/components/ekairos/voice-provider"
import { Loader2 } from "lucide-react"

export default function PromptWaveform({ levels, state, className }: { levels: number[]; state: VoiceState; className?: string }) {
  const safeLevels = Array.isArray(levels) ? levels : []
  const bars = safeLevels.slice(-48)

  return (
    <div className={cn("w-full px-3 py-3", className)}>
      <div className="h-16 w-full flex items-end gap-[3px] rounded-md px-3 py-2">
        {bars.length > 0 ? (
          bars.map((lv, idx) => {
            const h = Math.max(3, Math.min(64, Math.round(lv * 64)))
            return (
              <div
                key={idx}
                className="w-[4px] rounded-sm bg-primary/80"
                style={{ height: `${h}px` }}
              />
            )
          })
        ) : (
          state === "processing" ? (
            <div className="text-xs text-muted-foreground inline-flex items-center gap-1">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>Procesando audio…</span>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">Waiting for audio…</div>
          )
        )}
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground inline-flex items-center gap-1">
        {state === "processing" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        <span>{state === "recording" ? "Grabando…" : state === "paused" ? "Pausado" : state === "processing" ? "Procesando audio…" : "Listo"}</span>
      </div>
    </div>
  )
}



