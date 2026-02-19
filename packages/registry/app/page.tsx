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

function getPrimaryExamples(items: RegistryItem[]) {
  const preferred = ["agent", "prompt", "message", "full-agent", "chain-of-thought"];
  const selected: RegistryItem[] = [];

  for (const key of preferred) {
    const match = items.find((item) => item.name === key);
    if (match) selected.push(match);
  }

  return selected.length > 0 ? selected : items.slice(0, 5);
}

export default async function HomePage() {
  const registry = await getRegistry();
  const items = ((registry?.items ?? []) as RegistryItem[])
    .filter(isPublicItem)
    .sort((a, b) => a.name.localeCompare(b.name));

  const examples = getPrimaryExamples(items);

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-8 md:px-8 md:py-10">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Ekairos Registry</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Technical index for installable components and JSON registry endpoints.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-full border border-border px-3 py-1 text-muted-foreground">
            Components: {items.length}
          </span>
          <Link
            href="/docs/components/message"
            className="rounded-full border border-border px-3 py-1 hover:bg-muted/50"
          >
            Docs
          </Link>
          <Link
            href="/demo"
            className="rounded-full border border-border px-3 py-1 hover:bg-muted/50"
          >
            Demo
          </Link>
        </div>
      </header>

      <section className="mt-8 grid gap-5 lg:grid-cols-2">
        <article className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Quick install
          </h2>
          <div className="mt-3 space-y-2">
            {examples.map((item) => (
              <pre
                key={item.name}
                className="overflow-x-auto rounded-lg border border-border/70 bg-background px-3 py-2 font-mono text-xs"
              >
                {getInstallCommand(item.name)}
              </pre>
            ))}
          </div>
        </article>

        <article className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Endpoints
          </h2>
          <div className="mt-3 space-y-2 font-mono text-xs">
            <div className="rounded-lg border border-border/70 bg-background px-3 py-2">
              `GET /registry.json`
            </div>
            <div className="rounded-lg border border-border/70 bg-background px-3 py-2">
              `GET /{"{component}"}.json`
            </div>
            <div className="rounded-lg border border-border/70 bg-background px-3 py-2">
              `GET /docs/components/{"{component}"}`
            </div>
          </div>
        </article>
      </section>

      <section className="mt-8 rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Component index
          </h2>
        </div>

        {items.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">No public components found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-[0.12em] text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3">Install</th>
                  <th className="px-4 py-3">JSON</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.name} className="border-t border-border">
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">@ekairos/{item.name}</td>
                    <td className="px-4 py-3 font-medium">{item.title}</td>
                    <td className="px-4 py-3 text-muted-foreground">{item.description}</td>
                    <td className="px-4 py-3">
                      <code className="rounded bg-muted px-2 py-1 text-xs">{getInstallCommand(item.name)}</code>
                    </td>
                    <td className="px-4 py-3">
                      <a
                        href={`/${item.name}.json`}
                        className="text-xs underline underline-offset-4 hover:text-foreground"
                      >
                        /{item.name}.json
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
