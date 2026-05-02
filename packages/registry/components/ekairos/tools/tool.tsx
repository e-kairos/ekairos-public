"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { ToolUIPart } from "ai";
import type { ComponentProps } from "react";
import { VisualJsonValue } from "./visual-json-value";

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn(
      "not-prose mb-2 w-full overflow-hidden rounded-md border border-border/70 bg-background transition-colors hover:border-border",
      className,
    )}
    {...props}
  />
);

export type ToolHeaderProps = {
  type: ToolUIPart["type"];
  state: ToolUIPart["state"];
  className?: string;
  label?: string;
  summary?: string;
};

const getStatusLabel = (status: ToolUIPart["state"]) => {
  const labels: Record<string, string> = {
    "input-streaming": "Pendiente",
    "input-available": "Ejecutando",
    "output-available": "Completado",
    "output-error": "Error",
  } as const;

  return labels[status] ?? "";
};

const getStatusClassName = (status: ToolUIPart["state"]) => {
  if (status === "output-error") return "bg-destructive/10 text-destructive";
  if (status === "output-available") return "bg-emerald-50 text-emerald-700";
  return "bg-muted text-muted-foreground";
};

export const ToolHeader = ({
  className,
  type,
  state,
  label,
  summary,
  ...props
}: ToolHeaderProps) => (
  <CollapsibleTrigger
    className={cn(
      "flex min-h-10 w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted/30",
      className,
    )}
    {...props}
  >
    <div className="min-w-0">
      <div className="truncate text-sm font-medium leading-5">
        {label || (type as string)}
      </div>
      {summary && summary.trim().length > 0 && (
        <div className="truncate text-xs leading-4 text-muted-foreground">
          {summary}
        </div>
      )}
    </div>
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4",
        getStatusClassName(state),
      )}
    >
      {getStatusLabel(state)}
    </span>
  </CollapsibleTrigger>
);

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "border-t border-border/60 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:animate-in data-[state=open]:slide-in-from-top-2",
      className,
    )}
    {...props}
  />
);

export type ToolInputProps = ComponentProps<"div"> & {
  input: ToolUIPart["input"];
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
  <div className={cn("space-y-2 overflow-hidden p-3", className)} {...props}>
    <h4 className="text-xs font-medium uppercase text-muted-foreground">
      Detalles tecnicos (parametros)
    </h4>
    <VisualJsonValue value={input} height={220} />
  </div>
);

export type ToolOutputProps = ComponentProps<"div"> & {
  output?: ToolUIPart["output"];
  errorText?: ToolUIPart["errorText"];
};

export const ToolOutput = ({
  className,
  output,
  errorText,
  ...props
}: ToolOutputProps) => {
  if (output === undefined && !errorText) {
    return null;
  }

  return (
    <div className={cn("space-y-2 p-3", className)} {...props}>
      <h4 className="text-xs font-medium uppercase text-muted-foreground">
        {errorText ? "Error" : "Detalles tecnicos (resultado)"}
      </h4>
      {errorText ? (
        <div className="rounded bg-destructive/10 p-3 text-xs text-destructive">
          {errorText}
        </div>
      ) : (
        <VisualJsonValue value={output} height={260} />
      )}
    </div>
  );
};
