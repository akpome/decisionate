import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the web container portable across Vercel, Railway, Cloud Run, ECS,
  // and any provider that can run a Node process.
  output: "standalone",
  async headers() {
    const noStalePwaAssetHeaders = [
      {
        key: "Cache-Control",
        value: "public, max-age=0, must-revalidate",
      },
    ];

    return [
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
