import SharedDashboardPage from "@/app/share/dashboard/page"

export const metadata = {
  title: "Decisionate Live Demo",
  description:
    "Explore Decisionate dashboards with sample Google Analytics, Stripe, Shopify, QuickBooks, FreshBooks, Sage, Xero, HubSpot, and Meta Ads data.",
}

export default function DemoPage() {
  return <SharedDashboardPage demo />
}
