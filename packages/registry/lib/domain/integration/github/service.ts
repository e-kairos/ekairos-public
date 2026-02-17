import "server-only";

import { init } from "@instantdb/admin";
import { GH_API_BASE_URL } from "./constant";
import { SandboxService } from "@/lib/domain/sandbox/service";
import { getOrgAdminDb, getOrgCredentials } from "@/lib/admin-org-db";

export type ServiceResult<T = any> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Get an untyped admin DB for querying integration entities
 * (which are not in Registry's schema but exist in the shared DB)
 */
async function getUntypedAdminDb(clerkOrgId: string) {
  const creds = await getOrgCredentials(clerkOrgId);
  if (!creds) {
    throw new Error(`InstantDB credentials not found for organization ${clerkOrgId}.`);
  }
  // No schema - allows querying any entity in the DB
  return init({
    appId: creds.appId,
    adminToken: creds.adminToken,
  });
}

export class GitHubIntegrationService {
  /**
   * Get GitHub access token for an organization.
   * Uses untyped admin SDK because integration_secrets is not in Registry's schema.
   */
  static async getAccessTokenForOrg(params: { clerkOrgId: string }): Promise<ServiceResult<{ accessToken: string }>> {
    try {
      const { clerkOrgId } = params;
      console.log("[GitHubIntegrationService] Getting token for orgId:", clerkOrgId);
      
      // Use untyped DB to query integration entities
      const db = await getUntypedAdminDb(clerkOrgId);
      console.log("[GitHubIntegrationService] Got untyped DB instance");
      
      // Query exactly like ekairos-core does
      const qr: any = await db.query({
        integration_secrets: {
          $: {
            where: {
              kind: "github.access_token",
              "externalConnection.provider": "github",
              "externalConnection.status": "active",
            },
            limit: 1,
          },
        },
      });

      console.log("[GitHubIntegrationService] Query result keys:", Object.keys(qr || {}));
      console.log("[GitHubIntegrationService] Secrets count:", qr?.integration_secrets?.length ?? 0);

      const secret = qr?.integration_secrets?.[0];
      if (!secret?.data) {
        console.log("[GitHubIntegrationService] No secret found or no data field");
        return { ok: false, error: "Token no encontrado" };
      }
      console.log("[GitHubIntegrationService] Found token (length):", String(secret.data).length);
      return { ok: true, data: { accessToken: String(secret.data) } };
    } catch (e) {
      console.error("[GitHubIntegrationService] getAccessTokenForOrg error:", e);
      return { ok: false, error: "No se pudo obtener el token: " + String(e) };
    }
  }

  /**
   * Fetch from GitHub API with auth
   */
  static async fetchGitHub<T = any>(
    accessToken: string,
    endpoint: string,
    options?: RequestInit,
  ): Promise<ServiceResult<T>> {
    try {
      const url = endpoint.startsWith("http") ? endpoint : `${GH_API_BASE_URL}${endpoint}`;
      const res = await fetch(url, {
        ...options,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${accessToken}`,
          ...(options?.headers || {}),
        },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false, error: `GitHub ${res.status}: ${text}` };
      }
      const data = await res.json();
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  /**
   * List repositories for the authenticated user (or org if provided)
   */
  static async listRepositories(
    clerkOrgId: string,
    org?: string,
    perPage = 30,
  ): Promise<ServiceResult<any[]>> {
    const tokenRes = await this.getAccessTokenForOrg({ clerkOrgId });
    if (!tokenRes.ok) {
      return { ok: false, error: tokenRes.error };
    }
    const accessToken = tokenRes.data.accessToken;
    const endpoint = org ? `/orgs/${org}/repos?per_page=${perPage}` : `/user/repos?per_page=${perPage}`;
    return this.fetchGitHub<any[]>(accessToken, endpoint);
  }

  /**
   * Clone a repository into a sandbox
   */
  static async cloneRepository(params: {
    clerkOrgId: string;
    repoUrl: string;
    sandboxId: string;
    depth?: number;
  }): Promise<ServiceResult<void>> {
    try {
      const { clerkOrgId, repoUrl, sandboxId, depth } = params;
      
      // Get access token for authentication
      const tokenRes = await this.getAccessTokenForOrg({ clerkOrgId });
      if (!tokenRes.ok) {
        return { ok: false, error: tokenRes.error };
      }
      const accessToken = tokenRes.data.accessToken;

      // Construct authenticated URL
      const authRepoUrl = repoUrl.replace("https://", `https://${accessToken}@`);

      const db = await getOrgAdminDb(clerkOrgId);
      const sandboxService = new SandboxService(db);

      const cmd = `git clone ${depth ? `--depth ${depth}` : ""} ${authRepoUrl} .`;
      const result = await sandboxService.runCommand(sandboxId, cmd);

      if (!result.ok) {
        return { ok: false, error: result.data?.stderr || "Clone failed" };
      }
      
      // Config user (generic)
      await sandboxService.runCommand(sandboxId, `git config user.email "agent@ekairos.dev" && git config user.name "Ekairos Agent"`);

      return { ok: true, data: undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: `Clone failed: ${message}` };
    }
  }

  static async readFile(params: {
      clerkOrgId: string;
      sandboxId: string;
      path: string;
  }): Promise<ServiceResult<string>> {
      try {
        const { clerkOrgId, sandboxId, path } = params;
        const db = await getOrgAdminDb(clerkOrgId);
        const sandboxService = new SandboxService(db);
        
        const result = await sandboxService.runCommand(sandboxId, `cat ${path}`);
        if (!result.ok) return { ok: false, error: "Read file failed" };
        
        return { ok: true, data: result.data.stdout };
      } catch (error) {
          return { ok: false, error: String(error) };
      }
  }
}
