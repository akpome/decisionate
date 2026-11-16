import type { MetadataRoute } from "next"
import { isMarketingRequest } from "@/lib/seo-server"
import { marketingSitemap } from "@/lib/seo"

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return marketingSitemap(await isMarketingRequest())
}
