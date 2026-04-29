import type { ContextReactor } from "@ekairos/events"
import type { TransformSourcePreviewContext } from "./filepreview.js"

export type { TransformSourcePreviewContext } from "./filepreview.js"

export type TransformSandboxState = {
  initialized: boolean
  sourcePaths: Array<{ datasetId: string; path: string }>
}

export type TransformDatasetContext = {
  datasetId: string
  sourceDatasetIds: string[]
  outputSchema: any
  sandboxConfig: {
    sourcePaths: Array<{ datasetId: string; path: string }>
    outputPath: string
  }
  sourcePreviews?: Array<{ datasetId: string; preview: TransformSourcePreviewContext }>
  errors: string[]
  iterationCount: number
  instructions?: string
}

export type TransformDatasetAgentParams = {
  sourceDatasetIds?: string[]
  outputSchema?: any
  instructions?: string
  datasetId?: string
  model?: string
  sandboxId?: string
  reactor?: ContextReactor<any, any>
}

export type TransformDatasetRunOptions = {
  prompt?: string
  durable?: boolean
}

export type TransformDatasetResult = {
  id: string
  status?: string
  title?: string
  schema?: any
  analysis?: any
  calculatedTotalRows?: number
  actualGeneratedRowCount?: number
  createdAt?: number
  updatedAt?: number
}

export type TransformPromptContext = {
  datasetId: string
  sourceDatasetIds: string[]
  outputSchema: any
  sandboxConfig: {
    sourcePaths: Array<{ datasetId: string; path: string }>
    outputPath: string
  }
  sourcePreviews?: Array<{
    datasetId: string
    preview: {
      totalRows: number
      metadata?: {
        description: string
        script: string
        command: string
        stdout: string
        stderr: string
      }
      head?: {
        description: string
        script: string
        command: string
        stdout: string
        stderr: string
      }
    }
  }>
  errors: string[]
}
