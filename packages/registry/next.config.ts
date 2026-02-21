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
  typescript: {
    // El type checking se puede ejecutar por separado con `pnpm typecheck`
    // para tener feedback visible. Durante el build se deshabilita para evitar
    // bloqueos sin feedback causados por tipos complejos de @ekairos/thread
    ignoreBuildErrors: true,
  },
  // Mostrar más información durante el build
  onDemandEntries: {
    maxInactiveAge: 25 * 1000,
    pagesBufferLength: 2,
  },
};

export default nextConfig;
