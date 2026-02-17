import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "fs/promises";
import * as path from "path";

const execAsync = promisify(exec);

export type InstantTestApp = {
  appId: string;
  adminToken: string;
};

const ARTIFACT_PATH = path.resolve(process.cwd(), "test-results", "instant-test-app.json");

export async function writeInstantTestApp(app: InstantTestApp) {
  await fs.mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
  await fs.writeFile(ARTIFACT_PATH, JSON.stringify(app, null, 2), "utf8");
}

export async function readInstantTestApp(): Promise<InstantTestApp | null> {
  try {
    const raw = await fs.readFile(ARTIFACT_PATH, "utf8");
    return JSON.parse(raw) as InstantTestApp;
  } catch {
    return null;
  }
}

async function parseInstantCliInitOutput(stdout: string): Promise<InstantTestApp> {
  const raw = String(stdout ?? "").trim();
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error(`instant-cli init output did not contain JSON. Got: ${raw.slice(0, 200)}`);
  }
  const jsonStr = raw.slice(firstBrace, lastBrace + 1);
  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`Failed to parse instant-cli JSON. Got: ${jsonStr.slice(0, 200)}`);
  }
  if (parsed?.error) {
    throw new Error(`instant-cli error: ${String(parsed.error)}`);
  }
  const appId = String(parsed?.app?.appId ?? "");
  const adminToken = String(parsed?.app?.adminToken ?? "");
  if (!appId || !adminToken) {
    throw new Error("instant-cli did not return appId/adminToken");
  }
  return { appId, adminToken };
}

export async function createTempInstantAppAndPush({
  title,
}: {
  title: string;
}): Promise<InstantTestApp> {
  const instantCliAuthToken = String(process.env.INSTANT_CLI_AUTH_TOKEN ?? "").trim();
  if (!instantCliAuthToken) {
    throw new Error("INSTANT_CLI_AUTH_TOKEN is required for Instant temp app creation");
  }

  const { stdout: initOut } = await execAsync(
    `npx instant-cli@latest init-without-files --title "${title}" --temp`,
    {
      cwd: process.cwd(),
      env: { ...process.env, INSTANT_CLI_AUTH_TOKEN: instantCliAuthToken },
      maxBuffer: 1024 * 1024 * 10,
    }
  );

  const app = await parseInstantCliInitOutput(initOut);

  const execOpts = {
    cwd: process.cwd(),
    env: { ...process.env, INSTANT_CLI_AUTH_TOKEN: instantCliAuthToken },
    maxBuffer: 1024 * 1024 * 50,
    timeout: 120000,
  };

  await execAsync(
    `npx instant-cli@latest push schema --app ${app.appId} --token ${app.adminToken} --yes`,
    execOpts
  );

  const permsPath = path.resolve(process.cwd(), "instant.perms.ts");
  try {
    await fs.access(permsPath);
    await execAsync(
      `npx instant-cli@latest push perms --app ${app.appId} --token ${app.adminToken} --yes`,
      execOpts
    );
  } catch {
    // No perms file, skip.
  }

  await writeInstantTestApp(app);
  return app;
}

export async function getOrCreateInstantTestApp({
  title,
}: {
  title: string;
}): Promise<InstantTestApp | null> {
  const persist = String(process.env.APP_TEST_PERSIST ?? "").trim() === "true";
  if (persist) {
    const existing = await readInstantTestApp();
    if (existing?.appId && existing?.adminToken) return existing;
  } else {
    try {
      await fs.rm(ARTIFACT_PATH, { force: true });
    } catch {
      // ignore
    }
  }

  if (!String(process.env.INSTANT_CLI_AUTH_TOKEN ?? "").trim()) {
    return null;
  }

  return await createTempInstantAppAndPush({ title });
}
