import React from "react"
import { X, Loader2, BarChart3 } from "lucide-react"
import { FileIcon } from "./file-icon"
import { cn } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { ChartEditAttachmentPayload } from "../events/context-agent/agent-prompt-bridge"

export type PromptAttachment = {
  id: string
  name: string
  size?: string
  previewURL?: string
  url?: string
  type?: string
  status: "uploading" | "done" | "error"
  /** Virtual attachment (e.g. chart edit context), not a file upload. */
  kind?: "file" | "chart-edit"
  chartPayload?: ChartEditAttachmentPayload
  /** e.g. jump to inline chart in the context */
  onPress?: () => void
}

function formatSize(bytes?: number): string | undefined {
  if (!bytes && bytes !== 0) { return undefined }
  const k = 1024
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  const sizes = ["B", "KB", "MB", "GB", "TB"]
  const value = (bytes / Math.pow(k, i)).toFixed(1)
  return `${value} ${sizes[i]}`
}

function FileNameTooltip({ name }: { name: string }) {
  return (
    <TooltipProvider delayDuration={260}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="max-w-[160px] truncate text-xs text-foreground">
            {name}
          </span>
        </TooltipTrigger>
        <TooltipContent>{name}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function PromptFileChip({ file, onRemove }: { file: PromptAttachment; onRemove?: (id: string) => void }) {
  const isChartEdit = file.kind === "chart-edit"
   const interactive = typeof file.onPress === "function"

  const mainClass = cn(
    "inline-flex min-w-0 max-w-full items-center gap-2 px-2.5 py-1.5 text-left",
    interactive && "cursor-pointer rounded-l-xl hover:bg-white/6 dark:hover:bg-white/8",
  )

  const mainBody = (
    <>
      {file.status === "uploading" ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
      ) : isChartEdit ? (
        <BarChart3 className="h-4 w-4 shrink-0 text-accent" aria-hidden />
      ) : (
        <FileIcon name={file.name} type={file.type} className="h-4 w-4 shrink-0" />
      )}
      <FileNameTooltip name={file.name} />
      {file.size ? <span className="shrink-0 text-xs text-muted-foreground">{file.size}</span> : null}
      {file.status === "error" ? <span className="text-xs text-destructive">Error</span> : null}
    </>
  )

  return (
    <div
      className={cn(
        "mr-2 inline-flex max-w-full items-center gap-0 rounded-xl border text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.05)]",
        isChartEdit
          ? "border-accent/35 bg-accent/10"
          : "border-border/65 bg-muted/45",
      )}
    >
      {interactive ? (
        <button
          type="button"
          className={mainClass}
          onClick={() => file.onPress?.()}
          aria-label={`${file.name} — ver en el hilo`}
        >
          {mainBody}
        </button>
      ) : (
        <div className={mainClass}>{mainBody}</div>
      )}
      {onRemove ? (
        <button
          type="button"
          className="rounded-r-xl px-1.5 py-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation()
            onRemove(file.id)
          }}
          aria-label="Quitar adjunto"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  )
}

export default PromptFileChip



