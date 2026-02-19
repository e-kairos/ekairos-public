import Link from "next/link";

export default function RegistryRepoPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-4xl flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
        Registry runtime is disabled
      </h1>
      <p className="max-w-2xl text-sm text-muted-foreground md:text-base">
        Dynamic repo pages are no longer served. Requested id:{" "}
        <span className="font-mono">{params.id}</span>
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/registry"
          className="rounded-full border border-border px-4 py-2 text-sm hover:bg-muted/50"
        >
          Back to registry
        </Link>
        <Link
          href="/docs/components/message"
          className="rounded-full border border-border px-4 py-2 text-sm hover:bg-muted/50"
        >
          Open docs
        </Link>
      </div>
    </main>
  );
}
