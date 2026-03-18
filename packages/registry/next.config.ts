import type { NextConfig } from "next";
import { config as dotenvConfig } from "dotenv";
import { resolve, sep } from "node:path";

const cwd = process.cwd();
const registryDir = cwd.endsWith(`${sep}packages${sep}registry`)
  ? cwd
  : resolve(cwd, "packages/registry");
const workspaceRoot = resolve(registryDir, "../..");

dotenvConfig({ path: resolve(registryDir, ".env.local"), quiet: true });
dotenvConfig({ path: resolve(registryDir, ".env"), quiet: true });
dotenvConfig({ path: resolve(workspaceRoot, ".env.local"), quiet: true });
dotenvConfig({ path: resolve(workspaceRoot, ".env"), quiet: true });

const nextConfig: NextConfig = {
  onDemandEntries: {
    maxInactiveAge: 25 * 1000,
    pagesBufferLength: 2,
  },
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
