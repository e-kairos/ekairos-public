export type DomainRegistryComponentLink = {
  label: string;
  href: string;
  kind: "component" | "template";
};

export type DomainRegistryDemoLink = {
  label: string;
  href: string;
  description: string;
};

export type DomainRegistryEntry = {
  id: string;
  title: string;
  summary: string;
  href: string;
  schemaPackage: string;
  components: DomainRegistryComponentLink[];
  demos: DomainRegistryDemoLink[];
};

export const eventsDomainEntry: DomainRegistryEntry = {
  id: "events",
  title: "Events",
  summary:
    "Context-first domain where `event_contexts` anchor runtime state, `event_items` hold the durable turn history, and executions, steps, parts, and chunks explain how each item was produced.",
  href: "/docs/domains/events",
  schemaPackage: "@ekairos/events",
  components: [
    { label: "Context", href: "/docs/components/context", kind: "component" },
    { label: "Message", href: "/docs/components/message", kind: "component" },
    { label: "Event Steps", href: "/docs/components/event-steps", kind: "component" },
    { label: "Full Agent", href: "/docs/components/full-agent", kind: "template" },
  ],
  demos: [
    {
      label: "Scripted",
      href: "/docs/domains/events/demos/scripted",
      description: "Canonical `events` UI driven by a scripted reactor stream.",
    },
    {
      label: "AI SDK",
      href: "/docs/domains/events/demos/ai-sdk",
      description: "Canonical `events` UI driven by an AI SDK-shaped stream.",
    },
    {
      label: "Codex",
      href: "/docs/domains/events/demos/codex",
      description: "Canonical `events` UI driven by a Codex-shaped notification stream.",
    },
  ],
};

export const domainRegistry = [eventsDomainEntry];

export function getDomainById(id: string) {
  return domainRegistry.find((domain) => domain.id === id) ?? null;
}
