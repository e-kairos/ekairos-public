export const DATASET_OUTPUT_FILE_NAME = "output.jsonl"

const DEFAULT_VERCEL_WORKDIR_BASE = "/vercel/sandbox/datasets"
const DEFAULT_DAYTONA_WORKDIR_BASE = "/home/daytona/.ekairos/datasets"
const DEFAULT_SPRITES_WORKDIR_BASE = "/workspace/.ekairos/datasets"

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value
}

export function getDatasetWorkdirBase(): string {
  const explicit = String(process.env.DATASET_SANDBOX_WORKDIR_BASE ?? "").trim()
  if (explicit) return trimTrailingSlash(explicit)

  const provider = String(process.env.SANDBOX_PROVIDER ?? "").trim().toLowerCase()
  if (provider === "daytona") return DEFAULT_DAYTONA_WORKDIR_BASE
  if (provider === "vercel") return DEFAULT_VERCEL_WORKDIR_BASE
  if (provider === "sprites") return DEFAULT_SPRITES_WORKDIR_BASE
  return DEFAULT_VERCEL_WORKDIR_BASE
}

export function getDatasetWorkstation(datasetId: string): string {
  return `${getDatasetWorkdirBase()}/${datasetId}`
}

export function getDatasetOutputPath(datasetId: string): string {
  return `${getDatasetWorkstation(datasetId)}/${DATASET_OUTPUT_FILE_NAME}`
}
