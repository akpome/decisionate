import { LandingFooter } from "@/components/landing/footer"
import { LandingHero } from "@/components/landing/hero"
import { LandingNavbar } from "@/components/landing/navbar"
import "@/components/landing/landing.css"
import { isMarketingRequest, marketingPageMetadata } from "@/lib/seo-server"
import { marketingStructuredData, serializeStructuredData } from "@/lib/seo"
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
        <PricingSection />
        <FAQSection />
        <FinalCTASection />
      </main>
      <LandingFooter />
    </div>
  )
}
