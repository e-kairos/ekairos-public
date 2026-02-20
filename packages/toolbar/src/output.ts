import type { OutputDetailLevel, ToolbarAnnotation } from "./types";

export function generateToolbarOutput(
  annotations: ToolbarAnnotation[],
  pagePath: string,
  detail: OutputDetailLevel = "standard",
): string {
  if (annotations.length === 0) return "";

  const viewport =
    typeof window !== "undefined"
      ? `${window.innerWidth}x${window.innerHeight}`
      : "unknown";
  let output = `## Toolbar Feedback: ${pagePath}\n`;
  output += `**Viewport:** ${viewport}\n\n`;

  annotations.forEach((annotation, index) => {
    if (detail === "compact") {
      output += `${index + 1}. ${annotation.element}: ${annotation.comment}\n`;
      return;
    }

    output += `### ${index + 1}. ${annotation.element}\n`;
    output += `- Feedback: ${annotation.comment}\n`;
    output += `- Path: ${annotation.elementPath}\n`;
    if (annotation.stableSelector) {
      output += `- Selector: \`${annotation.stableSelector}\`\n`;
    }
    if (annotation.selectedText) {
      output += `- Selected text: "${annotation.selectedText}"\n`;
    }

    if (detail === "detailed") {
      if (annotation.cssClasses) {
        output += `- Classes: ${annotation.cssClasses}\n`;
      }
      if (annotation.boundingBox) {
        output += `- Box: x=${Math.round(annotation.boundingBox.x)}, y=${Math.round(
          annotation.boundingBox.y,
        )}, w=${Math.round(annotation.boundingBox.width)}, h=${Math.round(
          annotation.boundingBox.height,
        )}\n`;
      }
      if (annotation.nearbyText) {
        output += `- Context: ${annotation.nearbyText.slice(0, 120)}\n`;
      }
    }

    output += "\n";
  });

  return output.trim();
}

