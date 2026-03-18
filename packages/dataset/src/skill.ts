import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

export type DatasetSkillPackageFile = {
  path: string
  contentBase64: string
}

export type DatasetSkillPackage = {
  name: string
  description?: string
  files: DatasetSkillPackageFile[]
}

function walkFiles(rootDir: string, currentDir = rootDir): string[] {
  const entries = readdirSync(currentDir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const absPath = path.join(currentDir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkFiles(rootDir, absPath))
      continue
    }
    if (entry.isFile()) {
      files.push(path.relative(rootDir, absPath).replace(/\\/g, "/"))
    }
  }
  return files
}

function resolveDatasetSkillRoot(): string {
  const fromDist = path.resolve(__dirname, "..", "skill")
  if (statExists(fromDist)) return fromDist
  const fromSrc = path.resolve(__dirname, "..", "..", "skill")
  if (statExists(fromSrc)) return fromSrc
  throw new Error("dataset_skill_root_not_found")
}

function statExists(candidate: string): boolean {
  try {
    return statSync(candidate).isDirectory()
  } catch {
    return false
  }
}

export function buildDatasetSkillPackage(): DatasetSkillPackage {
  const skillRoot = resolveDatasetSkillRoot()
  const files = walkFiles(skillRoot).map((relativePath) => ({
    path: relativePath,
    contentBase64: readFileSync(path.join(skillRoot, relativePath)).toString("base64"),
  }))

  return {
    name: "dataset",
    description: "Materialize and persist datasets using the Ekairos runtime manifest.",
    files,
  }
}
