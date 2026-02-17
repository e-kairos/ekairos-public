import type { ReactNode } from "react"

export type PropDefinition = {
  name: string
  type: string
  default?: string
  description: string
}

export type RegistryItem = {
  id: string
  title: string
  subtitle: string
  category: "core" | "compound" | "template"
  props?: PropDefinition[]
  render: () => ReactNode
  code: string
  registryName: string
}


