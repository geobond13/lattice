import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The agent route reads the pre-captured inspection frames from public/ at runtime.
  outputFileTracingIncludes: { '/api/agent': ['./public/frames/**/*'] },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
