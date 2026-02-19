import Link from "next/link";

export default function RegistryListPage() {
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-4xl flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
        Registry index is now static
      </h1>
      <p className="max-w-2xl text-sm text-muted-foreground md:text-base">
        Authentication, organization-scoped registries, and runtime
        synchronization were removed from this site. Use the component docs and
        JSON endpoints as the single public surface.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="rounded-full border border-border px-4 py-2 text-sm hover:bg-muted/50"
        >
          Back to home
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
