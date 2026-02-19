"use client";

import React from "react";

import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import type { RegistryItem } from "@/lib/registry-types";

const StaticFullAgentDemo = () => {
  return (
    <div className="relative mx-auto flex h-[600px] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl ring-1 ring-border">
      <div className="flex h-12 items-center justify-between border-b bg-muted/50 px-4">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-red-400/80" />
          <div className="h-3 w-3 rounded-full bg-yellow-400/80" />
          <div className="h-3 w-3 rounded-full bg-green-400/80" />
          <span className="ml-4 text-xs font-medium text-muted-foreground">
            Ekairos Agent Preview (Static)
          </span>
        </div>
        <span className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          No runtime
        </span>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto bg-muted/10 p-4 md:p-6">
        <Message from="assistant">
          <MessageContent variant="flat" className="bg-transparent px-0 py-0">
            <MessageResponse>
              This is a static preview of the full-agent layout. It does not
              connect to auth, DB, or backend routes.
            </MessageResponse>
          </MessageContent>
        </Message>
        <Message from="user">
          <MessageContent variant="contained" className="bg-primary text-primary-foreground">
            <MessageResponse>Can I still install this component with shadcn?</MessageResponse>
          </MessageContent>
        </Message>
        <Message from="assistant">
          <MessageContent variant="flat" className="bg-transparent px-0 py-0">
            <MessageResponse>
              Yes. Use the registry JSON endpoint and install command shown in
              docs. Runtime wiring stays in your app.
            </MessageResponse>
          </MessageContent>
        </Message>
      </div>

      <div className="border-t bg-background/95 p-4">
        <div className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          Prompt input and agent execution are intentionally disabled in the
          registry website.
        </div>
      </div>
    </div>
  );
};

export const fullAgentRegistryItem: RegistryItem = {
  id: "full-agent",
  registryName: "full-agent",
  title: "Full Agent Layout",
  subtitle: "Static composition preview without auth or database runtime.",
  category: "template",
  props: [],
  code: `"use client"

import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message"

export function FullAgentLayout() {
  return (
    <div className="h-[600px] w-full rounded-2xl border bg-background overflow-hidden shadow-2xl flex flex-col">
      <header className="h-12 border-b bg-muted/50 px-4 flex items-center">
        <span className="text-xs font-medium text-muted-foreground">Ekairos Agent Preview (Static)</span>
      </header>
      <main className="flex-1 overflow-y-auto p-6 space-y-4 bg-muted/10">
        <Message from="assistant">
          <MessageContent variant="flat" className="bg-transparent px-0 py-0">
            <MessageResponse>Static preview only. Wire runtime in your app.</MessageResponse>
          </MessageContent>
        </Message>
      </main>
      <footer className="border-t p-4 text-sm text-muted-foreground">
        Prompt input intentionally disabled in registry.
      </footer>
    </div>
  )
}
`,
  render: () => <StaticFullAgentDemo />,
};
