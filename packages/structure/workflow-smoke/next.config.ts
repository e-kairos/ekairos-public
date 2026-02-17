import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";
import { withRuntime } from "@ekairos/domain/next";

const nextConfig: NextConfig = {
  experimental: {
    externalDir: true,
  },
  typescript: {
    // This package is a workflow harness. We don't want TS typecheck failures
    // (e.g. react typings) to block beta publishing of core packages.
    ignoreBuildErrors: true,
  },
  transpilePackages: [
    "@ekairos/structure",
    "@ekairos/thread",
    "@ekairos/sandbox",
    "@ekairos/domain",
  ],
};

export default withRuntime(withWorkflow(nextConfig) as any, {
  bootstrapModule: "./src/ekairos.ts",
});

