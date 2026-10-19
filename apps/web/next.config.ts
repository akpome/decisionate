import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the web container portable across Vercel, Railway, Cloud Run, ECS,
  // and any provider that can run a Node process.
  output: "standalone",
  deploymentId:
    process.env.NEXT_DEPLOYMENT_ID ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    undefined,
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
