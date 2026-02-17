import React from "react"
import PromptTextarea from "@/components/ekairos/prompt/prompt-textarea"
import PromptWebButton from "@/components/ekairos/prompt/prompt-button-web"
import PromptReasoningButton from "@/components/ekairos/prompt/prompt-button-reasoning"
import PromptVoiceButton from "@/components/ekairos/prompt/prompt-button-voice"
import PromptSendButton from "@/components/ekairos/prompt/prompt-button-send"
import PromptAttachButton from "@/components/ekairos/prompt/prompt-button-attach"
import PromptFileChip, { type PromptAttachment } from "@/components/ekairos/prompt/prompt-file-chip"
import { cn } from "@/lib/utils"

type PromptProps = {
  value: string
  onChange: (value: string) => void
  onSubmit: (e: React.FormEvent) => void
  onToggleVoice?: () => void
  reasoningLevel?: "off" | "low" | "medium" | "high"
  onChangeReasoning?: (v: "off" | "low" | "medium" | "high") => void
  webSearch?: boolean
  onToggleWeb?: () => void
  status?: "idle" | "submitted" | "streaming" | "error"
  onFilesSelected?: (files: FileList) => void
  isUploading?: boolean
  attachments?: PromptAttachment[]
  onRemoveAttachment?: (id: string) => void
  className?: string
  placeholder?: string
  disabled?: boolean
  inputDisabled?: boolean
}

export function Prompt({
  value,
  onChange,
  onSubmit,
  onToggleVoice,
  reasoningLevel,
  onChangeReasoning,
  webSearch,
  onToggleWeb,
  status,
  onFilesSelected,
  isUploading,
  attachments,
  onRemoveAttachment,
  className,
  placeholder,
  disabled = false,
  inputDisabled,
}: PromptProps) {
  const normalizedValue = typeof value === "string" ? value : String(value ?? "")
  const isDirty = normalizedValue.trim().length > 0
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const isBusy = status === "submitted" || status === "streaming"
  const controlsDisabled = disabled || isBusy
  const textareaDisabled = inputDisabled ?? controlsDisabled
  const handleTextareaChange = React.useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange?.(event.target.value ?? "")
    },
    [onChange],
  )

  function handleAttachClick() {
    fileInputRef.current?.click()
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (files && onFilesSelected) {
      onFilesSelected(files)
      e.currentTarget.value = ""
    }
  }

  return (
    <form 
      onSubmit={onSubmit} 
      className={cn("relative flex flex-col w-full max-w-3xl mx-auto", className)}
    >
      <div className={cn(
        "relative flex flex-col w-full overflow-hidden transition-all",
        "rounded-2xl border bg-background shadow-sm ring-offset-background",
        "focus-within:ring-2 focus-within:ring-ring/10 focus-within:border-ring/20"
      )}>
        
        {/* File Attachments Area */}
        {Array.isArray(attachments) && attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 p-3 border-b bg-muted/20">
            {attachments.map((f) => (
              <PromptFileChip key={f.id} file={f} onRemove={onRemoveAttachment} />
            ))}
          </div>
        )}
        
        {/* Text Area */}
        <PromptTextarea 
          value={normalizedValue} 
          onChange={handleTextareaChange} 
          disabled={textareaDisabled}
          placeholder={placeholder}
          className="min-h-[60px] px-4 py-3 text-sm"
        />
        
        {/* Toolbar */}
        <div className="flex items-center justify-between p-2 pl-3 bg-transparent"> 
          <div className="flex items-center gap-0.5">
            <input ref={fileInputRef} type="file" className="hidden" multiple onChange={handleFileChange} disabled={controlsDisabled} />
            <PromptAttachButton onClick={handleAttachClick} disabled={controlsDisabled} />
            <PromptWebButton active={Boolean(webSearch)} onToggle={onToggleWeb} disabled={controlsDisabled} />
            <PromptReasoningButton value={reasoningLevel} onChange={onChangeReasoning} disabled={controlsDisabled} />
          </div>
          
          <div className="flex items-center gap-2">
            {onToggleVoice && <PromptVoiceButton onClick={onToggleVoice} disabled={controlsDisabled} />}
            <PromptSendButton disabled={controlsDisabled || !isDirty || Boolean(isUploading)} status={status} />
          </div>
        </div>
      </div>
      
    </form>
  )
}
