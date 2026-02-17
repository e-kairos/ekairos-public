import "server-only";

import { init } from "@instantdb/admin";
import schema from "@/instant.schema";
import { clerkClient } from "@clerk/nextjs/server";

/**
 * Obtiene las credenciales de InstantDB desde Clerk metadata.
 * 
 * @param clerkOrgId ID de la organización en Clerk
 * @returns Credenciales (appId y adminToken) o null si no existen
 */
export async function getOrgCredentials(clerkOrgId: string): Promise<{ appId: string; adminToken: string } | null> {
  try {
    const clerk = await clerkClient();
    const org = await clerk.organizations.getOrganization({ organizationId: clerkOrgId });
    const privateMetadata: any = org.privateMetadata || {};
    const instantMeta = (privateMetadata.instant as any) || {};

    if (instantMeta.appId && instantMeta.adminToken) {
      return {
        appId: String(instantMeta.appId),
        adminToken: String(instantMeta.adminToken),
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Obtiene un cliente admin de InstantDB scoped a una organización específica.
 * 
 * @param clerkOrgId ID de la organización en Clerk
 * @returns Cliente admin de InstantDB inicializado
 * @throws Error si las credenciales no existen
 */
export async function getOrgAdminDb(clerkOrgId: string) {
  const creds = await getOrgCredentials(clerkOrgId);

  if (!creds) {
    throw new Error(
      `InstantDB credentials not found for organization ${clerkOrgId}.`
    );
  }

  return init({
    appId: creds.appId,
    adminToken: creds.adminToken,
    schema,
    useDateObjects: true,
  });
}













