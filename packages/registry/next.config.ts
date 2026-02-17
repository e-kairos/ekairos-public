import type { NextConfig } from "next";

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
