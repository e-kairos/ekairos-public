import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";
import { withRuntime } from "@ekairos/domain/next";

const nextConfig: NextConfig = {
  experimental: {
    externalDir: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  transpilePackages: ["@ekairos/thread", "@ekairos/domain"],
};

export default withRuntime(withWorkflow(nextConfig) as any, {
  bootstrapModule: "./src/ekairos.ts",
});
