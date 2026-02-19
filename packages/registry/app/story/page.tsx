import Link from "next/link";

export default function StoryPage() {
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-4xl flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
        Story runtime removed from registry
      </h1>
      <p className="max-w-2xl text-sm text-muted-foreground md:text-base">
        The registry is now a mostly static distribution surface. Story
        registration and reaction endpoints are disabled.
      </p>
      <Link
        href="/"
        className="rounded-full border border-border px-4 py-2 text-sm hover:bg-muted/50"
      >
        Back to home
      </Link>
    </main>
  );
}
