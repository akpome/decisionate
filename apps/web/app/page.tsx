import { LandingFooter } from "@/components/landing/footer"
import { LandingHero } from "@/components/landing/hero"
import { LandingNavbar } from "@/components/landing/navbar"
import "@/components/landing/landing.css"
import {
  FAQSection,
  FeaturesSection,
  FinalCTASection,
  IndustryDashboardsSection,
  IntegrationsSection,
  PricingSection
} from "@/components/landing/landing-sections"

export default function HomePage() {
  return (
    <div className="landing-page min-h-screen bg-white text-neutral-950">
      <LandingNavbar />
      <main id="main-content">
        <LandingHero />
        <FeaturesSection />
        <IndustryDashboardsSection />
        <IntegrationsSection />
        <PricingSection />
        <FAQSection />
        <FinalCTASection />
      </main>
      <LandingFooter />
    </div>
  )
}
