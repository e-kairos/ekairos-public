import Link from "next/link";
import type { RegistryItem } from "shadcn/schema";

import { getRegistry } from "@/app/[component]/route";

export const revalidate = 3600;

const HIDDEN_PREFIXES = ["ai-elements-", "ekairos-prompt-", "ekairos-tools-"];

function isPublicItem(item: RegistryItem) {
  return !HIDDEN_PREFIXES.some((prefix) => item.name.startsWith(prefix));
}

function getInstallCommand(componentName: string) {
  return `npx shadcn@latest add @ekairos/${componentName}`;
}

function getFeatured(items: RegistryItem[]) {
  const featuredNames = [
    "agent",
    "prompt",
    "thread",
    "use-thread",
    "event",
    "voice-provider",
  ];
  const selected = featuredNames
    .map((name) => items.find((item) => item.name === name))
    .filter(Boolean) as RegistryItem[];

  return selected.length > 0 ? selected : items.slice(0, 6);
}

export default async function HomePage() {
  const registry = await getRegistry();
  const items = ((registry?.items ?? []) as RegistryItem[])
    .filter(isPublicItem)
    .sort((a, b) => a.name.localeCompare(b.name));

  const featured = getFeatured(items);

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-8 md:px-8 md:py-10">
      <header className="border-b border-border pb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              Ekairos UI Registry
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">
              Component showcase for product designers
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground md:text-base">
              Explore real interface patterns, validate behavior in demo, and hand off implementation with
              ready install commands.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="rounded-full border border-border px-3 py-1 text-muted-foreground">
              {items.length} components
            </span>
            <Link
              href="/demo"
              className="rounded-full border border-border px-3 py-1 hover:bg-muted/50"
            >
              Open demo
            </Link>
          </div>
        </div>
      </header>

      <section className="mt-7 grid gap-4 md:grid-cols-3">
        <article className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">1. Explore visual behavior</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Review components in context, not just snippets, to evaluate interaction quality.
          </p>
        </article>
        <article className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">2. Validate in demo</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Use the demo route to inspect states and flows before implementation decisions.
          </p>
        </article>
        <article className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">3. Handoff with command</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Copy install commands per component to move quickly from design to product code.
          </p>
        </article>
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Featured components</h2>
          <Link href="/registry" className="text-xs text-muted-foreground hover:text-foreground">
            Registry notes
          </Link>
        </div>

        {featured.length === 0 ? (
          <div className="rounded-xl border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
            No public components found.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {featured.map((item) => (
              <article key={item.name} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-base font-medium">{item.title}</h3>
                  <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                    @{item.name}
                  </span>
                </div>
                <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{item.description}</p>
                <pre className="mt-3 overflow-x-auto rounded-lg border border-border/70 bg-background px-3 py-2 font-mono text-[11px]">
                  {getInstallCommand(item.name)}
                </pre>
                <div className="mt-3 flex items-center gap-2">
                  <Link
                    href={`/docs/components/${item.name}`}
                    className="rounded-full border border-border px-3 py-1 text-xs hover:bg-muted/50"
                  >
                    Preview
                  </Link>
                  <a
                    href={`/${item.name}.json`}
                    className="rounded-full border border-border px-3 py-1 text-xs hover:bg-muted/50"
                  >
                    JSON
                  </a>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="mt-8 rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Implementation handoff
        </h2>
        <div className="mt-3 grid gap-2 font-mono text-xs md:grid-cols-2">
          <div className="rounded-lg border border-border/70 bg-background px-3 py-2">
            npx shadcn@latest add @ekairos/thread
          </div>
          <div className="rounded-lg border border-border/70 bg-background px-3 py-2">
            npx shadcn@latest add @ekairos/use-thread
          </div>
          <div className="rounded-lg border border-border/70 bg-background px-3 py-2">
            GET /registry.json
          </div>
          <div className="rounded-lg border border-border/70 bg-background px-3 py-2">
            /docs/components/{'{component}'}
          </div>
        </div>
      </section>
    </main>
  );
}
