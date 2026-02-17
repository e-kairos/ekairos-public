import React from "react"
import { X, Loader2 } from "lucide-react"
import { FileIcon } from "./file-icon"

export type PromptAttachment = {
  id: string
  name: string
  size?: string
  previewURL?: string
  url?: string
  type?: string
  status: "uploading" | "done" | "error"
}

function formatSize(bytes?: number): string | undefined {
  if (!bytes && bytes !== 0) { return undefined }
  const k = 1024
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  const sizes = ["B", "KB", "MB", "GB", "TB"]
  const value = (bytes / Math.pow(k, i)).toFixed(1)
  return `${value} ${sizes[i]}`
}

export function PromptFileChip({ file, onRemove }: { file: PromptAttachment; onRemove?: (id: string) => void }) {
  return (
    <div className={["inline-flex items-center gap-2 max-w-full px-2 py-1 mr-2 rounded-md border bg-muted/40 text-foreground"].join(" ")}> 
      {file.status === "uploading" ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : (
        <FileIcon name={file.name} type={file.type} className="h-4 w-4" />
      )}
      <span className="text-xs truncate max-w-[160px] text-foreground" title={file.name}>{file.name}</span>
      {file.size && <span className="text-xs text-muted-foreground">{file.size}</span>}
      {file.status === "error" && <span className="text-xs text-destructive">Error</span>}
      {onRemove && (
        <button type="button" className="ml-1 text-muted-foreground hover:text-foreground" onClick={() => onRemove(file.id)} aria-label="Remove file">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

export default PromptFileChip



