import React from "react"
import PromptTextarea from "@/components/ekairos/prompt/prompt-textarea"
import PromptWebButton from "@/components/ekairos/prompt/prompt-button-web"
import PromptReasoningButton from "@/components/ekairos/prompt/prompt-button-reasoning"
import PromptVoiceButton from "@/components/ekairos/prompt/prompt-button-voice"
import PromptSendButton from "@/components/ekairos/prompt/prompt-button-send"
import PromptAttachButton from "@/components/ekairos/prompt/prompt-button-attach"
import PromptFileChip, { type PromptAttachment } from "@/components/ekairos/prompt/prompt-file-chip"
import { cn } from "@/lib/utils"

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
}: {
  value: string
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
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
}) {
  const isDirty = (value || "").trim().length > 0
  const fileInputRef = React.useRef<HTMLInputElement>(null)
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
    <form onSubmit={onSubmit} className="mt-2">
      <div className="border rounded-2xl overflow-hidden bg-white dark:bg-background">
        {Array.isArray(attachments) && attachments.length > 0 && (
          <div className="flex flex-wrap items-center px-3 pt-2 pb-1 gap-1">
            {attachments.map((f) => (
              <PromptFileChip key={f.id} file={f} onRemove={onRemoveAttachment} />
            ))}
          </div>
        )}
        <PromptTextarea value={value} onChange={onChange} />
        <div className={cn("flex items-center justify-between gap-2 px-4 py-4")}> 
          <div className="flex items-center gap-2">
            <PromptWebButton active={Boolean(webSearch)} onToggle={onToggleWeb} />
            <PromptReasoningButton value={reasoningLevel} onChange={onChangeReasoning as any} />
          </div>
          <div className="flex items-center gap-2">
            <input ref={fileInputRef} type="file" className="hidden" multiple onChange={handleFileChange} />
            <PromptAttachButton onClick={handleAttachClick} />
            {onToggleVoice && <PromptVoiceButton onClick={onToggleVoice} />}
            <PromptSendButton disabled={!isDirty || Boolean(isUploading)} status={status} />
          </div>
        </div>
      </div>
    </form>
  )
}



