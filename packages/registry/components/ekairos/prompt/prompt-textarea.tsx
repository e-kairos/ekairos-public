import React, { KeyboardEventHandler, useEffect, useRef } from "react"
import { cn } from "@/lib/utils"

export type PromptTextareaProps = React.ComponentProps<"textarea"> & {
  minHeight?: number
  maxHeight?: number
}

export function PromptTextarea({
  className,
  placeholder = "Send a message...",
  minHeight = 52,
  maxHeight = 200,
  onChange,
  ...props
}: PromptTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) { return }
    el.style.height = "auto"
    const next = Math.min(el.scrollHeight, maxHeight)
    el.style.height = `${next}px`
  }, [props.value, maxHeight])

  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (e.key === "Enter") {
      if ((e as any).nativeEvent?.isComposing) {
        return
      }
      if (e.shiftKey) {
        return
      }
      e.preventDefault()
      const form = e.currentTarget.form
      if (form) {
        form.requestSubmit()
      }
    }
  }

  return (
    <textarea
      ref={ref}
      name="message"
      data-testid="chat-input"
      placeholder={placeholder}
      onChange={(e) => onChange?.(e)}
      onKeyDown={handleKeyDown}
      style={{ minHeight, maxHeight }}
      className={cn(
        "w-full resize-none bg-transparent px-4 py-3 text-sm focus:outline-none",
        "text-foreground placeholder:text-muted-foreground/70",
        "scrollbar-none",
        className
      )}
      {...props}
    />
  )
}

export default PromptTextarea
