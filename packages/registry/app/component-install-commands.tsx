"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"

type Props = {
  componentName: string
}

type CommandOption = {
  id: string
  label: string
  description: string
  command: string
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
      className="text-[0.65rem] uppercase tracking-[0.3em] text-muted-foreground hover:text-foreground transition-colors"
    >
      {copied ? "Copiado" : "Copiar"}
    </button>
  )
}

export function ComponentInstallCommands({ componentName }: Props) {
  const options: CommandOption[] = [
    {
      id: "shadcn",
      label: "shadcn CLI",
      description: "Instala el componente directamente",
      command: `npx shadcn@latest add @ekairos/${componentName}`,
    },
    {
      id: "ekairos",
      label: "Ekairos CLI",
      description: "Ejecuta el flujo interactivo y selecciona este componente",
      command: `npx ekairos@latest add @ekairos/${componentName}`,
    },
  ]

  return (
    <div className="rounded-lg border border-border/70 bg-card/60 px-3 py-2 text-xs space-y-2">
      {options.map((option) => (
        <div
          key={option.id}
          className="flex flex-col gap-1 rounded-md border border-border/60 px-2 py-2 bg-background/40"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-medium text-foreground">{option.label}</p>
              <p className="text-[0.7rem] text-muted-foreground">{option.description}</p>
            </div>
            <CopyButton text={option.command} />
          </div>
          <pre className={cn("font-mono text-[0.72rem] text-foreground break-all whitespace-pre-wrap")}>
            {option.command}
          </pre>
        </div>
      ))}
    </div>
  )
}


