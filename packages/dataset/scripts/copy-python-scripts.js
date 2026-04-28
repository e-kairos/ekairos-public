import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const sourceDir = path.join(currentDir, "..", "src", "file", "scripts")
const destDir = path.join(currentDir, "..", "dist", "file", "scripts")

fs.mkdirSync(destDir, { recursive: true })

const files = fs.readdirSync(sourceDir)
let copiedCount = 0

files.forEach((file) => {
  if (!file.endsWith(".py")) return

  const sourcePath = path.join(sourceDir, file)
  const destPath = path.join(destDir, file)
  fs.copyFileSync(sourcePath, destPath)
  copiedCount++
  console.log(`Copied: ${file}`)
})

console.log(`Copied ${copiedCount} Python script(s) to dist/`)
