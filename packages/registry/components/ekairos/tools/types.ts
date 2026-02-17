import type { ComponentType } from "react"

export type ToolComponentMeta = {
  title: string
}

export type ToolComponentProps<Input = any, Output = any> = {
  input?: Input
  output?: Output
  state?: "input-streaming" | "input-available" | "output-available" | "output-error"
  errorText?: string
}

export type ToolComponentType<Input = any, Output = any> = ComponentType<ToolComponentProps<Input, Output>> & { meta?: ToolComponentMeta }



