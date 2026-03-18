import Link from "next/link";
import { eventsDomainEntry } from "@/lib/domain-registry";

const coreSchemaEntities = [
  {
    table: "event_contexts",
    title: "Context is the aggregate root",
    summary:
      "Owns lifecycle state, durable metadata, the active execution pointer, and the item timeline for a single conversation/runtime lane.",
    highlights: [
      "status: open_idle | open_streaming | closed",
      "links: items, executions, currentExecution",
    ],
  },
  {
    table: "event_items",
    title: "Items are the durable product surface",
    summary:
      "Persisted user and assistant turns. Trigger and reaction items are what the product ultimately renders, while executions and steps provide the operational explanation behind them.",
    highlights: [
      "type: input | output",
      "status: stored | pending | completed",
      "links: context, execution",
    ],
  },
];

const schemaRelations = [
  {
    edge: "event_contexts -> items",
    detail: "`event_contexts` owns the durable timeline through its `items` relation.",
  },
  {
    edge: "event_contexts -> executions",
    detail: "Each context keeps its execution history and the current execution pointer.",
  },
  {
    edge: "event_executions -> trigger / reaction",
    detail:
      "Executions link two `event_items`: the triggering input and the reaction output being produced.",
  },
  {
    edge: "event_executions -> steps",
    detail:
      "`event_steps` split a single reaction into message/action units with their own status and stream pointer.",
  },
  {
    edge: "event_steps -> parts",
    detail: "`event_parts` persist the normalized output fragments hanging from the producing step.",
  },
  {
    edge: "event_steps -> $streams",
    detail: "`$streams` is the append-only live feed used to replay a running step before it is fully stored.",
  },
];

const operationalLayers = [
  {
    table: "event_executions",
    summary:
      "The runtime transaction around a trigger/reaction pair. It tells you which items belong to the same reaction loop.",
  },
  {
    table: "event_steps",
    summary:
      "The execution work log. Each step is a message or action unit and can point to a live stream while it is running.",
  },
  {
    table: "event_parts",
    summary:
      "Normalized persisted fragments for a step. This is what lets shared UI reconstruct the final event shape deterministically.",
  },
  {
    table: "$streams",
    summary:
      "Transient append-only bytes for live replay. Useful while the step is in flight, but subordinate to the stored domain records.",
  },
];

const engineNarrative = [
  {
    title: "1. Define the domain entrypoint",
    summary:
      "`createContext` declares the context key, narrative, actions, and the reactor that will emit the reaction.",
    detail: "This is where business identity lives before any UI or demo code gets involved.",
  },
  {
    title: "2. Persist the visible turn first",
    summary:
      "When a reaction starts, the engine stores the trigger item, creates the pending reaction item, and opens a linked execution under the same context.",
    detail:
      "That keeps `event_items` as the product-facing record while `event_executions` explains how the output is being generated.",
  },
  {
    title: "3. Fill in operational detail as the reactor runs",
    summary:
      "Steps, parts, and stream chunks are appended during execution so the UI can replay progress without inventing a provider-specific contract.",
    detail:
      "The shared registry surface consumes the canonical `reactor-event` and chunk model, then reconstructs the same current event from persisted data.",
  },
  {
    title: "4. Close on stored state, not on transport detail",
    summary:
      "Once the reaction completes, the final source of truth is the context plus its items and stored parts, not the raw transport payload that produced them.",
    detail:
      "That is why the domain page starts from schema and engine before talking about widgets.",
  },
];

const componentPriority = [
  {
    order: "01",
    title: "Context",
    href: "/docs/components/context",
    registryName: "context",
    summary:
      "The primary shell for `event_contexts`: status, timeline framing, scrolling, and the place where item history becomes a product surface.",
    emphasis: "Open here first when you need to represent a conversation or runtime lane.",
    tags: ["event_contexts", "aggregate shell", "timeline"],
  },
  {
    order: "02",
    title: "Message",
    href: "/docs/components/message",
    registryName: "message",
    summary:
      "The core renderer for `event_items`, covering the durable input/output records that the end user actually reads.",
    emphasis: "This is the UI expression of the trigger/reaction pair persisted by the engine.",
    tags: ["event_items", "input/output", "product-visible"],
  },
  {
    order: "03",
    title: "Event Steps",
    href: "/docs/components/event-steps",
    registryName: "ekairos-events-event-steps",
    summary:
      "Operational drill-down for `event_steps`, `event_parts`, and `$streams`, used when you need to explain how a visible item was produced.",
    emphasis: "Important, but intentionally subordinate to context and items in the domain narrative.",
    tags: ["event_steps", "$streams", "replay + trace"],
  },
  {
    order: "04",
    title: "Full Agent",
    href: "/docs/components/full-agent",
    registryName: "full-agent",
    summary:
      "Composed template that wires prompt, context, message, and runtime detail over the same `events` contract.",
    emphasis: "Reach for this once the domain primitives are already clear and accepted.",
    tags: ["template", "composed surface", "reactor-ready"],
  },
];

const installCommands = [
  `pnpm add ${eventsDomainEntry.schemaPackage}`,
  "pnpm dlx shadcn@latest add https://registry.ekairos.dev/r/ekairos-events-event-steps.json",
];

const engineExports = [
  "createContext",
  "ContextEngine",
  "createScriptedReactor",
  "createAiSdkReactor",
];

export default function EventsDomainPage() {
  return (
    <article className="space-y-8 text-foreground">
      <header className="space-y-4">
        <p className="text-[0.7rem] uppercase tracking-[0.4em] text-muted-foreground">
          Domain
        </p>
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{eventsDomainEntry.title}</h1>
        <p className="max-w-4xl text-sm leading-6 text-muted-foreground md:text-[15px]">
          {eventsDomainEntry.summary} In practice, the narrative starts with the schema pair that
          matters most: `event_contexts` as the aggregate root and `event_items` as the durable
          user/assistant surface. Executions, steps, parts, and chunks exist to support and explain
          those records.
        </p>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-border/80 bg-card px-4 py-4">
            <p className="text-[0.65rem] uppercase tracking-[0.28em] text-muted-foreground">
              Aggregate root
            </p>
            <p className="mt-2 font-mono text-sm text-foreground">event_contexts</p>
          </div>
          <div className="rounded-2xl border border-border/80 bg-card px-4 py-4">
            <p className="text-[0.65rem] uppercase tracking-[0.28em] text-muted-foreground">
              Durable surface
            </p>
            <p className="mt-2 font-mono text-sm text-foreground">event_items</p>
          </div>
          <div className="rounded-2xl border border-border/80 bg-card px-4 py-4">
            <p className="text-[0.65rem] uppercase tracking-[0.28em] text-muted-foreground">
              Package
            </p>
            <p className="mt-2 font-mono text-sm text-foreground">{eventsDomainEntry.schemaPackage}</p>
          </div>
        </div>

        <div className="overflow-hidden rounded-[24px] border border-border/80 bg-card">
          <div className="border-b border-border/80 bg-muted/30 px-4 py-4">
            <p className="text-[0.7rem] uppercase tracking-[0.35em] text-muted-foreground">
              Schema-first narrative
            </p>
            <h2 className="mt-1.5 text-xl font-semibold tracking-tight md:text-2xl">
              `event_contexts` owns state. `event_items` owns the product-facing history.
            </h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-muted-foreground">
              The rest of the domain is operational depth. `event_executions` ties a trigger item
              to the reaction item being produced, `event_steps` slices that work into units,
              `event_parts` persists normalized output, and `$streams` gives live replay while the
              step is still running.
            </p>
          </div>

          <div className="grid gap-3 px-4 py-4 md:grid-cols-2">
            {coreSchemaEntities.map((entity) => (
              <div
                key={entity.table}
                className="rounded-2xl border border-border/80 bg-background px-3.5 py-3.5"
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-base font-medium md:text-lg">{entity.title}</h3>
                  <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                    {entity.table}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{entity.summary}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {entity.highlights.map((highlight) => (
                    <span
                      key={highlight}
                      className="rounded-full border border-border/70 bg-card px-2.5 py-1 text-[11px] text-muted-foreground"
                    >
                      {highlight}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </header>

      <section className="space-y-4">
        <div>
          <p className="text-[0.7rem] uppercase tracking-[0.4em] text-muted-foreground">
            Schema
          </p>
          <h2 className="text-xl font-semibold tracking-tight md:text-2xl">
            Start from the graph, not from the widget shelf
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            The schema tells the story. Contexts own timelines, items are the durable turns, and
            the runtime entities exist to explain how those items came into being.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <div className="space-y-3 rounded-[24px] border border-border/80 bg-card p-4">
            <p className="text-[0.7rem] uppercase tracking-[0.35em] text-muted-foreground">
              Core relations
            </p>
            <div className="space-y-3">
              {schemaRelations.map((relation) => (
                <div
                  key={relation.edge}
                  className="rounded-2xl border border-border/70 bg-background px-3.5 py-3"
                >
                  <p className="font-mono text-[11px] text-foreground">{relation.edge}</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{relation.detail}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3 rounded-[24px] border border-border/80 bg-card p-4">
            <p className="text-[0.7rem] uppercase tracking-[0.35em] text-muted-foreground">
              Operational layers
            </p>
            <div className="space-y-3">
              {operationalLayers.map((layer) => (
                <div
                  key={layer.table}
                  className="rounded-2xl border border-border/70 bg-background px-3.5 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">{layer.table}</p>
                    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      support
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{layer.summary}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <p className="text-[0.7rem] uppercase tracking-[0.4em] text-muted-foreground">
            Context Engine
          </p>
          <h2 className="text-xl font-semibold tracking-tight md:text-2xl">
            The engine makes the schema behave like a product loop
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            `@ekairos/events` is not only a set of entities. The context engine is the layer that
            turns those entities into a repeatable runtime: define a context, persist the visible
            turn, stream execution detail, and close on durable state.
          </p>
        </div>

        <div className="space-y-4 rounded-[24px] border border-border/80 bg-card p-4">
          <div className="rounded-2xl border border-border/70 bg-background px-3.5 py-3.5">
            <p className="text-[0.7rem] uppercase tracking-[0.35em] text-muted-foreground">
              Public entrypoints
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {engineExports.map((exportName) => (
                <span
                  key={exportName}
                  className="rounded-full border border-border/70 bg-card px-2.5 py-1 font-mono text-[11px] text-muted-foreground"
                >
                  {exportName}
                </span>
              ))}
            </div>
            <div className="mt-4 rounded-xl border border-border/70 bg-card px-3 py-3 font-mono text-[11px] text-muted-foreground">
              {`import { createContext, ContextEngine, createScriptedReactor, createAiSdkReactor } from "${eventsDomainEntry.schemaPackage}"`}
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            {engineNarrative.map((step) => (
              <div
                key={step.title}
                className="rounded-2xl border border-border/70 bg-background px-3.5 py-3.5"
              >
                <p className="text-sm font-medium">{step.title}</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.summary}</p>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{step.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <p className="text-[0.7rem] uppercase tracking-[0.4em] text-muted-foreground">
            Components
          </p>
          <h2 className="text-xl font-semibold tracking-tight md:text-2xl">
            Components ordered by domain importance
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            The installable surface should follow the same narrative as the schema. Start with the
            context container, then the item renderer, then the operational drill-down components.
          </p>
        </div>

        <div className="rounded-[24px] border border-border/80 bg-card p-4">
          <p className="text-[0.7rem] uppercase tracking-[0.35em] text-muted-foreground">
            Install
          </p>
          <div className="mt-4 space-y-3">
            {installCommands.map((command) => (
              <div
                key={command}
                className="rounded-xl border border-border/70 bg-background px-3 py-3 font-mono text-[11px] text-foreground"
              >
                {command}
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-3 xl:grid-cols-2">
          {componentPriority.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-[24px] border border-border/80 bg-card px-4 py-4 transition-colors hover:bg-muted/40"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="rounded-full border border-border px-3 py-1 font-mono text-[11px] text-muted-foreground">
                    {item.order}
                  </span>
                  <div>
                    <h3 className="text-lg font-semibold tracking-tight">{item.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {item.summary}
                    </p>
                  </div>
                </div>
                <span className="rounded-full border border-border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  {item.registryName}
                </span>
              </div>

              <div className="mt-3 rounded-2xl border border-border/70 bg-background px-3.5 py-3">
                <p className="text-[0.7rem] uppercase tracking-[0.28em] text-muted-foreground">
                  Why this rank
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.emphasis}</p>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {item.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-border/70 bg-background px-2.5 py-1 text-[11px] text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <p className="text-[0.7rem] uppercase tracking-[0.4em] text-muted-foreground">
            Demos
          </p>
          <h2 className="text-xl font-semibold tracking-tight md:text-2xl">Reactor variants under one domain</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Scripted, AI SDK, and Codex all land on the same `events` schema and the same shared
            UI. The reactor changes; the domain contract does not.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {eventsDomainEntry.demos.map((demo) => (
            <Link
              key={demo.href}
              href={demo.href}
              className="rounded-xl border border-border/80 bg-card px-3.5 py-3.5 transition-colors hover:bg-muted/40"
            >
              <p className="text-[0.65rem] uppercase tracking-[0.28em] text-muted-foreground">
                demo
              </p>
              <h3 className="mt-1.5 text-lg font-medium">{demo.label}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{demo.description}</p>
            </Link>
          ))}
        </div>
      </section>
    </article>
  );
}
