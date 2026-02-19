import Link from "next/link";
import type { RegistryItem } from "shadcn/schema";
import { getRegistry } from "@/app/[component]/route";

export const revalidate = 3600;

const HIDDEN_PREFIXES = ["ai-elements-", "ekairos-prompt-", "ekairos-tools-"];
const SHOWCASE_PRIORITY = [
  "agent",
  "prompt",
  "message",
  "full-agent",
  "chain-of-thought",
  "thread",
  "use-thread",
  "orb",
  "cost-simulator",
];

function isPublicItem(item: RegistryItem) {
  return !HIDDEN_PREFIXES.some((prefix) => item.name.startsWith(prefix));
}

function getShowcaseItems(items: RegistryItem[], max = 6) {
  const map = new Map(items.map((item) => [item.name, item]));
  const selected: RegistryItem[] = [];

  for (const key of SHOWCASE_PRIORITY) {
    const item = map.get(key);
    if (!item) continue;
    selected.push(item);
    if (selected.length >= max) return selected;
  }

  for (const item of items) {
    if (selected.length >= max) break;
    if (selected.some((selectedItem) => selectedItem.name === item.name)) continue;
    selected.push(item);
  }

  return selected;
}

function getInstallCommand(componentName: string) {
  return `npx shadcn@latest add @ekairos/${componentName}`;
}

export default async function HomePage() {
  const registry = await getRegistry();
  const allItems = (registry?.items ?? []) as RegistryItem[];
  const items = allItems.filter(isPublicItem);
  const showcase = getShowcaseItems(items, 6);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="fixed inset-0 -z-10 bg-[radial-gradient(circle_at_10%_10%,hsl(var(--foreground)/0.08),transparent_42%),radial-gradient(circle_at_88%_4%,hsl(var(--foreground)/0.06),transparent_36%),linear-gradient(to_bottom,hsl(var(--background)),hsl(var(--background)))]" />

      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-6 md:px-8">
        <div className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="h-2.5 w-2.5 rounded-full bg-foreground" />
          <span>Ekairos Registry</span>
        </div>
        <nav className="flex items-center gap-5 text-xs uppercase tracking-[0.2em] text-muted-foreground">
          <Link href="#showcase" className="hover:text-foreground transition-colors">
            Showcase
          </Link>
          <Link href="/demo" className="hover:text-foreground transition-colors">
            Demo
          </Link>
          <Link href="/docs/components/message" className="hover:text-foreground transition-colors">
            Docs
          </Link>
        </nav>
      </header>

      <section className="mx-auto w-full max-w-6xl px-5 pb-10 pt-6 md:px-8 md:pb-14 md:pt-10">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start">
          <div className="lg:col-span-7">
            <p className="inline-flex rounded-full border border-border/70 bg-card px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              Production-ready UI registry
            </p>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight md:text-6xl md:leading-[1.02]">
              AI-first components to ship faster with consistency.
            </h1>
            <p className="mt-5 max-w-2xl text-sm leading-relaxed text-muted-foreground md:text-base">
              Ekairos Registry is a standalone component source for teams building agent interfaces.
              Install from CLI, use in your app, and keep your UI system aligned as the product grows.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <a
                href="#showcase"
                className="rounded-full bg-foreground px-6 py-3 text-sm font-medium text-background hover:opacity-90 transition-opacity"
              >
                Explore showcase
              </a>
              <Link
                href="/demo"
                className="rounded-full border border-border bg-background px-6 py-3 text-sm hover:bg-muted/50 transition-colors"
              >
                Open live demo
              </Link>
            </div>

            <div className="mt-8 rounded-2xl border border-border bg-card p-4">
              <div className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Install</div>
              <pre className="mt-2 overflow-x-auto rounded-lg border border-border/70 bg-background p-3 font-mono text-xs text-foreground">
                npx shadcn@latest add @ekairos/agent
              </pre>
            </div>
          </div>

          <div className="lg:col-span-5">
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <p className="text-sm font-medium">What this site ships</p>
              <div className="mt-4 space-y-2">
                <div className="rounded-lg border border-border bg-background px-3 py-2 text-xs">
                  Landing + showcase for published components
                </div>
                <div className="rounded-lg border border-border bg-background px-3 py-2 text-xs">
                  Registry endpoints ready for CLI consumption
                </div>
                <div className="rounded-lg border border-border bg-background px-3 py-2 text-xs">
                  Docs and demo routes for visual validation
                </div>
              </div>

              <div className="mt-5 grid grid-cols-3 gap-2">
                <div className="rounded-lg border border-border bg-background p-3">
                  <div className="text-[11px] text-muted-foreground">Components</div>
                  <div className="mt-1 text-lg font-semibold">{items.length}</div>
                </div>
                <div className="rounded-lg border border-border bg-background p-3">
                  <div className="text-[11px] text-muted-foreground">Showcase</div>
                  <div className="mt-1 text-lg font-semibold">{showcase.length}</div>
                </div>
                <div className="rounded-lg border border-border bg-background p-3">
                  <div className="text-[11px] text-muted-foreground">Status</div>
                  <div className="mt-1 text-lg font-semibold">Ready</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="showcase" className="mx-auto w-full max-w-6xl px-5 pb-16 md:px-8 md:pb-20">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Showcase</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">Featured components</h2>
          </div>
          <Link href="/registry" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            View full registry
          </Link>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {showcase.length === 0 ? (
            <div className="col-span-full rounded-2xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
              No public components found in the registry.
            </div>
          ) : (
            showcase.map((item) => (
              <article key={item.name} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-base font-medium tracking-tight">{item.title}</h3>
                  <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    @{item.name}
                  </span>
                </div>

                <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                  {item.description}
                </p>

                <pre className="mt-4 overflow-x-auto rounded-lg border border-border/70 bg-background p-2 font-mono text-[11px] text-foreground">
                  {getInstallCommand(item.name)}
                </pre>

                <div className="mt-4 flex items-center gap-3 text-xs">
                  <a
                    href={`/${item.name}.json`}
                    className="rounded-full border border-border px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                  >
                    JSON endpoint
                  </a>
                  <Link
                    href="/demo"
                    className="rounded-full border border-border px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                  >
                    Demo route
                  </Link>
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      <footer className="border-t border-border/70 py-8">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-5 text-xs text-muted-foreground md:flex-row md:px-8">
          <p>Ekairos Registry - standalone site for component distribution.</p>
          <div className="flex items-center gap-4">
            <Link href="/demo" className="hover:text-foreground transition-colors">
              Demo
            </Link>
            <Link href="/docs/components/message" className="hover:text-foreground transition-colors">
              Docs
            </Link>
            <Link href="/registry" className="hover:text-foreground transition-colors">
              Registry
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
