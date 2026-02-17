import "server-only";

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { clerkClient } from "@clerk/nextjs/server";

const execFileAsync = promisify(execFile);

export type InstantOrgCredentials = {
  appId: string;
  adminToken: string;
};

async function createInstantAppForOrg(params: { title: string }): Promise<InstantOrgCredentials> {
  const { title } = params;
  const env = {
    ...process.env,
  };
  const args = ["instant-cli", "init-without-files", "--title", title];
  const { stdout } = await execFileAsync("npx", args, {
    env,
    maxBuffer: 1024 * 1024,
  });
  let parsed: any;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    throw new Error("Failed to parse Instant CLI output as JSON");
  }
  if (parsed.error) {
    throw new Error("Instant CLI reported an error creating app");
  }
  const appId = String(parsed.appId || "");
  const adminToken = String(parsed.adminToken || "");
  if (!appId || !adminToken) {
    throw new Error("Instant CLI did not return appId/adminToken");
  }
  return { appId, adminToken };
}

async function getOrgCredentials(params: {
  clerkOrgId: string;
  orgName?: string;
  createIfMissing?: boolean;
}): Promise<InstantOrgCredentials> {
  const { clerkOrgId, orgName, createIfMissing = true } = params;
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
  if (!createIfMissing) {
    throw new Error("InstantDB credentials not found for organization");
  }
  const title = orgName || org.name || "Ekairos Org";
  const created = await createInstantAppForOrg({ title });
  await clerk.organizations.updateOrganizationMetadata(org.id, {
    privateMetadata: {
      ...privateMetadata,
      instant: {
        appId: created.appId,
        adminToken: created.adminToken,
      },
    },
  });
  return created;
}

export const instantService = {
  getOrgCredentials,
  createInstantAppForOrg,
};
import "server-only";

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { clerkClient } from "@clerk/nextjs/server";

const execFileAsync = promisify(execFile);

export type InstantOrgCredentials = {
  appId: string;
  adminToken: string;
};

async function createInstantAppForOrg(params: { title: string }): Promise<InstantOrgCredentials> {
  const { title } = params;
  const env = {
    ...process.env,
  };
  const args = ["instant-cli", "init-without-files", "--title", title];
  const { stdout } = await execFileAsync("npx", args, {
    env,
    maxBuffer: 1024 * 1024,
  });
  let parsed: any;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    throw new Error("Failed to parse Instant CLI output as JSON");
  }
  if (parsed.error) {
    throw new Error("Instant CLI reported an error creating app");
  }
  const appId = String(parsed.appId || "");
  const adminToken = String(parsed.adminToken || "");
  if (!appId || !adminToken) {
    throw new Error("Instant CLI did not return appId/adminToken");
  }
  return { appId, adminToken };
}

async function getOrgCredentials(params: {
  clerkOrgId: string;
  orgName?: string;
  createIfMissing?: boolean;
}): Promise<InstantOrgCredentials> {
  const { clerkOrgId, orgName, createIfMissing = true } = params;
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
  if (!createIfMissing) {
    throw new Error("InstantDB credentials not found for organization");
  }
  const title = orgName || org.name || "Ekairos Org";
  const created = await createInstantAppForOrg({ title });
  await clerk.organizations.updateOrganizationMetadata(org.id, {
    privateMetadata: {
      ...privateMetadata,
      instant: {
        appId: created.appId,
        adminToken: created.adminToken,
      },
    },
  });
  return created;
}

export const instantService = {
  getOrgCredentials,
  createInstantAppForOrg,
};
import "server-only";

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { clerkClient } from "@clerk/nextjs/server";

const execFileAsync = promisify(execFile);

export type InstantOrgCredentials = {
  appId: string;
  adminToken: string;
};

export class InstantService {
  /**
   * Lee las credenciales de InstantDB para una organización desde la metadata privada de Clerk.
   * Si no existen y `createIfMissing` es true, crea una nueva app en Instant y las persiste.
   */
  static async getOrgCredentials(params: {
    clerkOrgId: string;
    orgName?: string;
    createIfMissing?: boolean;
  }): Promise<InstantOrgCredentials> {
    const { clerkOrgId, orgName, createIfMissing = true } = params;

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

    if (!createIfMissing) {
      throw new Error("InstantDB credentials not found for organization");
    }

    const title = orgName || org.name || "Ekairos Org";
    const created = await InstantService.createInstantAppForOrg({ title });

    await clerk.organizations.updateOrganizationMetadata(org.id, {
      privateMetadata: {
        ...privateMetadata,
        instant: {
          appId: created.appId,
          adminToken: created.adminToken,
        },
      },
    });

    return created;
  }

  /**
   * Crea una nueva app de Instant para una organización usando el CLI.
   * Requiere que INSTANT_CLI_AUTH_TOKEN esté configurado o que se haya hecho login previamente.
   */
  static async createInstantAppForOrg(params: {
    title: string;
  }): Promise<InstantOrgCredentials> {
    const { title } = params;

    const env = {
      ...process.env,
    };

    // Usamos la CLI instalada como dependencia del workspace.
    // `npx instant-cli` preferirá la versión local del paquete.
    const args = ["instant-cli", "init-without-files", "--title", title];

    const { stdout } = await execFileAsync("npx", args, {
      env,
      maxBuffer: 1024 * 1024,
    });

    let parsed: any;
    try {
      parsed = JSON.parse(stdout.trim());
    } catch {
      throw new Error("Failed to parse Instant CLI output as JSON");
    }

    if (parsed.error) {
      throw new Error("Instant CLI reported an error creating app");
    }

    const appId = String(parsed.appId || "");
    const adminToken = String(parsed.adminToken || "");

    if (!appId || !adminToken) {
      throw new Error("Instant CLI did not return appId/adminToken");
    }

    return { appId, adminToken };
  }
}

import "server-only";

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { clerkClient } from "@clerk/nextjs/server";

const execFileAsync = promisify(execFile);

export type InstantOrgCredentials = {
  appId: string;
  adminToken: string;
};

export class InstantService {
  /**
   * Lee las credenciales de InstantDB para una organización desde la metadata privada de Clerk.
   * Si no existen y `createIfMissing` es true, crea una nueva app en Instant y las persiste.
   */
  static async getOrgCredentials(params: {
    clerkOrgId: string;
    orgName?: string;
    createIfMissing?: boolean;
  }): Promise<InstantOrgCredentials> {
    const { clerkOrgId, orgName, createIfMissing = true } = params;

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

    if (!createIfMissing) {
      throw new Error("InstantDB credentials not found for organization");
    }

    const title = orgName || org.name || "Ekairos Org";
    const created = await InstantService.createInstantAppForOrg({ title });

    await clerk.organizations.updateOrganizationMetadata(org.id, {
      privateMetadata: {
        ...privateMetadata,
        instant: {
          appId: created.appId,
          adminToken: created.adminToken,
        },
      },
    });

    return created;
  }

  /**
   * Crea una nueva app de Instant para una organización usando el CLI.
   * Requiere que INSTANT_CLI_AUTH_TOKEN esté configurado o que se haya hecho login previamente.
   */
  static async createInstantAppForOrg(params: {
    title: string;
  }): Promise<InstantOrgCredentials> {
    const { title } = params;

    const env = {
      ...process.env,
    };

    // Usamos la CLI instalada como dependencia del workspace.
    // `npx instant-cli` preferirá la versión local del paquete.
    const args = ["instant-cli", "init-without-files", "--title", title];

    const { stdout } = await execFileAsync("npx", args, {
      env,
      maxBuffer: 1024 * 1024,
    });

    let parsed: any;
    try {
      parsed = JSON.parse(stdout.trim());
    } catch {
      throw new Error("Failed to parse Instant CLI output as JSON");
    }

    if (parsed.error) {
      throw new Error("Instant CLI reported an error creating app");
    }

    const appId = String(parsed.appId || "");
    const adminToken = String(parsed.adminToken || "");

    if (!appId || !adminToken) {
      throw new Error("Instant CLI did not return appId/adminToken");
    }

    return { appId, adminToken };
  }
}


