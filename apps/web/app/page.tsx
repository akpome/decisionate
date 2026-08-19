import { LandingFooter } from "@/components/landing/footer"
import { LandingHero } from "@/components/landing/hero"
import { LandingNavbar } from "@/components/landing/navbar"
import {
  AIDecisionEngineSection,
  BenefitsSection,
  DecisionLifecycleSection,
  FAQSection,
  FeaturesSection,
  FinalCTASection,
  IndustryDashboardsSection,
  IntegrationsSection,
  PricingSection,
  ProductWorkflowSection,
  TrustedBySection,
} from "@/components/landing/landing-sections"

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white text-slate-950">
      <LandingNavbar />
      <main>
        <LandingHero />
        <TrustedBySection />
        <ProductWorkflowSection />
        <IndustryDashboardsSection />
        <FeaturesSection />
        <AIDecisionEngineSection />
        <DecisionLifecycleSection />
        <IntegrationsSection />
        <BenefitsSection />
        <PricingSection />
        <FAQSection />
        <FinalCTASection />
      </main>
      <LandingFooter />
    </div>
  )
}
