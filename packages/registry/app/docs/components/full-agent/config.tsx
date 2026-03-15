"use client";

import React, { useState } from "react";

import type { RegistryItem } from "@/lib/registry-types";
import { MessageList } from "@/components/ekairos/agent/ui/message-list";
import { Button } from "@/components/ui/button";
import { useScriptedCodexContext } from "@/components/ekairos/agent/mocks/use-scripted-codex-context";

function ScriptedCodexAgentDemo() {
  const context = useScriptedCodexContext();
  const [prompt, setPrompt] = useState(
    "Inspect README.md and reply with a short summary of what it contains.",
  );

  const isRunning =
    context.contextStatus === "streaming" || context.sendStatus === "submitting";

  return (
    <div className="relative mx-auto flex h-[680px] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl ring-1 ring-border">
      <div className="flex h-12 items-center justify-between border-b bg-muted/40 px-4">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Codex Agent
          </span>
          <span className="text-xs text-muted-foreground">{context.title}</span>
        </div>
        <span className="text-[11px] text-muted-foreground">
          context: {context.contextId}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto bg-muted/5 p-4 md:p-6">
        <MessageList
          context={context}
          toolComponents={{}}
          showReasoning
        />
      </div>

      <div className="space-y-3 border-t bg-background/95 p-4">
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          className="min-h-[88px] w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            Emits real-shaped <code>codex-event</code> parts from a captured
            local Codex run fixture.
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={context.reset}
              disabled={isRunning}
            >
              Reset
            </Button>
            <Button
              variant="outline"
              onClick={context.stop}
              disabled={!isRunning}
            >
              Stop
            </Button>
            <Button
              onClick={async () => {
                await context.append({
                  parts: [{ type: "text", text: prompt }],
                  reasoningLevel: "low",
                  webSearch: false,
                });
              }}
              disabled={isRunning || !prompt.trim()}
            >
              Run Codex Replay
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export const fullAgentRegistryItem: RegistryItem = {
  id: "full-agent",
  registryName: "full-agent",
  title: "Full Agent (Codex Replay)",
  subtitle:
    "Interactive coding-agent UI replaying captured Codex stream events via scripted context state.",
  category: "template",
  props: [],
  code: `"use client"

import { useState } from "react"
import { MessageList } from "@/components/ekairos/agent/ui/message-list"
import { useScriptedCodexContext } from "@/components/ekairos/agent/mocks/use-scripted-codex-context"
import { Button } from "@/components/ui/button"

export function FullAgentCodexReplay() {
  const context = useScriptedCodexContext()
  const [prompt, setPrompt] = useState("Inspect README.md and reply with a short summary.")
  const isRunning = context.contextStatus === "streaming" || context.sendStatus === "submitting"

  return (
    <div className="h-[680px] w-full max-w-4xl rounded-2xl border bg-background overflow-hidden flex flex-col">
      <div className="flex-1 overflow-y-auto p-6 bg-muted/5">
        <MessageList context={context} toolComponents={{}} showReasoning />
      </div>
      <div className="border-t p-4 space-y-3">
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} className="w-full min-h-[88px] rounded-xl border px-3 py-2 text-sm" />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={context.reset} disabled={isRunning}>Reset</Button>
          <Button variant="outline" onClick={context.stop} disabled={!isRunning}>Stop</Button>
          <Button
            onClick={() => context.append({ parts: [{ type: "text", text: prompt }] })}
            disabled={isRunning || !prompt.trim()}
          >
            Run Codex Replay
          </Button>
        </div>
      </div>
    </div>
  )
}
`,
  render: () => <ScriptedCodexAgentDemo />,
};
