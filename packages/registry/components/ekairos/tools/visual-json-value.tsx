"use client";

import type { JsonValue } from "@visual-json/core";
import { SearchBar, TreeView, VisualJson } from "@visual-json/react";
import { useMemo, type CSSProperties } from "react";

import { cn } from "@/lib/utils";

const VISUAL_JSON_THEME = {
  "--vj-bg": "hsl(var(--background))",
  "--vj-bg-panel": "hsl(var(--muted) / 0.35)",
  "--vj-bg-hover": "hsl(var(--muted) / 0.65)",
  "--vj-bg-selected": "hsl(var(--primary) / 0.14)",
  "--vj-bg-selected-muted": "hsl(var(--muted) / 0.8)",
  "--vj-bg-match": "hsl(var(--primary) / 0.12)",
  "--vj-bg-match-active": "hsl(var(--primary) / 0.22)",
  "--vj-border": "hsl(var(--border))",
  "--vj-border-subtle": "hsl(var(--border) / 0.65)",
  "--vj-text": "hsl(var(--foreground))",
  "--vj-text-muted": "hsl(var(--muted-foreground))",
  "--vj-text-dim": "hsl(var(--muted-foreground) / 0.78)",
  "--vj-text-dimmer": "hsl(var(--muted-foreground) / 0.58)",
  "--vj-string": "#0f766e",
  "--vj-number": "#2563eb",
  "--vj-boolean": "#7c3aed",
  "--vj-accent": "hsl(var(--primary))",
  "--vj-accent-muted": "hsl(var(--primary) / 0.16)",
  "--vj-input-bg": "hsl(var(--background))",
  "--vj-input-border": "hsl(var(--border))",
  "--vj-error": "hsl(var(--destructive))",
  "--vj-font":
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  "--vj-input-font-size": "12px",
} as CSSProperties;

function maybeParseJsonString(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed || !["{", "["].includes(trimmed[0] ?? "")) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

export function toVisualJsonValue(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): JsonValue {
  const parsed =
    typeof value === "string" ? maybeParseJsonString(value) : value;

  if (parsed === null || parsed === undefined) return null;

  if (typeof parsed === "string" || typeof parsed === "boolean") {
    return parsed;
  }

  if (typeof parsed === "number") {
    return Number.isFinite(parsed) ? parsed : String(parsed);
  }

  if (typeof parsed === "bigint" || typeof parsed === "symbol") {
    return String(parsed);
  }

  if (typeof parsed === "function") {
    return "[Function]";
  }

  if (parsed instanceof Date) {
    return parsed.toISOString();
  }

  if (Array.isArray(parsed)) {
    return parsed.map((item) => toVisualJsonValue(item, seen));
  }

  if (typeof parsed === "object") {
    if (seen.has(parsed)) {
      return "[Circular]";
    }

    seen.add(parsed);

    const output: Record<string, JsonValue> = {};
    for (const [key, child] of Object.entries(parsed)) {
      output[key] = toVisualJsonValue(child, seen);
    }

    seen.delete(parsed);
    return output;
  }

  return String(parsed);
}

export type VisualJsonValueProps = {
  value: unknown;
  className?: string;
  height?: number | string;
  showSearch?: boolean;
};

export function VisualJsonValue({
  value,
  className,
  height = 260,
  showSearch = true,
}: VisualJsonValueProps) {
  const json = useMemo(() => toVisualJsonValue(value), [value]);
  const resolvedHeight = typeof height === "number" ? `${height}px` : height;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border border-border/60 bg-background",
        className,
      )}
      style={VISUAL_JSON_THEME}
    >
      <VisualJson value={json}>
        <div
          className="flex min-h-0 flex-col overflow-hidden"
          style={{ height: resolvedHeight }}
        >
          {showSearch ? <SearchBar /> : null}
          <div
            className="min-h-0 flex-1 overflow-auto"
            onContextMenuCapture={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onDragStartCapture={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onDropCapture={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onKeyDownCapture={(event) => {
              if (
                event.key === "Backspace" ||
                event.key === "Delete" ||
                ((event.metaKey || event.ctrlKey) &&
                  event.key.toLowerCase() === "z")
              ) {
                event.preventDefault();
                event.stopPropagation();
              }
            }}
          >
            <TreeView showValues showCounts />
          </div>
        </div>
      </VisualJson>
    </div>
  );
}
