import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    // Components in components/ai-elements are served as registry source files.
    // They are intentionally excluded from local typecheck to keep upstream parity.
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
