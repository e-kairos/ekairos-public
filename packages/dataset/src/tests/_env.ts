import { describe, it } from "vitest";
import { getOrCreateInstantTestApp } from "./instantTestUtils";

export function hasInstantAdmin(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_INSTANT_APP_ID && process.env.INSTANT_APP_ADMIN_TOKEN);
}

export async function setupInstantTestEnv(title: string): Promise<boolean> {
  if (hasInstantAdmin()) return true;
  const app = await getOrCreateInstantTestApp({ title });
  if (!app) return false;
  process.env.NEXT_PUBLIC_INSTANT_APP_ID = app.appId;
  process.env.INSTANT_APP_ADMIN_TOKEN = app.adminToken;
  return true;
}

export const describeInstant = ((name: string, fn: Parameters<typeof describe>[1]) =>
  (hasInstantAdmin() ? describe : describe.skip)(name, fn)) as typeof describe;

export const itInstant = ((name: string, fn: Parameters<typeof it>[1], timeout?: number) =>
  (hasInstantAdmin() ? it : it.skip)(name, fn, timeout)) as typeof it;
