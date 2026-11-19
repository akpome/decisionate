import type { NextConfig } from "next";
import { workspaceRoutes } from "./lib/application-routes";

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
  async rewrites() {
    return workspaceRoutes.map(route => ({
      source: `${route.path}/:path*`,
      destination: `${route.internal}/:path*`,
    }));
  },
  async headers() {
    const noStalePwaAssetHeaders = [
      {
        key: "Cache-Control",
        value: "public, max-age=0, must-revalidate",
      },
    ];

    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "app\\.decisionate\\.ca" }],
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        source: "/share/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }, { key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Referrer-Policy", value: "no-referrer" }],
      },
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
