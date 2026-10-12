import { LandingFooter } from "@/components/landing/footer"
import { LandingHero } from "@/components/landing/hero"
import { LandingNavbar } from "@/components/landing/navbar"
import "@/components/landing/landing.css"
import {
  AgencySection,
  BusinessSection,
  FAQSection,
  FeaturesSection,
  FinalCTASection,
  IntegrationsSection,
  PricingSection
} from "@/components/landing/landing-sections"

export default function HomePage() {
  return (
    <div className="landing-page min-h-screen bg-white text-neutral-950">
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
