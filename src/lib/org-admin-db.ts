import "server-only";

import { init } from "@instantdb/admin";
import schema from "@instant.schema";
import { instantService } from "@/lib/domain/instant/service";

type AdminClient = ReturnType<typeof init>;

const adminDbCache = new Map<string, AdminClient>();

export async function getOrgAdminDb(clerkOrgId: string) {
  const creds = await instantService.getOrgCredentials({ clerkOrgId });
  let db = adminDbCache.get(creds.appId);
  if (!db) {
    db = init({
      appId: creds.appId,
      adminToken: creds.adminToken,
      schema,
      useDateObjects: true,
    });
    adminDbCache.set(creds.appId, db);
  }
  return db;
}



