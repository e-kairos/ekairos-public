import React from "react"
import {
  File as FileGeneric,
  FileText,
  FileSpreadsheet,
  FileImage,
  FileAudio,
  FileVideo,
  FileArchive,
} from "lucide-react"

export function FileIcon({ name, type, className }: { name?: string; type?: string; className?: string }) {
  const lowercaseName = (name || "").toLowerCase()
  const ext = lowercaseName.split(".").pop() || ""
  const lowercaseType = (type || "").toLowerCase()

  let Icon: React.ComponentType<{ className?: string }>
  let colorClass = "text-muted-foreground"

  if (lowercaseType.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) {
    Icon = FileImage
    colorClass = "text-blue-500"
  } else {
    if (lowercaseType.startsWith("audio/") || ["mp3", "wav", "m4a", "ogg"].includes(ext)) {
      Icon = FileAudio
      colorClass = "text-purple-500"
    } else {
      if (lowercaseType.startsWith("video/") || ["mp4", "mov", "webm", "mkv"].includes(ext)) {
        Icon = FileVideo
        colorClass = "text-indigo-500"
      } else {
        if (ext === "pdf" || lowercaseType === "application/pdf") {
          Icon = FileText
          colorClass = "text-red-500"
        } else {
          if (["xlsx", "xls", "csv"].includes(ext) || lowercaseType.includes("spreadsheet") || lowercaseType === "text/csv") {
            Icon = FileSpreadsheet
            colorClass = "text-green-600"
          } else {
            if (["doc", "docx"].includes(ext)) {
              Icon = FileText
              colorClass = "text-blue-600"
            } else {
              if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) {
                Icon = FileArchive
                colorClass = "text-amber-600"
              } else {
                Icon = FileGeneric
                colorClass = "text-muted-foreground"
              }
            }
          }
        }
      }
    }
  }

  const iconClassName = ["h-4 w-4", colorClass, className || ""].filter(Boolean).join(" ")
  return <Icon className={iconClassName} />
}

export default FileIcon





