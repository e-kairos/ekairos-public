"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth, useOrganization } from "@clerk/nextjs";
import { init } from "@instantdb/react";
import schema from "@instant.schema";

type InstantClient = ReturnType<typeof init>;

const orgDbCache = new Map<string, InstantClient>();

function getDbForApp(appId: string): InstantClient {
  let db = orgDbCache.get(appId);
  if (!db) {
    db = init({
      appId,
      schema,
      useDateObjects: true,
    });
    orgDbCache.set(appId, db);
  }
  return db;
}

async function signInDbWithClerkToken(db: InstantClient, getToken: () => Promise<string | null>) {
  const idToken = await getToken();
  if (!idToken) {
    return;
  }
  await db.auth.signInWithIdToken({
    clientName: "clerk",
    idToken,
  });
}

export function useOrgDb() {
  const { organization, isLoaded: orgLoaded } = useOrganization();
  const { getToken, isLoaded: authLoaded } = useAuth();

  const [appId, setAppId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function resolveApp() {
      if (!authLoaded || !orgLoaded) return;
      if (!organization?.id) {
        setLoading(false);
        return;
      }
      try {
        const res = await fetch("/api/internal/instant/org-app", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to resolve org Instant app");
        if (!cancelled) {
          setAppId(data.appId as string);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e as Error);
          setLoading(false);
        }
      }
    }
    resolveApp();
    return () => {
      cancelled = true;
    };
  }, [organization?.id, authLoaded, orgLoaded]);

  const db = useMemo(() => {
    if (!appId) return null;
    return getDbForApp(appId);
  }, [appId]);

  useEffect(() => {
    if (!db || !appId) return;
    let cancelled = false;
    (async () => {
      try {
        await signInDbWithClerkToken(db, getToken);
      } catch (e) {
        if (!cancelled) {
          console.error("Error signing in to InstantDB for org:", e);
          setError(e as Error);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, appId, getToken]);

  return {
    db,
    appId,
    loading: loading || !authLoaded || !orgLoaded,
    error,
  };
}




