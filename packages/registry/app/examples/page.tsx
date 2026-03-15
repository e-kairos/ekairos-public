import Link from "next/link";
import { reactorShowcases } from "@/lib/examples/reactors/registry";

export default function ExamplesPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-6">
      <header className="rounded-3xl border border-border bg-card p-6">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Examples
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
          Reactor showcases
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground md:text-base">
          Live runnable surfaces for Ekairos reactors. Each showcase owns its transport,
          context rendering, and persisted inspection panel separately from the public
          component registry.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        {reactorShowcases.map((showcase) => (
          <Link
            key={showcase.id}
            href={showcase.route}
            data-testid="reactor-showcase-card"
            className="rounded-3xl border border-border bg-card p-5 transition-colors hover:bg-muted/30"
          >
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              {showcase.reactorType} / {showcase.mode}
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">
              {showcase.title}
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {showcase.description}
            </p>
            <div className="mt-4 rounded-xl border border-border/70 bg-background px-3 py-2 font-mono text-[11px] text-muted-foreground">
              {showcase.route}
            </div>
          </Link>
        ))}
      </section>
    </main>
  );
}
