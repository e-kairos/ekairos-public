import type { ReactorShowcaseDefinition } from "@/lib/examples/reactors/types";

export const codexReactorShowcase: ReactorShowcaseDefinition = {
  id: "reactor-showcase.codex.live",
  slug: "codex",
  title: "Codex Live Showcase",
  description:
    "Run the real Codex reactor against the current ephemeral Instant app and inspect persisted context output, metadata, and trace.",
  reactorType: "codex",
  mode: "live",
  route: "/examples/codex",
  initialPrompt: "Inspect README.md and summarize the key points.",
  api: {
    runPath: "/api/examples/reactors/codex/run",
    entitiesPath: "/api/examples/reactors/codex/entities",
  },
};
