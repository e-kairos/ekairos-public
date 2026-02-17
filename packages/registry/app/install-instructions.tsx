"use client"

import React, { useState } from "react"
import { cn } from "@/lib/utils"

const REGISTRY_HOST = "registry.ekairos.dev"

type Mode = "ekairos" | "shadcn"

const COMMANDS: Record<Mode, string> = {
  ekairos: "npx ekairos@latest add @ekairos/<nombre-componente>",
  shadcn: "npx shadcn@latest add @ekairos/<nombre-componente>",
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="text-muted-foreground hover:text-foreground text-xs transition-colors"
    >
      {copied ? "copiado" : "copiar"}
    </button>
  )
}

export function InstallInstructions() {
  const [mode, setMode] = useState<Mode>("ekairos")
  const command = COMMANDS[mode]

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[0.7rem] text-muted-foreground uppercase tracking-[0.5em]">
            instalación
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Usa el CLI de Ekairos o el CLI de shadcn para instalar los componentes principales.
          </p>
        </div>

        <div className="inline-flex rounded-full border border-border/70 bg-card p-1 text-[0.65rem]">
          <button
            type="button"
            onClick={() => setMode("ekairos")}
            className={cn(
              "px-3 py-1 rounded-full uppercase tracking-[0.25em] transition-colors",
              mode === "ekairos"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Ekairos CLI
          </button>
          <button
            type="button"
            onClick={() => setMode("shadcn")}
            className={cn(
              "px-3 py-1 rounded-full uppercase tracking-[0.25em] transition-colors",
              mode === "shadcn"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            shadcn CLI
          </button>
        </div>
      </div>

      <div className="border border-border/80 rounded-lg bg-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <code className="text-sm font-mono text-foreground">{command}</code>
          <CopyButton text={command} />
        </div>
      </div>

      <p className="text-[0.65rem] text-muted-foreground">
        Registry base: {REGISTRY_HOST}. Copia el comando y reemplaza{" "}
        <code className="font-mono">@ekairos/&lt;nombre-componente&gt;</code> para instalar cualquier componente específico.
      </p>
    </div>
  )
}


