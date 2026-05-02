"use client";

import React from "react";
import {
  Terminal,
  TerminalActions,
  TerminalContent,
  TerminalCopyButton,
  TerminalHeader,
  TerminalStatus,
  TerminalTitle,
} from "@/components/ai-elements/terminal";
import {
  DefaultEventStepRenderer,
  type EventStepRendererProps,
} from "@/components/ekairos/events/event-steps";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function getCommandExecutionParts(event: EventStepRendererProps["event"]) {
  const parts = Array.isArray(event?.content?.parts) ? event.content.parts : [];
  return parts
    .map((part) => asRecord(part))
    .filter((part) => asString(part.type) === "tool-commandExecution");
}

export function EventStepTerminalRenderer(props: EventStepRendererProps) {
  const commandParts = getCommandExecutionParts(props.event);
  const filteredEvent =
    props.event && Array.isArray(props.event.content?.parts)
      ? {
          ...props.event,
          content: {
            ...props.event.content,
            parts: props.event.content.parts.filter(
              (part) => asString(asRecord(part).type) !== "tool-commandExecution",
            ),
          },
        }
      : props.event;

  if (commandParts.length === 0) {
    return <DefaultEventStepRenderer {...props} />;
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-border/70 bg-background p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              Selected step
            </p>
            <p className="mt-1 text-sm font-medium">{props.step.stepId}</p>
          </div>
          <span className="font-mono text-[11px] text-muted-foreground">
            {props.step.kind || "message"}
          </span>
        </div>

        <div className="space-y-3">
          {commandParts.map((part, index) => {
            const input = asRecord(part.input);
            const output = asRecord(part.output);
            const command = asString(input.command) || "command";
            const outputText = asString(output.text);
            const isStreaming =
              asString(part.state) === "input-streaming" ||
              asString(part.state) === "input-available" ||
              asString(part.state) === "output-streaming";
            const statusText = asString(output.status) || (isStreaming ? "running" : "completed");

            return (
              <Terminal key={`${command}:${index}`} output={outputText} isStreaming={isStreaming}>
                <TerminalHeader className="px-3 py-2">
                  <TerminalTitle className="text-xs">{`$ ${command}`}</TerminalTitle>
                  <div className="flex items-center gap-2">
                    <TerminalStatus className="text-[11px]">{statusText}</TerminalStatus>
                    <TerminalActions>
                      <TerminalCopyButton className="size-6" />
                    </TerminalActions>
                  </div>
                </TerminalHeader>
                <TerminalContent className="max-h-56 px-3 py-2 text-[12px]" />
              </Terminal>
            );
          })}
        </div>
      </div>

      <DefaultEventStepRenderer {...props} event={filteredEvent} />
    </div>
  );
}

export default EventStepTerminalRenderer;
