"use client"

import React, { useEffect, useState } from "react"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { vscDarkPlus, vs } from "react-syntax-highlighter/dist/esm/styles/prism"
import type { RegistryItem } from "@/lib/registry-types"
import { useRegistrySession } from "@/lib/registry-session"
import { cn } from "@/lib/utils"

const REGISTRY_HOST = "registry.ekairos.dev"

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      className="text-muted-foreground hover:text-foreground text-xs transition-colors"
    >
      {copied ? "copiado" : "copiar"}
    </button>
  )
}

type InstallOption = {
  id: string
  label: string
  command: string
}

function InstallTabs({ options }: { options: InstallOption[] }) {
  const [activeId, setActiveId] = useState(options[0]?.id ?? "")
  const activeOption = options.find(option => option.id === activeId) ?? options[0]

  if (!activeOption) return null

  return (
    <div className="border border-border/80 rounded-lg bg-card overflow-hidden">
      <div className="flex gap-3 px-4 pt-3 border-b border-border/80">
        {options.map(option => (
          <button
            key={option.id}
            type="button"
            onClick={() => setActiveId(option.id)}
            className={cn(
              "flex-1 pb-3 text-[0.65rem] uppercase tracking-[0.35em] text-left transition-colors",
              activeOption.id === option.id ? "text-foreground border-b-2 border-foreground" : "text-muted-foreground border-b-2 border-transparent hover:text-foreground"
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between px-4 py-4">
        <code className="text-sm font-mono text-foreground">{activeOption.command}</code>
        <CopyButton text={activeOption.command} />
      </div>
    </div>
  )
}

type ComponentDocPageProps = {
  item: RegistryItem
}

export function ComponentDocPage({ item }: ComponentDocPageProps) {
  const [view, setView] = useState<"preview" | "code">("preview")
  const [isDark, setIsDark] = useState(false)
  const registrySession = useRegistrySession()

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"))
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"))
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"]
    })
    return () => observer.disconnect()
  }, [])

  const installCmd = `npx ekairos@latest add ${item.registryName}`
  const shadcnCmd = `npx shadcn@latest add ${item.registryName}`
  const installOptions: InstallOption[] = [
    {
      id: "ai-elements",
      label: "ekairos CLI",
      command: installCmd
    },
    {
      id: "shadcn",
      label: "shadcn CLI",
      command: shadcnCmd
    }
  ]

  return (
    <div className="space-y-12 text-foreground">
      <div className="space-y-4">
        <h1 className="text-4xl font-semibold tracking-tight">{item.title}</h1>
        <p className="text-muted-foreground max-w-xl">{item.subtitle}</p>
      </div>

      <div className="space-y-3">
        <div className="text-[0.7rem] text-muted-foreground uppercase tracking-[0.5em]">installation</div>
        <InstallTabs options={installOptions} />
        <p className="text-xs text-muted-foreground">
          Disponible en {REGISTRY_HOST}/{item.registryName}
        </p>
      </div>

      <div className="space-y-4">
        <div className="flex gap-4 text-sm border-b border-border/80 pb-2">
          <button
            onClick={() => setView("preview")}
            className={cn(
              "uppercase tracking-wide text-[0.7rem] transition-colors",
              view === "preview" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
            aria-pressed={view === "preview"}
          >
            preview
          </button>
          <button
            onClick={() => setView("code")}
            className={cn(
              "uppercase tracking-wide text-[0.7rem] transition-colors",
              view === "code" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
            aria-pressed={view === "code"}
          >
            code
          </button>
        </div>

        <div className="border border-border/80 rounded-xl min-h-[400px] relative overflow-hidden bg-card">
          {view === "preview" ? (
            <div className="w-full p-8 space-y-4">
              {item.previewMode === "ephemeral-app" ? (
                <div
                  data-testid="component-preview-ephemeral-app"
                  className="rounded-2xl border border-border/80 bg-background px-4 py-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-2">
                      <p className="text-[0.65rem] uppercase tracking-[0.35em] text-muted-foreground">
                        ephemeral app
                      </p>
                      <p className="text-sm text-muted-foreground max-w-2xl">
                        {item.previewHint || "This preview runs against the current ephemeral Instant app for this visitor session."}
                      </p>
                      <div className="grid gap-2 font-mono text-[11px] text-muted-foreground md:grid-cols-2">
                        <div
                          data-testid="component-preview-app-status"
                          className="rounded border border-border/70 bg-card px-2 py-1"
                        >
                          status: {registrySession.status}
                        </div>
                        <div
                          data-testid="component-preview-app-id"
                          className="rounded border border-border/70 bg-card px-2 py-1"
                        >
                          appId: {registrySession.session?.appId || "-"}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => void registrySession.recreateSession()}
                      className="rounded-full border border-border px-4 py-2 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground disabled:opacity-50"
                      disabled={registrySession.status === "initializing"}
                    >
                      New app
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="flex justify-center w-full">
                {item.render()}
              </div>
            </div>
          ) : (
            <div className="relative h-full">
              <div className="absolute right-4 top-4 z-10">
                <CopyButton text={item.code} />
              </div>
              <div className="overflow-auto h-full">
                <SyntaxHighlighter
                  language="tsx"
                  style={isDark ? vscDarkPlus : vs}
                  customStyle={{
                    margin: 0,
                    padding: "2rem",
                    fontSize: "0.75rem",
                    lineHeight: "1.5",
                    fontFamily: "var(--font-mono), monospace",
                    background: "transparent"
                  }}
                  codeTagProps={{
                    style: {
                      fontFamily: "var(--font-mono), monospace"
                    }
                  }}
                  showLineNumbers={false}
                  wrapLines={true}
                  wrapLongLines={true}
                >
                  {item.code}
                </SyntaxHighlighter>
              </div>
            </div>
          )}
        </div>
      </div>

      {item.props && item.props.length > 0 && (
        <div className="space-y-4">
          <div className="text-[0.7rem] text-muted-foreground uppercase tracking-[0.5em]">api reference</div>
          <div className="border border-border/80 rounded-xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border/80 text-muted-foreground bg-muted/40 uppercase tracking-[0.3em] text-[0.6rem]">
                <tr>
                  <th className="p-3 font-normal">prop</th>
                  <th className="p-3 font-normal">type</th>
                  <th className="p-3 font-normal">default</th>
                  <th className="p-3 font-normal">description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/80">
                {item.props.map((prop) => (
                  <tr key={prop.name} className="group hover:bg-muted/60 transition-colors">
                    <td className="p-3 text-foreground font-mono text-xs">{prop.name}</td>
                    <td className="p-3 text-muted-foreground font-mono">{prop.type}</td>
                    <td className="p-3 text-muted-foreground">{prop.default || "-"}</td>
                    <td className="p-3 text-muted-foreground">{prop.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

