import "server-only"
import { headers } from "next/headers"
import { getAuthRequestOrigin } from "@/features/auth/lib/auth-redirects"
import { portalBrand } from "./portal-brand"
import { isIndexableMarketingHost, publicPageMetadata, type PublicSeoPath } from "./seo"

export async function isMarketingRequest() {
  const hostname = new URL(getAuthRequestOrigin(await headers())).hostname
  return isIndexableMarketingHost(hostname, portalBrand.id, process.env.VERCEL_ENV)
}

export async function marketingPageMetadata(path: PublicSeoPath) {
  const indexable = await isMarketingRequest()
  return {
    ...publicPageMetadata(path, indexable),
    ...(indexable ? { verification: {
      google: process.env.GOOGLE_SITE_VERIFICATION || undefined,
      other: process.env.BING_SITE_VERIFICATION ? { "msvalidate.01": process.env.BING_SITE_VERIFICATION } : undefined,
    } } : {}),
  }
}
