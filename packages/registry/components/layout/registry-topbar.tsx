"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { EkairosLogo } from "@/components/ekairos/ekairos-logo";
import { InstantExplorerDialog } from "@/components/layout/instant-explorer-dialog";
import { useRegistrySession } from "@/lib/registry-session";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Registry", match: (pathname: string) => pathname === "/" },
  {
    href: "/docs/library/ekairos-lib",
    label: "Docs",
    match: (pathname: string) => pathname.startsWith("/docs/library"),
  },
  {
    href: "/docs/components/message",
    label: "Components",
    match: (pathname: string) => pathname.startsWith("/docs/components"),
  },
  {
    href: "/examples",
    label: "Examples",
    match: (pathname: string) => pathname.startsWith("/examples"),
  },
] as const;

export function RegistryTopbar() {
  const pathname = usePathname();
  const { session, status, error } = useRegistrySession();

  const appIdLabel =
    status === "initializing"
      ? "provisioning..."
      : session?.appId || (error ? "session-error" : "no-session");

  return (
    <div className="fixed inset-x-0 top-0 z-[70] border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-11 w-full max-w-7xl items-center justify-between gap-4 px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-4">
          <Link href="/" className="flex items-center gap-3">
            <EkairosLogo size="sm" />
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {NAV_ITEMS.map((item) => {
              const active = item.match(pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "rounded-md px-2.5 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex min-w-0 items-center gap-2">
          <div className="hidden items-center gap-2 md:flex">
            <InstantExplorerDialog />
          </div>
          <span className="hidden text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:inline">
            app
          </span>
          <div
            title={session?.appId || error || appIdLabel}
            className={cn(
              "max-w-[48vw] truncate rounded-full border px-3 py-1 font-mono text-[11px]",
              status === "error"
                ? "border-destructive/40 text-destructive"
                : "border-border text-muted-foreground",
            )}
          >
            {appIdLabel}
          </div>
        </div>
      </div>
    </div>
  );
}
