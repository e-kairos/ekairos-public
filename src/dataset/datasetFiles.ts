export const DATASET_OUTPUT_FILE_NAME = "output.jsonl"

export function getDatasetWorkstation(datasetId: string): string
{
    return `/vercel/sandbox/datasets/${datasetId}`
}

export function getDatasetOutputPath(datasetId: string): string
{
    return `${getDatasetWorkstation(datasetId)}/${DATASET_OUTPUT_FILE_NAME}`
}
