"use client";

import dynamic from "next/dynamic";
import { DatabaseIcon, Loader2, RotateCcwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useRegistrySession } from "@/lib/registry-session";

const Explorer = dynamic(
  () => import("@instantdb/components").then((mod) => mod.Explorer),
  { ssr: false },
);
const Toaster = dynamic(
  () => import("@instantdb/components").then((mod) => mod.Toaster),
  { ssr: false },
);

export function InstantExplorerDialog() {
  const router = useRouter();
  const { session, status, destroySession, recreateSession } = useRegistrySession();
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const hasSession = Boolean(session?.appId && session?.adminToken);

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasSession || refreshing}
            className="h-8 gap-1.5 px-2.5 text-xs"
          >
            <DatabaseIcon className="h-3.5 w-3.5" />
            Explorer
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-6xl p-0 sm:max-w-6xl">
          <DialogHeader className="border-b px-5 py-4">
            <DialogTitle>Instant Explorer</DialogTitle>
            <DialogDescription>
              Explore the current ephemeral app directly from the registry session.
            </DialogDescription>
          </DialogHeader>
          <div className="h-[75vh] min-h-[560px]">
            {hasSession ? (
              <Explorer
                key={session?.appId}
                className="h-full"
                useShadowDOM
                darkMode={false}
                appId={session!.appId}
                adminToken={session!.adminToken}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Session not ready.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Button
        variant="outline"
        size="sm"
        disabled={status === "initializing" || refreshing}
        className="h-8 gap-1.5 px-2.5 text-xs"
        onClick={async () => {
          setRefreshing(true);
          try {
            await destroySession();
            await recreateSession();
            setOpen(false);
            router.refresh();
          } finally {
            setRefreshing(false);
          }
        }}
      >
        {refreshing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RotateCcwIcon className="h-3.5 w-3.5" />
        )}
        New App
      </Button>

      <Toaster position="top-right" />
    </>
  );
}
