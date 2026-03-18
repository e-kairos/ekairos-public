import Link from "next/link";

import { getRegistry } from "@/app/[component]/route";
import { reactorShowcases } from "@/lib/examples/reactors/registry";
import { domainRegistry } from "@/lib/domain-registry";

export const revalidate = 3600;

const HIDDEN_PREFIXES = ["ai-elements-", "ekairos-prompt-", "ekairos-tools-"];

const SECTION_LINKS = [
  {
    label: "Domains",
    href: "/docs/domains/events",
    description: "Start from the domain surface, schema, lifecycle, and demos.",
  },
  {
    label: "Components",
    href: "/docs/components/message",
    description: "Prompt, message, context, full-agent, and the current primitives.",
  },
  {
    label: "Examples",
    href: "/examples",
    description: "Live reactor showcases running over the ephemeral Instant app session.",
  },
] as const;

type LandingRegistryItem = {
  name: string;
  title?: string;
  description?: string;
  category?: string;
  categories?: string[];
};

function isPublicItem(item: LandingRegistryItem) {
  return !HIDDEN_PREFIXES.some((prefix) => item.name.startsWith(prefix));
}

function toTitle(item: LandingRegistryItem) {
  return item.title || item.name;
}

function getPrimaryCategory(item: LandingRegistryItem) {
  return item.category || item.categories?.[0] || "registry";
}

function summarizeCategory(item: LandingRegistryItem) {
  switch (getPrimaryCategory(item)) {
    case "core":
      return "Core";
    case "compound":
      return "Compound";
    case "template":
      return "Template";
    default:
      return getPrimaryCategory(item);
  }
}

function getDocsHighlights(items: LandingRegistryItem[]) {
  const byCategory = new Map<string, LandingRegistryItem[]>();
  for (const item of items) {
    const key = getPrimaryCategory(item);
    const bucket = byCategory.get(key) ?? [];
    bucket.push(item);
    byCategory.set(key, bucket);
  }

  return [
    {
      label: "Core",
      href: "/docs/components/message",
      count: byCategory.get("core")?.length ?? 0,
      summary: "Prompt, message, chain-of-thought, hook surface.",
    },
    {
      label: "Compound",
      href: "/docs/components/context",
      count: byCategory.get("compound")?.length ?? 0,
      summary: "Context shells, event views, and multi-part composites.",
    },
    {
      label: "Templates",
      href: "/docs/components/full-agent",
      count: byCategory.get("template")?.length ?? 0,
      summary: "Full-agent assemblies and higher-order product flows.",
    },
  ];
}

function getFeatured(items: LandingRegistryItem[]) {
  const featuredNames = [
    "full-agent",
    "prompt",
    "message",
    "chain-of-thought",
    "context",
    "use-context",
  ];

  const selected = featuredNames
    .map((name) => items.find((item) => item.name === name))
    .filter(Boolean) as LandingRegistryItem[];

  return selected.length > 0 ? selected : items.slice(0, 6);
}

function getRegistryPath(itemName: string) {
  return `/r/${itemName}.json`;
}

export default async function HomePage() {
  const registry = await getRegistry();
  const items = ((registry?.items ?? []) as LandingRegistryItem[])
    .filter(isPublicItem)
    .sort((a, b) => a.name.localeCompare(b.name));

  const featured = getFeatured(items);
  const docsHighlights = getDocsHighlights(items);
  const componentCount = items.length;
  const domainCount = domainRegistry.length;
  const exampleLinks = [
    ...reactorShowcases.map((showcase) => ({
      title: showcase.title,
      href: showcase.route,
      eyebrow: "Examples",
      description: showcase.description,
    })),
    {
      title: "Examples Index",
      href: "/examples",
      eyebrow: "Examples",
      description:
        "Browse the internal registry of runnable reactor showcases.",
    },
    {
      title: "Registry JSON",
      href: "/r/registry.json",
      eyebrow: "Distribution",
      description:
        "Consume the shadcn v4 registry directly from the generated `/r/*.json` endpoints.",
    },
  ];

  return (
    <main className="relative mx-auto w-full max-w-7xl px-4 py-8 md:px-6 md:py-10">
      <section className="relative overflow-hidden rounded-[28px] border border-border bg-card shadow-sm">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.1),transparent_35%),linear-gradient(135deg,rgba(255,255,255,0.04),transparent_48%,rgba(255,255,255,0.02))]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:28px_28px] opacity-30" />

        <div className="relative grid gap-8 px-6 py-8 md:px-8 md:py-10 xl:grid-cols-[minmax(0,1.1fr)_minmax(420px,0.9fr)]">
          <div className="max-w-3xl">
            <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
              Ekairos Registry
            </p>
            <h1 className="mt-4 max-w-4xl text-4xl font-semibold tracking-tight md:text-5xl xl:text-6xl">
              Context-aware UI blocks for AI products, docs, and runnable examples.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">
              The registry is now entered through the domain surface first. Start from
              `event_contexts` and `event_items`, then drill into the components and examples that
              render the same persisted runtime over the ephemeral Instant app provisioned for the
              current session.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              {SECTION_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="rounded-full border border-border bg-background px-4 py-2 text-sm transition-colors hover:bg-muted/50"
                >
                  {link.label}
                </Link>
              ))}
              <a
                href="/r/registry.json"
                className="rounded-full border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              >
                Registry JSON
              </a>
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  Public items
                </p>
                <p className="mt-2 text-2xl font-semibold">{componentCount}</p>
              </div>
              <div className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  Domains
                </p>
                <p className="mt-2 text-2xl font-semibold">{domainCount}</p>
              </div>
              <div className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  Live examples
                </p>
                <p className="mt-2 text-2xl font-semibold">{reactorShowcases.length}</p>
              </div>
            </div>
          </div>

          <div className="grid gap-4">
            <div className="overflow-hidden rounded-[24px] border border-border/80 bg-neutral-950 text-neutral-100 shadow-2xl">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                    <span className="h-2.5 w-2.5 rounded-full bg-yellow-400" />
                    <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
                  </div>
                  <span className="text-sm font-medium">Registry Surface</span>
                </div>
                <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-neutral-400">
                  docs / components / examples
                </span>
              </div>

              <div className="grid min-h-[420px] grid-cols-[220px_minmax(0,1fr)]">
                <div className="border-r border-white/10 bg-black/30 p-3">
                  <p className="px-2 text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                    Components
                  </p>
                  <div className="mt-3 space-y-1">
                    {featured.slice(0, 6).map((item, index) => (
                      <div
                        key={item.name}
                        className={`rounded-xl px-3 py-2 text-sm ${
                          index === 0
                            ? "bg-white text-black"
                            : "text-neutral-400 hover:bg-white/5 hover:text-neutral-100"
                        }`}
                      >
                        <div className="font-medium">{toTitle(item)}</div>
                        <div className="mt-1 text-[11px] uppercase tracking-[0.18em] opacity-70">
                          {summarizeCategory(item)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid content-start gap-4 p-4">
                  <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                        Domain-first docs
                      </p>
                      <h2 className="mt-2 text-xl font-semibold text-white">
                        Registry is a domain surface, not a flat UI shelf.
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-neutral-400">
                        Start from the `events` schema and the context engine around
                        `event_contexts` and `event_items`, then drill into components and demos
                        that share the same persistence model.
                      </p>
                      <div className="mt-4 rounded-xl border border-white/10 bg-black/30 px-3 py-2 font-mono text-[11px] text-neutral-300">
                        /docs/domains/events
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                        Current lanes
                      </p>
                      <div className="mt-3 space-y-3">
                        {docsHighlights.map((group) => (
                          <div key={group.label} className="rounded-xl border border-white/10 bg-black/20 px-3 py-3">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-sm font-medium text-white">{group.label}</span>
                              <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-neutral-400">
                                {group.count}
                              </span>
                            </div>
                            <p className="mt-2 text-sm text-neutral-400">{group.summary}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    {exampleLinks.map((example) => (
                      <Link
                        key={example.href}
                        href={example.href}
                        className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4 transition-colors hover:bg-white/5"
                      >
                        <p className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                          {example.eyebrow}
                        </p>
                        <h3 className="mt-2 text-base font-medium text-white">{example.title}</h3>
                        <p className="mt-2 text-sm leading-6 text-neutral-400">
                          {example.description}
                        </p>
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="rounded-[24px] border border-border bg-card p-5">
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            Docs
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight">
            Navigate the registry by product surface, not by raw file list.
          </h2>
          <div className="mt-5 space-y-3">
            {docsHighlights.map((group) => (
              <Link
                key={group.label}
                href={group.href}
                className="block rounded-2xl border border-border/70 bg-background px-4 py-4 transition-colors hover:bg-muted/40"
              >
                <div className="flex items-center justify-between gap-4">
                  <span className="text-base font-medium">{group.label}</span>
                  <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                    {group.count}
                  </span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{group.summary}</p>
              </Link>
            ))}
          </div>
        </div>

        <div className="rounded-[24px] border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                Components
              </p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight">
                What the registry already exposes
              </h2>
            </div>
            <Link
              href="/registry"
              className="rounded-full border border-border px-4 py-2 text-sm hover:bg-muted/50"
            >
              Browse all
            </Link>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {featured.map((item) => (
              <article
                key={item.name}
                className="rounded-2xl border border-border/70 bg-background p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                      {summarizeCategory(item)}
                    </p>
                    <h3 className="mt-2 text-lg font-medium">{toTitle(item)}</h3>
                  </div>
                  <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                    @{item.name}
                  </span>
                </div>
                <p className="mt-3 line-clamp-3 text-sm leading-6 text-muted-foreground">
                  {item.description}
                </p>
                <div className="mt-4 rounded-xl border border-border/70 bg-muted/30 px-3 py-2 font-mono text-[11px] text-muted-foreground">
                  {getRegistryPath(item.name)}
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <Link
                    href={`/docs/components/${item.name}`}
                    className="rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted/50"
                  >
                    Open docs
                  </Link>
                  <a
                    href={getRegistryPath(item.name)}
                    className="rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted/50"
                  >
                    JSON
                  </a>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-8 rounded-[24px] border border-border bg-card p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              Examples
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">
              Run the current registry against the ephemeral session app.
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-muted-foreground">
              The site provisions an ephemeral Instant app for the visitor session and uses it for
              demos. That means examples are not static mock cards: they are real flows over the
              current registry runtime.
            </p>
          </div>
          <div className="rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-muted-foreground">
            session-backed demos
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {exampleLinks.map((example) => (
            <Link
              key={example.href}
              href={example.href}
              className="rounded-2xl border border-border/70 bg-background px-4 py-4 transition-colors hover:bg-muted/40"
            >
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                {example.eyebrow}
              </p>
              <h3 className="mt-2 text-lg font-medium">{example.title}</h3>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {example.description}
              </p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
