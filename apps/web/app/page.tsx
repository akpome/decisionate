import { LandingFooter } from "@/components/landing/footer"
import { LandingHero } from "@/components/landing/hero"
import { LandingNavbar } from "@/components/landing/navbar"
import "@/components/landing/landing.css"
import { isMarketingRequest, marketingPageMetadata } from "@/lib/seo-server"
import { marketingStructuredData, serializeStructuredData } from "@/lib/seo"
import type { PublicPlanCatalog } from "@/lib/api"
import {
  AgencySection,
  BusinessSection,
  FAQSection,
  FeaturesSection,
  FinalCTASection,
  IntegrationsSection,
  PricingSection
} from "@/components/landing/landing-sections"

export function generateMetadata() {
  return marketingPageMetadata("/")
}

export default async function HomePage() {
  const marketing = await isMarketingRequest()
  let catalog: PublicPlanCatalog | null = null
  try {
    const api = (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "")
    const response = await fetch(`${api}/api/v2/application/plans`, { cache: "no-store", signal: AbortSignal.timeout(2500) })
    if (response.ok) catalog = await response.json()
  } catch { /* The marketing page remains available during API maintenance. */ }
  return (
    <div className="landing-page min-h-screen bg-white text-neutral-950">
      {marketing && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(marketingStructuredData) }} />}
      <LandingNavbar />
      <main id="main-content">
        <LandingHero />
        <BusinessSection />
        <AgencySection />
        <FeaturesSection />
        <IntegrationsSection />
        <PricingSection catalog={catalog} />
        <FAQSection />
        <FinalCTASection />
      </main>
      <LandingFooter />
    </div>
  )
}
