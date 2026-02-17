import "server-only";

import {
  GH_AUTHORIZATION_BASE_URL,
  GH_TOKEN_URL,
  getGitHubClientId,
  getGitHubClientSecret,
  getGitHubRedirectUri,
} from "../constant";
import { getOrgAdminDb } from "@/lib/admin-org-db";

type ServiceResult<T = any> = { ok: true; data: T } | { ok: false; error: string };

// Helper PKCE utilities (simplified)
function base64UrlEncode(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = Buffer.from(binary, "binary").toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function generateState(orgId: string) {
  const sid = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));
  const stateObj = { sid, orgId };
  const stateStr = JSON.stringify(stateObj);
  return base64UrlEncode(new TextEncoder().encode(stateStr));
}

export class GitHubOAuthService {
  /**
   * Generates the GitHub authorization URL (OAuth).
   * NOTE: This is a light adaptation of ekairos-core; session persistence/PKCE omitted for brevity.
   */
  static async createAuthorizationUrl(params: { orgClerkId: string }): Promise<ServiceResult<{ url: string }>> {
    try {
      const { orgClerkId } = params;
      if (!orgClerkId) return { ok: false, error: "Falta organización" };

      const clientId = getGitHubClientId();
      const redirectUri = getGitHubRedirectUri();

      const state = generateState(orgClerkId);
      const scope = "repo read:org user";

      const url = `${GH_AUTHORIZATION_BASE_URL}?client_id=${clientId}&redirect_uri=${encodeURIComponent(
        redirectUri,
      )}&state=${state}&scope=${encodeURIComponent(scope)}`;

      return { ok: true, data: { url } };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: `No se pudo generar la URL de autorización: ${msg}` };
    }
  }

  /**
   * Handles the OAuth callback and exchanges code for token.
   * This is simplified; secrets are not persisted in this stub.
   */
  static async handleCallback(params: { fullUrl: string }): Promise<ServiceResult<{ redirectUrl: string }>> {
    try {
      const { fullUrl } = params;
      const parsed = new URL(fullUrl);
      const code = parsed.searchParams.get("code");
      const state = parsed.searchParams.get("state");
      if (!code || !state) return { ok: false, error: "Parámetros inválidos" };

      // Decode state to extract orgId (best-effort)
      let orgId: string | null = null;
      try {
        const bytes = Buffer.from(state.replace(/-/g, "+").replace(/_/g, "/"), "base64");
        const json = JSON.parse(bytes.toString("utf8")) as { orgId?: string };
        orgId = json.orgId || null;
      } catch {}
      if (!orgId) return { ok: false, error: "Estado inválido (no orgId)" };

      const body = {
        client_id: getGitHubClientId(),
        client_secret: getGitHubClientSecret(),
        code,
        redirect_uri: getGitHubRedirectUri(),
      };

      const tokenRes = await fetch(GH_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      if (!tokenRes.ok) {
        const text = await tokenRes.text().catch(() => "");
        console.error("GitHub token exchange failed", text);
        return { ok: false, error: "No se pudo obtener tokens" };
      }
      const tokenJson: any = await tokenRes.json();
      const accessToken = tokenJson.access_token;
      if (!accessToken) return { ok: false, error: "No access token received" };

      // Persist token in InstantDB (simplified: one active token per org)
      const db = await getOrgAdminDb(orgId);
      const now = Date.now();
      await db.transact([
        db.tx.integration_secrets[id()].update({
          kind: "github.access_token",
          data: accessToken,
          createdAt: now,
          updatedAt: now,
        }),
      ]);

      return { ok: true, data: { redirectUrl: "/registry" } };
    } catch (e) {
      return { ok: false, error: "Error en callback" };
    }
  }
}














