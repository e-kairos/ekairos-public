export const DATASET_OUTPUT_FILE_NAME = "output.jsonl"
export const DATASET_OUTPUT_SCHEMA_FILE_NAME = "output_schema.json"

export const DEFAULT_DAYTONA_VOLUME_MOUNT_PATH = "/home/daytona/.ekairos"
export const DEFAULT_DAYTONA_VOLUME_NAME = "ekairos-structure"
export const DEFAULT_DATASET_WORKDIR_BASE = `${DEFAULT_DAYTONA_VOLUME_MOUNT_PATH}/datasets`

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value
}

export function getDaytonaVolumeMountPath(): string {
  const fromEnv = String(process.env.STRUCTURE_DAYTONA_VOLUME_MOUNT_PATH ?? "").trim()
  if (fromEnv) return trimTrailingSlash(fromEnv)
  return DEFAULT_DAYTONA_VOLUME_MOUNT_PATH
}

export function getDaytonaVolumeName(): string {
  const fromEnv = String(process.env.STRUCTURE_DAYTONA_VOLUME_NAME ?? "").trim()
  if (fromEnv) return fromEnv
  return DEFAULT_DAYTONA_VOLUME_NAME
}

export function getDatasetWorkdirBase(): string {
  const fromEnv = String(process.env.STRUCTURE_SANDBOX_WORKDIR_BASE ?? "").trim()
  if (fromEnv) return trimTrailingSlash(fromEnv)
  return `${getDaytonaVolumeMountPath()}/datasets`
}

export function getDatasetWorkstation(datasetId: string): string {
  return `${getDatasetWorkdirBase()}/${datasetId}`
}

export function getDatasetOutputPath(datasetId: string): string {
  return `${getDatasetWorkstation(datasetId)}/${DATASET_OUTPUT_FILE_NAME}`
}

export function getDatasetOutputSchemaPath(datasetId: string): string {
  return `${getDatasetWorkstation(datasetId)}/${DATASET_OUTPUT_SCHEMA_FILE_NAME}`
}

