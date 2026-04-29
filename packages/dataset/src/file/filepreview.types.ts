export type FilePreviewContext = {
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
  tail?: {
    description: string
    script: string
    command: string
    stdout: string
    stderr: string
  }
  mid?: {
    description: string
    script: string
    command: string
    stdout: string
    stderr: string
  }
}
