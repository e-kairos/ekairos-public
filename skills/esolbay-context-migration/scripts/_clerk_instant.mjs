export function normalizeApiUri(value, fallback) {
  const raw = String(value || fallback || "").trim();
  return raw.replace(/\/+$/, "");
}

export function extractInstantCredentials(orgPayload) {
  const privateMetadata =
    orgPayload && typeof orgPayload.private_metadata === "object" && orgPayload.private_metadata
      ? orgPayload.private_metadata
      : orgPayload && typeof orgPayload.privateMetadata === "object" && orgPayload.privateMetadata
        ? orgPayload.privateMetadata
        : {};
  const instant = privateMetadata && typeof privateMetadata.instant === "object" && privateMetadata.instant
    ? privateMetadata.instant
    : {};
  const appId = typeof instant.appId === "string" ? instant.appId.trim() : "";
  const adminToken = typeof instant.adminToken === "string" ? instant.adminToken.trim() : "";
  return {
    appId,
    adminToken,
  };
}

export async function getClerkOrganization(clerkApiUri, clerkSecretKey, organizationId) {
  const url = `${clerkApiUri}/v1/organizations/${encodeURIComponent(organizationId)}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      authorization: `Bearer ${clerkSecretKey}`,
      accept: "application/json",
    },
  });

  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { rawText: text };
  }

  if (!response.ok) {
    throw new Error(
      `Failed to read Clerk organization ${organizationId} (${response.status}): ${JSON.stringify(payload)}`,
    );
  }

  return payload;
}

export async function resolveInstantCredentialsFromClerk(params) {
  const clerkApiUri = normalizeApiUri(params.clerkApiUri, "https://api.clerk.com");
  const organizationId = String(params.orgId || "").trim();
  const clerkSecretKey = String(params.clerkSecretKey || "").trim();

  if (!organizationId) {
    throw new Error("Missing org id for Clerk credential resolution.");
  }
  if (!clerkSecretKey) {
    throw new Error("Missing Clerk secret for credential resolution.");
  }

  const organization = await getClerkOrganization(clerkApiUri, clerkSecretKey, organizationId);
  const instant = extractInstantCredentials(organization);
  if (!instant.appId || !instant.adminToken) {
    throw new Error(
      `Organization ${organizationId} is missing privateMetadata.instant.appId/adminToken.`,
    );
  }

  return {
    organization,
    appId: instant.appId,
    adminToken: instant.adminToken,
    clerkApiUri,
  };
}
