import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the web container portable across Vercel, Railway, Cloud Run, ECS,
  // and any provider that can run a Node process.
  output: "standalone",
  // Vercel supplies a unique ID per deployment, including same-commit redeploys.
  deploymentId: process.env.VERCEL === "1" ? undefined : (
    process.env.NEXT_DEPLOYMENT_ID ||
    process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 32) ||
    undefined
  ),
  async headers() {
    const noStalePwaAssetHeaders = [
      {
        key: "Cache-Control",
        value: "public, max-age=0, must-revalidate",
      },
    ];

    return [
      {
        source: "/demo-data/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          ...noStalePwaAssetHeaders,
          {
            key: "Service-Worker-Allowed",
            value: "/",
          },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: noStalePwaAssetHeaders,
      },
      {
        source: "/offline.html",
        headers: noStalePwaAssetHeaders,
      },
    ];
  },
};

export default nextConfig;
