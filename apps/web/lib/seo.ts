import type { Metadata, MetadataRoute } from "next"
import { DECISIONATE_MARKETING_ORIGIN } from "./decisionate-domains"

export const publicSeoPages = {
  "/": {
    title: "Decisionate | Business Analytics and Weekly Reports",
    description: "Connect sales, marketing and accounting data. Compare performance, plan budgets, forecast results and track decisions with weekly business reports.",
  },
  "/demo": {
    title: "Live Business Dashboard Demo | Decisionate",
    description: "Explore Decisionate's interactive business dashboards with sample sales, advertising, accounting and ecommerce data. No sign-in required.",
  },
  "/security": {
    title: "Security and Data Protection | Decisionate",
    description: "Learn about Decisionate's workspace access controls, connector credential protection, AI data handling, retention and security reporting.",
  },
  "/privacy": {
    title: "Privacy Policy | Decisionate",
    description: "How Decisionate handles account information, connected business data, AI analysis, retention and requests to access or delete your information.",
  },
  "/terms": {
    title: "Terms of Service | Decisionate",
    description: "Read the terms for Decisionate's business analytics, workspaces, connected data, reports, subscriptions and account responsibilities.",
  },
} as const

export type PublicSeoPath = keyof typeof publicSeoPages

export function isIndexableMarketingHost(hostname: string, portalId = "", deploymentEnvironment = "") {
  return hostname === "decisionate.ca" && !portalId && !["preview", "development"].includes(deploymentEnvironment)
}

export function publicPageMetadata(path: PublicSeoPath, indexable: boolean): Metadata {
  const page = publicSeoPages[path]
  if (!indexable) return { title: { absolute: page.title }, description: page.description, robots: { index: false, follow: false } }
  const url = new URL(path, DECISIONATE_MARKETING_ORIGIN).href
  const image = {
    url: `${DECISIONATE_MARKETING_ORIGIN}/social-preview.png`, width: 1200, height: 630,
    alt: "Decisionate - business analytics, forecasts and weekly reports",
  }
  return {
    metadataBase: new URL(DECISIONATE_MARKETING_ORIGIN),
    title: { absolute: page.title },
    description: page.description,
    alternates: { canonical: url },
    robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large" } },
    openGraph: { type: "website", siteName: "Decisionate", locale: "en_CA", title: page.title, description: page.description, url, images: [image] },
    twitter: { card: "summary_large_image", title: page.title, description: page.description, images: [image] },
  }
}

export function marketingSitemap(indexable: boolean): MetadataRoute.Sitemap {
  return indexable ? Object.keys(publicSeoPages).map(path => ({ url: new URL(path, DECISIONATE_MARKETING_ORIGIN).href })) : []
}

export function siteRobots(indexable: boolean): MetadataRoute.Robots {
  return {
    // Allow page crawling so noindex on sign-in/shared pages can be seen.
    // Authentication and API permissions remain the access-control boundary.
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/__clerk/", "/demo-data/"] },
    ...(indexable ? { sitemap: `${DECISIONATE_MARKETING_ORIGIN}/sitemap.xml` } : {}),
  }
}

export const marketingStructuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization", "@id": `${DECISIONATE_MARKETING_ORIGIN}/#organization`,
      name: "Decisionate", url: DECISIONATE_MARKETING_ORIGIN,
      logo: `${DECISIONATE_MARKETING_ORIGIN}/icons/decisionate-logo.png`,
      contactPoint: { "@type": "ContactPoint", contactType: "customer support", email: "support@decisionate.ca" },
    },
    {
      "@type": "WebSite", "@id": `${DECISIONATE_MARKETING_ORIGIN}/#website`,
      name: "Decisionate", url: DECISIONATE_MARKETING_ORIGIN,
      publisher: { "@id": `${DECISIONATE_MARKETING_ORIGIN}/#organization` }, inLanguage: "en-CA",
    },
    {
      "@type": "SoftwareApplication", name: "Decisionate", url: DECISIONATE_MARKETING_ORIGIN,
      applicationCategory: "BusinessApplication", operatingSystem: "Web",
      description: publicSeoPages["/"].description,
      publisher: { "@id": `${DECISIONATE_MARKETING_ORIGIN}/#organization` },
    },
  ],
}

export function serializeStructuredData(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c")
}
