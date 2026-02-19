"use client";

import { useMemo } from "react";

import { getDbForApp } from "@/lib/client-org-db";

export function useOrgDb() {
  const appId = process.env.NEXT_PUBLIC_INSTANT_APP_ID;
  if (!appId) {
    throw new Error(
      "NEXT_PUBLIC_INSTANT_APP_ID is required to initialize the registry org database."
    );
  }

  const db = useMemo(() => getDbForApp(appId), [appId]);
  return { db, appId, isLoading: false as const };
}
