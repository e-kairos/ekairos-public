"use client";

import { cn } from "@/lib/utils";

import type { ContextStepForUI } from "../../context";
import type { AgentClassNames } from "../types";
import { MessageParts } from "./message-parts";

type ContextStepListProps = {
  steps?: ContextStepForUI[];
  toolComponents?: Record<string, any>;
  classNames?: AgentClassNames;
  showReasoning?: boolean;
  showDebug?: boolean;
  className?: string;
};

function stepHookDebugProjection(step: ContextStepForUI) {
  return {
    step: {
      stepId: step.stepId,
      executionId: step.executionId,
      createdAt: step.createdAt,
      updatedAt: step.updatedAt,
      status: step.status,
      iteration: step.iteration,
    },
    parts: step.parts,
  };
}

function StepHookDebug({ step }: { step: ContextStepForUI }) {
  return (
    <details className="mt-2">
      <summary className="cursor-pointer list-none text-[11px] text-muted-foreground">
        hook debug
      </summary>
      <pre
        data-testid="context-step-debug"
        className="mt-2 max-h-80 overflow-auto rounded border bg-muted/30 p-3 text-[11px] leading-4 text-muted-foreground"
      >
        {JSON.stringify(stepHookDebugProjection(step), null, 2)}
      </pre>
    </details>
  );
}

function StepBody({
  step,
  toolComponents,
  classNames,
  showReasoning,
  showDebug,
}: {
  step: ContextStepForUI;
  toolComponents: Record<string, any>;
  classNames?: AgentClassNames;
  showReasoning: boolean;
  showDebug: boolean;
}) {
  const hasParts = step.parts.length > 0;
  if (!hasParts && !showDebug) return null;

  const isLive = step.status === "running";

  return (
    <div className="space-y-1.5">
      {hasParts ? (
        <MessageParts
          message={{
            id: `context-step:${step.stepId}`,
            role: "assistant",
            parts: step.parts,
            metadata: {
              stepId: step.stepId,
              executionId: step.executionId,
              status: step.status,
            },
          }}
          status={isLive ? "streaming" : "ready"}
          isLatest={isLive}
          toolComponents={toolComponents}
          classNames={classNames}
          showReasoning={showReasoning}
          surface="step"
        />
      ) : null}
      {showDebug ? <StepHookDebug step={step} /> : null}
    </div>
  );
}

export function ContextStepList({
  steps = [],
  toolComponents = {},
  classNames,
  showReasoning = true,
  showDebug = false,
  className,
}: ContextStepListProps) {
  const renderableSteps = steps.filter(
    (step) => step.parts.length > 0 || showDebug,
  );

  if (renderableSteps.length === 0) return null;

  return (
    <div className={cn("mt-3 space-y-2", className)}>
      {renderableSteps.map((step) => (
        <div key={step.stepId} data-testid="context-step" className="min-w-0">
          <StepBody
            step={step}
            toolComponents={toolComponents}
            classNames={classNames}
            showReasoning={showReasoning}
            showDebug={showDebug}
          />
        </div>
      ))}
    </div>
  );
}
