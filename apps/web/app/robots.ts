import type { MetadataRoute } from "next"
import { isMarketingRequest } from "@/lib/seo-server"
import { siteRobots } from "@/lib/seo"

export default async function robots(): Promise<MetadataRoute.Robots> {
  return siteRobots(await isMarketingRequest())
}
